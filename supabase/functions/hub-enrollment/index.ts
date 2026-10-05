import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  bundleRenewalBytes,
  enrollmentChallengeBytes,
  verifyP256DerSignature,
} from '../_shared/hub-protocol.ts';
import {
  HubConfigurationError,
  HubHttpError,
  base64url,
  canonicalUtc,
  fingerprint,
  genericFailure,
  issueAuthorizationBundle,
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
  withinClockSkew,
} from '../_shared/hub-edge.ts';

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

Deno.serve(async (request) => {
  try {
    const body = await requireNativeJson(request, 128 * 1024);
    const action = string(body.action, 'Action', 16);
    const client = serviceClient();
    if (action === 'begin') return await beginEnrollment(request, client, body);
    if (action === 'complete') return await completeEnrollment(client, body);
    if (action === 'renew') return await renewEnrollment(client, body);
    if (action === 'reconcile') return await reconcileEnrollment(client, body);
    throw new HubHttpError(400, 'Action is invalid.');
  } catch (error) {
    if (error instanceof HubHttpError) return genericFailure(error.status === 413 ? 413 : 400);
    if (error instanceof HubConfigurationError) return genericFailure(503);
    return genericFailure();
  }
});

async function beginEnrollment(request: Request, client: ReturnType<typeof serviceClient>, body: Record<string, unknown>): Promise<Response> {
  const pairingCode = string(body.pairingCode, 'Pairing code', 6);
  if (!/^\d{6}$/.test(pairingCode)) throw new HubHttpError(400, 'Pairing code is invalid.');
  const requestId = uuid(body.requestId, 'Request ID');
  const hubDeviceId = deviceId(body.hubDeviceId);
  const hubName = optionalString(body.hubName, 'Cashier Hub', 120);
  const signingPublicKeyBase64 = base64url(body.signingPublicKeyBase64, 'Hub signing public key', 64, 4096);
  const tlsCertificateBase64 = base64url(body.tlsCertificateBase64, 'Hub TLS certificate', 128, 32768);
  const tlsCertificateSha256 = fingerprint(body.tlsCertificateSha256, 'Hub TLS certificate fingerprint');
  const sourceHash = await storageHmac('enrollment-source', requestSource(request));
  const deviceHash = await storageHmac('enrollment-device', hubDeviceId);
  const digest = await requestDigest({
    action: 'begin', requestId, hubDeviceId, hubName, signingPublicKeyBase64,
    tlsCertificateBase64, tlsCertificateSha256,
  });
  const result = object(await rpc<unknown>(client, 'r003_begin_hub_enrollment', {
    p_pairing_code: pairingCode,
    p_request_id: requestId,
    p_request_digest: digest,
    p_source_hash: sourceHash,
    p_device_hash: deviceHash,
    p_hub_device_id: hubDeviceId,
    p_hub_name: hubName,
    p_signing_public_key_base64: signingPublicKeyBase64,
    p_tls_certificate_base64: tlsCertificateBase64,
    p_tls_certificate_sha256: tlsCertificateSha256,
  }), 'Enrollment result');
  if (result.ok !== true) return genericFailure();
  return noStoreJson({
    ok: true,
    challengeId: string(result.challengeId, 'Challenge ID', 36),
    nonce: base64url(result.nonce, 'Nonce', 43, 43),
    expiresAt: canonicalUtc(result.expiresAt, 'Challenge expiry'),
    completed: result.completed === true,
  });
}

async function completeEnrollment(client: ReturnType<typeof serviceClient>, body: Record<string, unknown>): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const challengeId = uuid(body.challengeId, 'Challenge ID');
  const nonce = base64url(body.nonce, 'Challenge nonce', 43, 43);
  const hubDeviceId = deviceId(body.hubDeviceId);
  const signingPublicKeyBase64 = base64url(body.signingPublicKeyBase64, 'Hub signing public key', 64, 4096);
  const tlsCertificateSha256 = fingerprint(body.tlsCertificateSha256, 'Hub TLS certificate fingerprint');
  const signature = base64url(body.signature, 'Enrollment proof', 8, 256);
  const context = object(await rpc<unknown>(client, 'r003_get_hub_enrollment_context', {
    p_challenge_id: challengeId,
  }), 'Enrollment context');
  const state = string(context.state, 'Enrollment state', 16);
  if (state !== 'PENDING' && state !== 'COMPLETE') return genericFailure();
  if (context.requestId !== requestId || context.hubSigningPublicKeyBase64 !== signingPublicKeyBase64) return genericFailure();
  if (context.nonce !== nonce || context.hubDeviceId !== hubDeviceId || context.hubTlsCertificateSha256 !== tlsCertificateSha256) {
    return genericFailure();
  }
  const proof = enrollmentChallengeBytes({
    requestId,
    challengeId,
    nonceBase64url: nonce,
    hubSigningPublicKeyBase64: signingPublicKeyBase64,
    hubTlsCertificateSha256: tlsCertificateSha256,
  });
  if (!await verifyP256DerSignature(signingPublicKeyBase64, proof, signature)) return genericFailure();
  if (state === 'COMPLETE') return noStoreJson({ ok: true, envelope: object(context.envelope, 'Enrollment envelope') });

  const issued = await issueAuthorizationBundle(context.bundleContext);
  const envelope = object(await rpc<unknown>(client, 'r003_finalize_hub_enrollment', {
    p_challenge_id: challengeId,
    p_bundle_id: issued.bundleId,
    p_issuer_key_id: issued.issuerKeyId,
    p_payload_base64: issued.payloadBase64,
    p_signature_base64: issued.signature,
    p_payload: issued.payload,
    p_issued_at: issued.issuedAt,
    p_expires_at: issued.expiresAt,
  }), 'Enrollment completion');
  return noStoreJson({ ok: true, envelope });
}

