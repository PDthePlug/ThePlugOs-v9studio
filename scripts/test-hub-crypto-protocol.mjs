import {
  base64UrlEncode,
  bundleRenewalBytes,
  commandBytes,
  enrollmentChallengeBytes,
  p256DerSignatureToRaw,
  p256RawSignatureToDer,
  signP256Der,
  staffCredentialResetChallengeBytes,
  staffSessionChallengeBytes,
  syncRequestBytes,
  terminalEnrollmentChallengeBytes,
  terminalRenewalChallengeBytes,
  verifyP256DerSignature,
} from '../supabase/functions/_shared/hub-protocol.ts';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicSpki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
const payload = commandBytes({
  commandId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  type: 'order.create',
  issuedAt: '2026-08-15T10:00:00.000Z',
  deviceId: 'b0e80e50-19df-455b-a3d0-d32b4d88d62e',
  staffSessionId: 'd0e1e97c-50e7-48c2-8e70-39c4bc7ef9f4',
  sequence: 42,
  payloadBase64: base64UrlEncode(new TextEncoder().encode('{"orderId":"3eaa11eb-03f3-47e8-bb1d-ac38aee3d3fa"}')),
});

const signature = await signP256Der(privateJwk, payload);
if (!await verifyP256DerSignature(base64UrlEncode(publicSpki), payload, signature)) {
  throw new Error('Valid DER P-256 signature did not verify.');
}
if (await verifyP256DerSignature(base64UrlEncode(publicSpki), new Uint8Array([...payload, 0]), signature)) {
  throw new Error('Tampered payload unexpectedly verified.');
}

const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, payload));
const roundTrip = p256DerSignatureToRaw(p256RawSignatureToDer(raw));
if (roundTrip.length !== raw.length || !roundTrip.every((value, index) => value === raw[index])) {
  throw new Error('P-256 raw/DER conversion did not round-trip.');
}

const enrollment = enrollmentChallengeBytes({
  requestId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  challengeId: 'a0e80e50-19df-455b-a3d0-d32b4d88d62e',
  nonceBase64url: base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))),
  hubSigningPublicKeyBase64: base64UrlEncode(publicSpki),
  hubTlsCertificateSha256: 'a'.repeat(64),
});
if (!await verifyP256DerSignature(base64UrlEncode(publicSpki), enrollment, await signP256Der(privateJwk, enrollment))) {
  throw new Error('Enrollment proof did not verify.');
}

const renewal = bundleRenewalBytes({
  requestId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  hubDeviceId: 'a0e80e50-19df-455b-a3d0-d32b4d88d62e',
  bundleId: 'd0e1e97c-50e7-48c2-8e70-39c4bc7ef9f4',
  issuedAt: '2026-08-15T10:00:00.000Z',
});
const staffSession = staffSessionChallengeBytes({
  requestId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  challengeId: 'd0e1e97c-50e7-48c2-8e70-39c4bc7ef9f4',
  nonceBase64url: base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))),
  hubDeviceId: 'a0e80e50-19df-455b-a3d0-d32b4d88d62e',
  staffId: '3eaa11eb-03f3-47e8-bb1d-ac38aee3d3fa',
});
const staffCredentialReset = staffCredentialResetChallengeBytes({
  requestId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  challengeId: 'd0e1e97c-50e7-48c2-8e70-39c4bc7ef9f4',
  nonceBase64url: base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))),
  hubDeviceId: 'a0e80e50-19df-455b-a3d0-d32b4d88d62e',
  staffId: '3eaa11eb-03f3-47e8-bb1d-ac38aee3d3fa',
});
const terminalEnrollment = terminalEnrollmentChallengeBytes({
  requestId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  challengeId: 'a0e80e50-19df-455b-a3d0-d32b4d88d62e',
  nonceBase64url: base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))),
  terminalDeviceId: 'terminal-3eaa11eb-03f3-47e8-bb1d-ac38aee3d3fa',
  terminalSigningPublicKeyBase64: base64UrlEncode(publicSpki),
});
const terminalRenewal = terminalRenewalChallengeBytes({
  requestId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  challengeId: 'b0e80e50-19df-455b-a3d0-d32b4d88d62e',
  nonceBase64url: base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))),
  terminalDeviceId: 'terminal-3eaa11eb-03f3-47e8-bb1d-ac38aee3d3fa',
  terminalSigningPublicKeyBase64: base64UrlEncode(publicSpki),
});
const sync = syncRequestBytes({
  requestId: '32a7459c-03b3-4e57-ae30-f04ad49cc34f',
  hubDeviceId: 'a0e80e50-19df-455b-a3d0-d32b4d88d62e',
  bundleId: 'd0e1e97c-50e7-48c2-8e70-39c4bc7ef9f4',
  issuedAt: '2026-08-15T10:00:00.000Z',
  payloadBase64: base64UrlEncode(new TextEncoder().encode('{"events":[]}')),
});
for (const bytes of [renewal, staffSession, staffCredentialReset, terminalEnrollment, terminalRenewal, sync]) {
  if (!await verifyP256DerSignature(base64UrlEncode(publicSpki), bytes, await signP256Der(privateJwk, bytes))) {
    throw new Error('A canonical Hub protocol proof did not verify.');
  }
}

console.log('hub crypto protocol smoke passed');
