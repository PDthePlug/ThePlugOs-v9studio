import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  validateDistinctSyncEvents,
  validateReceiverAcknowledgements,
} from '../_shared/hub-sync-ack.ts';
import {
  syncRequestBytes,
  utf8JsonObjectFromBase64Url,
  verifyP256DerSignature,
} from '../_shared/hub-protocol.ts';
import {
  HubConfigurationError,
  HubHttpError,
  base64url,
  canonicalUtc,
  genericFailure,
  noStoreJson,
  object,
  platformServiceKey,
  requireNativeJson,
  rpc,
  storageHmac,
  string,
  uuid,
  withinClockSkew,
} from '../_shared/hub-edge.ts';

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

Deno.serve(async (request) => {
  try {
    const body = await requireNativeJson(request, 512 * 1024);
    const client = serviceClient();
    const requestId = uuid(body.requestId, 'Request ID');
    const hubDeviceId = deviceId(body.hubDeviceId);
    const bundleId = uuid(body.bundleId, 'Bundle ID');
    const issuedAt = canonicalUtc(body.issuedAt, 'Sync issue time');
    withinClockSkew(issuedAt);
    const payloadBase64 = base64url(body.payloadBase64, 'Sync payload', 2, 500_000);
    const signature = base64url(body.signature, 'Sync proof', 8, 256);
    const payload = utf8JsonObjectFromBase64Url(payloadBase64, 'Sync payload');
    if (Object.keys(payload).length !== 1 || !Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > 100) {
      throw new HubHttpError(400, 'Sync payload is invalid.');
    }

    const deviceHash = await storageHmac('sync-device', hubDeviceId);
    const context = object(await rpc<unknown>(client, 'r003_get_hub_sync_context', {
      p_hub_device_id: hubDeviceId,
      p_bundle_id: bundleId,
      p_device_hash: deviceHash,
    }), 'Sync context');
    // RECOVERY is replication-only: the SQL receiver additionally requires
    // every event to predate the active bundle's expiry. The endpoint never
    // uses this state to authorize a new local command.
    if (context.state !== 'ACTIVE' && context.state !== 'RECOVERY') return genericFailure();
    const key = base64url(context.hubSigningPublicKeyBase64, 'Hub signing public key', 64, 4096);
    const proof = syncRequestBytes({ requestId, hubDeviceId, bundleId, issuedAt, payloadBase64 });
    if (!await verifyP256DerSignature(key, proof, signature)) return genericFailure();

    // Preserve durable event order while routing each already-authenticated
    // command family to its narrow database receiver. A payment must never
    // leap ahead of its preceding order merely because all order actions were
    // grouped together; consecutive receiver groups retain the Hub sequence.
    const acknowledgedEventIds: string[] = [];
    let receiver: HubEventReceiver | null = null;
    let group: SyncEvent[] = [];
    // Validate the entire signed batch before the first receiver invocation.
    // A duplicate later in the payload must not let an earlier group mutate
    // cloud state and then fail only halfway through the same HTTP request.
    const inputEvents = payload.events.map((rawEvent) => object(rawEvent, 'Sync event'));
    const validatedEvents = validateDistinctSyncEvents(inputEvents, (event): SyncEvent => {
      const eventId = uuid(event.eventId, 'Sync event ID');
      return { event, eventId, receiver: receiverForEvent(event) };
    });
    const flush = async () => {
      if (!receiver || group.length === 0) return;
      const groupEventIds = new Set(group.map((entry) => entry.eventId));
      const receipt = object(await rpc<unknown>(client, receiver, {
        p_hub_device_id: hubDeviceId,
        p_bundle_id: bundleId,
        p_events: group.map((entry) => entry.event),
      }), 'Sync receipt');
      const acknowledged = validateReceiverAcknowledgements(
        receipt.acknowledgedEventIds,
        groupEventIds,
        (acknowledgement) => uuid(acknowledgement, 'Sync acknowledgement event ID'),
      );
      acknowledgedEventIds.push(...acknowledged);
    };
    for (const event of validatedEvents) {
      const nextReceiver = event.receiver;
      if (receiver && nextReceiver !== receiver) {
        await flush();
        group = [];
      }
      receiver = nextReceiver;
      group.push({ event, eventId });
    }
    await flush();
    return noStoreJson({ ok: true, acknowledgedEventIds });
  } catch (error) {
    if (error instanceof HubHttpError) return genericFailure(error.status === 413 ? 413 : 400);
    if (error instanceof HubConfigurationError) return genericFailure(503);
    return genericFailure();
  }
});

function deviceId(value: unknown): string {
  const result = string(value, 'Hub device ID', 200);
  if (!DEVICE_ID.test(result)) throw new HubHttpError(400, 'Hub device ID is invalid.');
  return result;
}

type HubEventReceiver =
  | 'r003_ingest_hub_events'
  | 'r005_ingest_hub_financial_events'
  | 'r006_ingest_hub_shift_close_events'
  | 'r007_ingest_hub_inventory_events'
  | 'r008_ingest_hub_inventory_adjustment_events'
  | 'r009_ingest_hub_inventory_waste_events';

interface SyncEvent {
  event: Record<string, unknown>;
  eventId: string;
  receiver: HubEventReceiver;
}

function receiverForEvent(value: unknown): HubEventReceiver {
  const event = object(value, 'Sync event');
  const action = string(event.action, 'Sync event action', 80);
  if (action === 'ORDER_PLACED' || action === 'ORDER_STATUS_CHANGED') return 'r003_ingest_hub_events';
  if (action === 'SHIFT_OPENED' || action === 'PAYMENT_CAPTURED') return 'r005_ingest_hub_financial_events';
  if (action === 'SHIFT_CLOSED') return 'r006_ingest_hub_shift_close_events';
  if (action === 'INVENTORY_RECEIVED') return 'r007_ingest_hub_inventory_events';
  if (action === 'INVENTORY_ADJUSTED') return 'r008_ingest_hub_inventory_adjustment_events';
  if (action === 'INVENTORY_WASTED') return 'r009_ingest_hub_inventory_waste_events';
  throw new HubHttpError(400, 'Sync event action is invalid.');
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = platformServiceKey();
  if (!url || !key) throw new HubConfigurationError('Supabase service configuration is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