async function renewEnrollment(client: ReturnType<typeof serviceClient>, body: Record<string, unknown>): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const hubDeviceId = deviceId(body.hubDeviceId);
  const bundleId = uuid(body.bundleId, 'Bundle ID');
  const issuedAt = canonicalUtc(body.issuedAt, 'Renewal issued time');
  withinClockSkew(issuedAt);
  const signature = base64url(body.signature, 'Renewal proof', 8, 256);
  const deviceHash = await storageHmac('renewal-device', hubDeviceId);
  const digest = await requestDigest({ action: 'renew', requestId, hubDeviceId, bundleId, issuedAt });
  const context = object(await rpc<unknown>(client, 'r003_get_hub_renewal_context', {
    p_hub_device_id: hubDeviceId,
    p_bundle_id: bundleId,
    p_request_id: requestId,
    p_request_digest: digest,
    p_device_hash: deviceHash,
  }), 'Renewal context');
  const state = string(context.state, 'Renewal state', 16);
  if (state === 'COMPLETE') {
    const key = base64url(context.hubSigningPublicKeyBase64, 'Hub signing public key', 64, 4096);
    const valid = await verifyRenewal(key, requestId, hubDeviceId, bundleId, issuedAt, signature);
    return valid ? noStoreJson({ ok: true, envelope: object(context.envelope, 'Renewal envelope') }) : genericFailure();
  }
  if (state !== 'ACTIVE') return genericFailure();
  const key = base64url(context.hubSigningPublicKeyBase64, 'Hub signing public key', 64, 4096);
  if (!await verifyRenewal(key, requestId, hubDeviceId, bundleId, issuedAt, signature)) return genericFailure();
  const issued = await issueAuthorizationBundle(context.bundleContext);
  const envelope = object(await rpc<unknown>(client, 'r003_finalize_hub_renewal', {
    p_request_id: requestId,
    p_hub_device_id: hubDeviceId,
    p_current_bundle_id: bundleId,
    p_bundle_id: issued.bundleId,
    p_issuer_key_id: issued.issuerKeyId,
    p_payload_base64: issued.payloadBase64,
    p_signature_base64: issued.signature,
    p_payload: issued.payload,
    p_issued_at: issued.issuedAt,
    p_expires_at: issued.expiresAt,
  }), 'Renewal completion');
  return noStoreJson({ ok: true, envelope });
}

/**
 * Polls the signed authority revision without needlessly replacing a healthy
 * bundle. A terminal enrollment or revocation changes this revision; the Hub
 * then follows the exact existing renewal path so its local device registry is
 * replaced atomically from a new cloud-signed bundle.
 */
async function reconcileEnrollment(client: ReturnType<typeof serviceClient>, body: Record<string, unknown>): Promise<Response> {
  const requestId = uuid(body.requestId, 'Request ID');
  const hubDeviceId = deviceId(body.hubDeviceId);
  const bundleId = uuid(body.bundleId, 'Bundle ID');
  const issuedAt = canonicalUtc(body.issuedAt, 'Reconciliation issued time');
  withinClockSkew(issuedAt);
  const signature = base64url(body.signature, 'Reconciliation proof', 8, 256);
  const deviceHash = await storageHmac('authority-status-device', hubDeviceId);
  const status = object(await rpc<unknown>(client, 'r010_get_hub_authority_status', {
    p_hub_device_id: hubDeviceId,
    p_bundle_id: bundleId,
    p_device_hash: deviceHash,
  }), 'Hub authority status');
  const state = string(status.state, 'Hub authority state', 16);
  const key = base64url(status.hubSigningPublicKeyBase64, 'Hub signing public key', 64, 4096);
  if (!await verifyRenewal(key, requestId, hubDeviceId, bundleId, issuedAt, signature)) return genericFailure();
  if (state === 'UNCHANGED') return noStoreJson({ ok: true, changed: false });
  if (state !== 'CHANGED') return genericFailure();
  return renewEnrollment(client, body);
}

async function verifyRenewal(
  key: string,
  requestId: string,
  hubDeviceId: string,
  bundleId: string,
  issuedAt: string,
  signature: string,
): Promise<boolean> {
  return verifyP256DerSignature(key, bundleRenewalBytes({ requestId, hubDeviceId, bundleId, issuedAt }), signature);
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
