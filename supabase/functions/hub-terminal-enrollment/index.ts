import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  terminalEnrollmentChallengeBytes,
  terminalRenewalChallengeBytes,
  verifyP256DerSignature,
} from '../_shared/hub-protocol.ts';
import {
  HubConfigurationError,
  HubHttpError,
  base64url,
  canonicalUtc,
  genericFailure,
  issueTerminalAdmission,
  noStoreJson,
  object,
  optionalString,
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
const TERMINAL_ROLES = new Set(['CASHIER', 'KITCHEN_STAFF', 'MANAGER']);

/**
 * Native-only terminal enrollment. It has no browser CORS surface and never
 * accepts a browser-generated identity, role, pairing code handoff, or device
 * session. The owner has already selected the terminal role in the separate
 * authenticated owner endpoint.
 */
Deno.serve(async (request) => {
  try {
    const body = await requireNativeJson(request, 64 * 1024);
    const action = string(body.action, 'Action', 16);
    const client = serviceClient();
    if (action === 'begin') return await beginEnrollment(request, client, body);
    if (action === 'complete') return await completeEnrollment(client, body);
    if (action === 'renew-begin') return await beginRenewal(client, body);
    if (action === 'renew-complete') return await completeRenewal(client, body);
    throw new HubHttpError(400, 'Action is invalid.');
  } catch (error) {
    if (error instanceof HubHttpError) return genericFailure(error.status === 413 ? 413 : 400);
    if (error instanceof HubConfigurationError) return genericFailure(503);
    return genericFailure();
  }
});

async function beginEnrollment(
  request: Request,
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const pairingCode = string(body.pairingCode, 'Pairing code', 6);
  if (!/^\d{6}$/.test(pairingCode)) throw new HubHttpError(400, 'Pairing code is invalid.');
  const requestId = uuid(body.requestId, 'Request ID');
  const terminalDeviceId = deviceId(body.terminalDeviceId);
  const terminalName = optionalString(body.terminalName, 'Branch terminal', 120);
  const terminalRole = role(body.terminalRole);
  const signingPublicKeyBase64 = base64url(body.signingPublicKeyBase64, 'Terminal signing public key', 64, 4096);
  const sourceHash = await storageHmac('terminal-enrollment-source', requestSource(request));
  const deviceHash = await storageHmac('terminal-enrollment-device', terminalDeviceId);
  const digest = await requestDigest({
    action: 'begin',
    requestId,
    terminalDeviceId,
    terminalName,
    terminalRole,
    signingPublicKeyBase64,
  });
  const result = object(await rpc<unknown>(client, 'r010_begin_terminal_enrollment', {
    p_pairing_code: pairingCode,
    p_request_id: requestId,
    p_request_digest: digest,
    p_source_hash: sourceHash,
    p_device_hash: deviceHash,
    p_terminal_device_id: terminalDeviceId,
    p_terminal_name: terminalName,
    p_terminal_role: terminalRole,
    p_signing_public_key_base64: signingPublicKeyBase64,
  }), 'Terminal enrollment result');
  if (result.ok !== true) return genericFailure();
  return noStoreJson({
    ok: true,
    challengeId: uuid(result.challengeId, 'Challenge ID'),
    nonce: base64url(result.nonce, 'Nonce', 43, 43),
    expiresAt: canonicalUtc(result.expiresAt, 'Challenge expiry'),
    completed: result.completed === true,
  });
}

async function completeEnrollment(
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const challengeId = uuid(body.challengeId, 'Challenge ID');
  const nonce = base64url(body.nonce, 'Challenge nonce', 43, 43);
  const terminalDeviceId = deviceId(body.terminalDeviceId);
  const signingPublicKeyBase64 = base64url(body.signingPublicKeyBase64, 'Terminal signing public key', 64, 4096);
  const signature = base64url(body.signature, 'Terminal enrollment proof', 8, 256);
  const context = object(await rpc<unknown>(client, 'r010_get_terminal_enrollment_context', {
    p_challenge_id: challengeId,
  }), 'Terminal enrollment context');
  const state = string(context.state, 'Terminal enrollment state', 16);
  if (state !== 'PENDING' && state !== 'COMPLETE') return genericFailure();
  if (context.requestId !== requestId || context.nonce !== nonce ||
      context.terminalDeviceId !== terminalDeviceId ||
      context.terminalSigningPublicKeyBase64 !== signingPublicKeyBase64) {
    return genericFailure();
  }
  const proof = terminalEnrollmentChallengeBytes({
    requestId,
    challengeId,
    nonceBase64url: nonce,
    terminalDeviceId,
    terminalSigningPublicKeyBase64: signingPublicKeyBase64,
  });
  if (!await verifyP256DerSignature(signingPublicKeyBase64, proof, signature)) return genericFailure();
  if (state === 'COMPLETE') {
    return noStoreJson({ ok: true, envelope: object(context.envelope, 'Terminal admission envelope') });
  }

  const admission = await issueTerminalAdmission(context);
  const envelope = object(await rpc<unknown>(client, 'r010_finalize_terminal_enrollment', {
    p_challenge_id: challengeId,
    p_admission_id: admission.admissionId,
    p_issuer_key_id: admission.issuerKeyId,
    p_payload_base64: admission.payloadBase64,
    p_signature_base64: admission.signature,
    p_payload: admission.payload,
    p_issued_at: admission.issuedAt,
    p_expires_at: admission.expiresAt,
  }), 'Terminal enrollment completion');
  return noStoreJson({ ok: true, envelope });
}

/** A terminal renews only by proving possession of the same Keystore key that
 * the cloud has for an already active, non-revoked terminal. No owner code or
 * browser JWT is accepted on this native endpoint. */
async function beginRenewal(
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const terminalDeviceId = deviceId(body.terminalDeviceId);
  const signingPublicKeyBase64 = base64url(body.signingPublicKeyBase64, 'Terminal signing public key', 64, 4096);
  const deviceHash = await storageHmac('terminal-renewal-device', terminalDeviceId);
  const digest = await requestDigest({ action: 'renew-begin', requestId, terminalDeviceId, signingPublicKeyBase64 });
  const result = object(await rpc<unknown>(client, 'r011_begin_terminal_admission_renewal', {
    p_terminal_device_id: terminalDeviceId,
    p_signing_public_key_base64: signingPublicKeyBase64,
    p_request_id: requestId,
    p_request_digest: digest,
    p_device_hash: deviceHash,
  }), 'Terminal renewal result');
  if (result.ok !== true) return genericFailure();
  return noStoreJson({
    ok: true,
    challengeId: uuid(result.challengeId, 'Challenge ID'),
    nonce: base64url(result.nonce, 'Nonce', 43, 43),
    expiresAt: canonicalUtc(result.expiresAt, 'Challenge expiry'),
    completed: result.completed === true,
  });
}

async function completeRenewal(
  client: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const challengeId = uuid(body.challengeId, 'Challenge ID');
  const nonce = base64url(body.nonce, 'Challenge nonce', 43, 43);
  const terminalDeviceId = deviceId(body.terminalDeviceId);
  const signingPublicKeyBase64 = base64url(body.signingPublicKeyBase64, 'Terminal signing public key', 64, 4096);
  const signature = base64url(body.signature, 'Terminal renewal proof', 8, 256);
  const context = object(await rpc<unknown>(client, 'r011_get_terminal_admission_renewal_context', {
    p_challenge_id: challengeId,
  }), 'Terminal renewal context');
  const state = string(context.state, 'Terminal renewal state', 16);
  if (state !== 'PENDING' && state !== 'COMPLETE') return genericFailure();
  if (context.requestId !== requestId || context.nonce !== nonce ||
      context.terminalDeviceId !== terminalDeviceId ||
      context.terminalSigningPublicKeyBase64 !== signingPublicKeyBase64) {
    return genericFailure();
  }
  const proof = terminalRenewalChallengeBytes({
    requestId,
    challengeId,
    nonceBase64url: nonce,
    terminalDeviceId,
    terminalSigningPublicKeyBase64: signingPublicKeyBase64,
  });
  if (!await verifyP256DerSignature(signingPublicKeyBase64, proof, signature)) return genericFailure();
  if (state === 'COMPLETE') {
    return noStoreJson({ ok: true, envelope: object(context.envelope, 'Terminal admission envelope') });
  }
  const admission = await issueTerminalAdmission(context);
  const envelope = object(await rpc<unknown>(client, 'r011_finalize_terminal_admission_renewal', {
    p_challenge_id: challengeId,
    p_admission_id: admission.admissionId,
    p_issuer_key_id: admission.issuerKeyId,
    p_payload_base64: admission.payloadBase64,
    p_signature_base64: admission.signature,
    p_payload: admission.payload,
    p_issued_at: admission.issuedAt,
    p_expires_at: admission.expiresAt,
  }), 'Terminal renewal completion');
  return noStoreJson({ ok: true, envelope });
}

function deviceId(value: unknown): string {
  const result = string(value, 'Terminal device ID', 200);
  if (!DEVICE_ID.test(result)) throw new HubHttpError(400, 'Terminal device ID is invalid.');
  return result;
}

function role(value: unknown): string {
  const result = string(value, 'Terminal role', 32);
  if (!TERMINAL_ROLES.has(result)) throw new HubHttpError(400, 'Terminal role is invalid.');
  return result;
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = platformServiceKey();
  if (!url || !key) throw new HubConfigurationError('Supabase service configuration is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
