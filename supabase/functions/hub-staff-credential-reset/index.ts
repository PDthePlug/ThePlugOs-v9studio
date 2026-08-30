import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  staffCredentialResetChallengeBytes,
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
  requestDigest,
  requestSource,
  requireNativeJson,
  rpc,
  storageHmac,
  string,
  uuid,
} from '../_shared/hub-edge.ts';

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const RESET_CODE = /^[A-Za-z0-9_-]{12}$/;
const PIN = /^\d{4,8}$/;

/**
 * Native-only companion to the owner browser's recovery-code issuance. The
 * endpoint deliberately has no CORS route and never accepts an owner JWT,
 * browser-origin request, or Capacitor-provided PIN.
 */
Deno.serve(async (request) => {
  try {
    const body = await requireNativeJson(request, 32 * 1024);
    const action = string(body.action, 'Action', 16);
    const client = serviceClient();
    if (action === 'begin') return await beginReset(request, client, body);
    if (action === 'complete') return await completeReset(client, body);
    throw new HubHttpError(400, 'Action is invalid.');
  } catch (error) {
    if (error instanceof HubHttpError) return genericFailure(error.status === 413 ? 413 : 400);
    if (error instanceof HubConfigurationError) return genericFailure(503);
    return genericFailure();
  }
});

async function beginReset(
  request: Request,
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const hubDeviceId = deviceId(body.hubDeviceId);
  const resetCode = string(body.resetCode, 'Owner recovery code', 12);
  if (!RESET_CODE.test(resetCode)) throw new HubHttpError(400, 'Owner recovery code is invalid.');

  const sourceHash = await storageHmac('credential-reset-source', requestSource(request));
  const deviceHash = await storageHmac('credential-reset-device', hubDeviceId);
  // The digest deliberately excludes the code. The code is neither logged nor
  // stored as a request fingerprint outside R012's private verifier record.
  const digest = await requestDigest({ action: 'begin', requestId, hubDeviceId });
  const result = object(await rpc<unknown>(client, 'r012_begin_hub_staff_credential_reset', {
    p_reset_code: resetCode,
    p_request_id: requestId,
    p_request_digest: digest,
    p_source_hash: sourceHash,
    p_device_hash: deviceHash,
    p_hub_device_id: hubDeviceId,
  }), 'Credential-reset challenge result');

  if (result.ok !== true || result.completed === true) return genericFailure();
  const challengeId = uuid(result.challengeId, 'Challenge ID');
  const nonce = base64url(result.nonce, 'Challenge nonce', 43, 43);
  const context = object(await rpc<unknown>(client, 'r012_get_hub_staff_credential_reset_context', {
    p_challenge_id: challengeId,
  }), 'Credential-reset context');
  if (context.state !== 'PENDING'
    || context.requestId !== requestId
    || context.nonce !== nonce
    || context.hubDeviceId !== hubDeviceId) {
    return genericFailure();
  }
  return noStoreJson({
    ok: true,
    challengeId,
    nonce,
    expiresAt: canonicalUtc(result.expiresAt, 'Challenge expiry'),
    staffId: uuid(context.staffId, 'Staff ID'),
    staffName: string(context.staffName, 'Staff name', 120),
    staffRole: staffRole(context.staffRole),
  });
}

async function completeReset(
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const challengeId = uuid(body.challengeId, 'Challenge ID');
  const nonce = base64url(body.nonce, 'Challenge nonce', 43, 43);
  const hubDeviceId = deviceId(body.hubDeviceId);
  const staffId = uuid(body.staffId, 'Staff ID');
  const signature = base64url(body.signature, 'Credential-reset proof', 8, 256);
  const pin = string(body.pin, 'Native security PIN', 8);
  if (!PIN.test(pin)) throw new HubHttpError(400, 'Native security PIN is invalid.');

  const context = object(await rpc<unknown>(client, 'r012_get_hub_staff_credential_reset_context', {
    p_challenge_id: challengeId,
  }), 'Credential-reset context');
  const state = string(context.state, 'Credential-reset state', 16);
  if (state !== 'PENDING' && state !== 'COMPLETE') return genericFailure();
  if (context.requestId !== requestId
    || context.nonce !== nonce
    || context.hubDeviceId !== hubDeviceId
    || context.staffId !== staffId) {
    return genericFailure();
  }

  const key = base64url(context.hubSigningPublicKeyBase64, 'Hub signing public key', 64, 4096);
  const proof = staffCredentialResetChallengeBytes({
    requestId,
    challengeId,
    nonceBase64url: nonce,
    hubDeviceId,
    staffId,
  });
  if (!await verifyP256DerSignature(key, proof, signature)) return genericFailure();

  // The native PIN is supplied only after a current Hub proof validates. It
  // never enters a browser bridge, request digest, audit payload, or response.
  const completion = object(await rpc<unknown>(client, 'r012_complete_hub_staff_credential_reset', {
    p_challenge_id: challengeId,
    p_pin: pin,
  }), 'Credential-reset completion');
  if (completion.ok !== true || completion.state !== 'COMPLETE' || completion.staffId !== staffId) {
    return genericFailure();
  }
  const revocationVersion = completion.revocationVersion;
  if (typeof revocationVersion !== 'number'
    || !Number.isSafeInteger(revocationVersion)
    || revocationVersion < 1) {
    throw new HubConfigurationError('Credential-reset completion is invalid.');
  }
  return noStoreJson({ ok: true, state: 'COMPLETE', staffId, revocationVersion });
}

function deviceId(value: unknown): string {
  const result = string(value, 'Hub device ID', 200);
  if (!DEVICE_ID.test(result)) throw new HubHttpError(400, 'Hub device ID is invalid.');
  return result;
}

function staffRole(value: unknown): string {
  const role = string(value, 'Staff role', 32);
  if (!['CASHIER', 'KITCHEN_STAFF', 'MANAGER', 'OWNER', 'ADMINISTRATOR'].includes(role)) {
    throw new HubConfigurationError('Credential-reset staff role is invalid.');
  }
  return role;
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = platformServiceKey();
  if (!url || !key) throw new HubConfigurationError('Supabase service configuration is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
