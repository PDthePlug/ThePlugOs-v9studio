import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  staffSessionChallengeBytes,
  verifyP256DerSignature,
} from '../_shared/hub-protocol.ts';
import {
  HubConfigurationError,
  HubHttpError,
  base64url,
  canonicalUtc,
  genericFailure,
  issueAuthorizationBundle,
  noStoreJson,
  object,
  platformServiceKey,
  requestDigest,
  requestSource,
  requireNativeJson,
  rpc,
  storageHmac,
  string,
  uuid,
} from '../_shared/hub-edge.ts';

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

Deno.serve(async (request) => {
  try {
    const body = await requireNativeJson(request, 32 * 1024);
    const action = string(body.action, 'Action', 16);
    const client = serviceClient();
    if (action === 'begin') return await beginSession(request, client, body);
    if (action === 'complete') return await completeSession(client, body);
    throw new HubHttpError(400, 'Action is invalid.');
  } catch (error) {
    if (error instanceof HubHttpError) return genericFailure(error.status === 413 ? 413 : 400);
    if (error instanceof HubConfigurationError) return genericFailure(503);
    return genericFailure();
  }
});

async function beginSession(request: Request, client: ReturnType<typeof serviceClient>, body: Record<string, unknown>): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const hubDeviceId = deviceId(body.hubDeviceId);
  const staffId = uuid(body.staffId, 'Staff ID');
  const sourceHash = await storageHmac('staff-source', requestSource(request));
  const deviceHash = await storageHmac('staff-device', hubDeviceId);
  const digest = await requestDigest({ action: 'begin', requestId, hubDeviceId, staffId });
  const result = object(await rpc<unknown>(client, 'r003_begin_hub_staff_session', {
    p_request_id: requestId,
    p_request_digest: digest,
    p_source_hash: sourceHash,
    p_device_hash: deviceHash,
    p_hub_device_id: hubDeviceId,
    p_staff_id: staffId,
  }), 'Staff session result');
  if (result.ok !== true) return genericFailure();
  return noStoreJson({
    ok: true,
    challengeId: uuid(result.challengeId, 'Challenge ID'),
    nonce: base64url(result.nonce, 'Nonce', 43, 43),
    expiresAt: canonicalUtc(result.expiresAt, 'Challenge expiry'),
    completed: result.completed === true,
  });
}

async function completeSession(client: ReturnType<typeof serviceClient>, body: Record<string, unknown>): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const challengeId = uuid(body.challengeId, 'Challenge ID');
  const nonce = base64url(body.nonce, 'Challenge nonce', 43, 43);
  const hubDeviceId = deviceId(body.hubDeviceId);
  const staffId = uuid(body.staffId, 'Staff ID');
  const signature = base64url(body.signature, 'Staff-session proof', 8, 256);

  const context = object(await rpc<unknown>(client, 'r003_get_hub_staff_session_context', {
    p_challenge_id: challengeId,
  }), 'Staff session context');
  const state = string(context.state, 'Staff session state', 16);
  if (state !== 'PENDING' && state !== 'PREPARED' && state !== 'COMPLETE') return genericFailure();
  if (context.requestId !== requestId || context.nonce !== nonce || context.hubDeviceId !== hubDeviceId || context.staffId !== staffId) {
    return genericFailure();
  }
  const key = base64url(context.hubSigningPublicKeyBase64, 'Hub signing public key', 64, 4096);
  const proof = staffSessionChallengeBytes({ requestId, challengeId, nonceBase64url: nonce, hubDeviceId, staffId });
  if (!await verifyP256DerSignature(key, proof, signature)) return genericFailure();
  if (state === 'COMPLETE') {
    return noStoreJson({
      ok: true,
      envelope: object(context.envelope, 'Staff-session envelope'),
      // This opaque selector is returned only to the native HTTPS caller. It
      // is never forwarded over Capacitor and is still not a bearer: every
      // later command must carry a Keystore signature and pass bundle checks.
      activeStaffSessionId: uuid(context.activeStaffSessionId, 'Native staff-session ID'),
    });
  }

  let prepared = context;
  if (state === 'PENDING') {
    const pin = string(body.pin, 'Native security PIN', 8);
    if (!/^\d{4,8}$/.test(pin)) return genericFailure(400);
    // The PIN is passed only to the service-only RPC in this native endpoint.
    // It is intentionally excluded from request digests, logs, responses, and
    // all browser/Capacitor bridge methods.
    const verified = object(await rpc<unknown>(client, 'r003_verify_hub_staff_pin', {
      p_challenge_id: challengeId,
      p_pin: pin,
    }), 'Staff PIN verification');
    if (verified.authenticated !== true) return genericFailure();
    prepared = object(await rpc<unknown>(client, 'r003_prepare_hub_staff_session', {
      p_challenge_id: challengeId,
    }), 'Staff session preparation');
  }
  if (prepared.state !== 'PREPARED') return genericFailure();
  const currentBundleId = uuid(prepared.currentBundleId, 'Current bundle ID');
  const activeStaffSessionId = uuid(prepared.sessionId, 'Native staff-session ID');
  const issued = await issueAuthorizationBundle(prepared.bundleContext);
  const envelope = object(await rpc<unknown>(client, 'r003_finalize_hub_staff_session', {
    p_challenge_id: challengeId,
    p_current_bundle_id: currentBundleId,
    p_bundle_id: issued.bundleId,
    p_issuer_key_id: issued.issuerKeyId,
    p_payload_base64: issued.payloadBase64,
    p_signature_base64: issued.signature,
    p_payload: issued.payload,
    p_issued_at: issued.issuedAt,
    p_expires_at: issued.expiresAt,
  }), 'Staff session completion');
  return noStoreJson({ ok: true, envelope, activeStaffSessionId });
}

function deviceId(value: unknown): string {
  const result = string(value, 'Hub device ID', 200);
  if (!DEVICE_ID.test(result)) throw new HubHttpError(400, 'Hub device ID is invalid.');
  return result;
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = platformServiceKey();
  if (!url || !key) throw new HubConfigurationError('Supabase service configuration is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
