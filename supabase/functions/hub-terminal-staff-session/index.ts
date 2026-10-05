import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  terminalStaffSessionChallengeBytes,
  verifyP256DerSignature,
} from '../_shared/hub-protocol.ts';
import {
  HubConfigurationError,
  HubHttpError,
  base64url,
  canonicalUtc,
  genericFailure,
  issueTerminalStaffSession,
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

/**
 * Native-only terminal PIN/session receiver. A signed admission and an
 * authenticated local Hub link are required on the Android side before this
 * flow is shown, but this receiver independently proves the terminal key,
 * branch scope, role, rate limits, and PIN through service-only RPCs.
 */
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

async function beginSession(
  request: Request,
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const terminalDeviceId = deviceId(body.terminalDeviceId, 'Terminal device ID');
  const staffId = uuid(body.staffId, 'Staff ID');
  const sourceHash = await storageHmac('terminal-staff-source', requestSource(request));
  const deviceHash = await storageHmac('terminal-staff-device', terminalDeviceId);
  const digest = await requestDigest({ action: 'begin', requestId, terminalDeviceId, staffId });
  const result = object(await rpc<unknown>(client, 'r014_begin_terminal_staff_session', {
    p_request_id: requestId,
    p_request_digest: digest,
    p_source_hash: sourceHash,
    p_device_hash: deviceHash,
    p_terminal_device_id: terminalDeviceId,
    p_staff_id: staffId,
  }), 'Terminal staff-session result');
  if (result.ok !== true) return genericFailure();
  return noStoreJson({
    ok: true,
    challengeId: uuid(result.challengeId, 'Challenge ID'),
    nonce: base64url(result.nonce, 'Nonce', 43, 43),
    expiresAt: canonicalUtc(result.expiresAt, 'Challenge expiry'),
    completed: result.completed === true,
  });
}

async function completeSession(
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const challengeId = uuid(body.challengeId, 'Challenge ID');
  const nonce = base64url(body.nonce, 'Challenge nonce', 43, 43);
  const terminalDeviceId = deviceId(body.terminalDeviceId, 'Terminal device ID');
  const hubDeviceId = deviceId(body.hubDeviceId, 'Hub device ID');
  const staffId = uuid(body.staffId, 'Staff ID');
  const signature = base64url(body.signature, 'Terminal staff-session proof', 8, 256);

  const context = object(await rpc<unknown>(client, 'r014_get_terminal_staff_session_context', {
    p_challenge_id: challengeId,
  }), 'Terminal staff-session context');
  const state = string(context.state, 'Terminal staff-session state', 16);
  if (state !== 'PENDING' && state !== 'PREPARED' && state !== 'COMPLETE') return genericFailure();
  if (context.requestId !== requestId || context.nonce !== nonce || context.terminalDeviceId !== terminalDeviceId ||
      context.hubDeviceId !== hubDeviceId || context.staffId !== staffId) {
    return genericFailure();
  }
  const key = base64url(context.terminalSigningPublicKeyBase64, 'Terminal signing public key', 64, 4096);
  const proof = terminalStaffSessionChallengeBytes({
    requestId,
    challengeId,
    nonceBase64url: nonce,
    terminalDeviceId,
    hubDeviceId,
    staffId,
  });
  if (!await verifyP256DerSignature(key, proof, signature)) return genericFailure();

  if (state === 'COMPLETE') {
    return noStoreJson({
      ok: true,
      envelope: object(context.envelope, 'Terminal staff-session envelope'),
      activeStaffSessionId: uuid(context.activeStaffSessionId, 'Terminal staff-session ID'),
    });
  }

  let prepared = context;
  if (state === 'PENDING') {
    const pin = string(body.pin, 'Native security PIN', 8);
    if (!/^\d{4,8}$/.test(pin)) return genericFailure(400);
    // PIN travels only from the Android native activity to this service-only
    // RPC. It is intentionally absent from request hashes, response bodies,
    // browser bridges, local-link messages, and audit payloads.
    const verified = object(await rpc<unknown>(client, 'r014_verify_terminal_staff_pin', {
      p_challenge_id: challengeId,
      p_pin: pin,
    }), 'Terminal staff PIN verification');
    if (verified.authenticated !== true) return genericFailure();
    prepared = object(await rpc<unknown>(client, 'r014_prepare_terminal_staff_session', {
      p_challenge_id: challengeId,
    }), 'Terminal staff-session preparation');
  }
  if (prepared.state !== 'PREPARED') return genericFailure();
  const sessionId = uuid(prepared.sessionId, 'Terminal staff-session ID');
  const issued = await issueTerminalStaffSession(prepared.sessionContext);
  const envelope = object(await rpc<unknown>(client, 'r014_finalize_terminal_staff_session', {
    p_challenge_id: challengeId,
    p_session_id: sessionId,
    p_issuer_key_id: issued.issuerKeyId,
    p_payload_base64: issued.payloadBase64,
    p_signature_base64: issued.signature,
    p_payload: issued.payload,
    p_issued_at: issued.issuedAt,
    p_expires_at: issued.expiresAt,
  }), 'Terminal staff-session completion');
  return noStoreJson({ ok: true, envelope, activeStaffSessionId: sessionId });
}

function deviceId(value: unknown, subject: string): string {
  const result = string(value, subject, 200);
  if (!DEVICE_ID.test(result)) throw new HubHttpError(400, `${subject} is invalid.`);
  return result;
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = platformServiceKey();
  if (!url || !key) throw new HubConfigurationError('Supabase service configuration is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
