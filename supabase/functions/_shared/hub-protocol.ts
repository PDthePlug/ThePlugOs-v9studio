/**
 * Wire-level helpers shared by Supabase Edge Functions and protocol smoke
 * tests. P-256 Web Crypto exposes fixed-width IEEE-P1363 signatures whereas
 * Android's SHA256withECDSA expects ASN.1 DER, so conversion is explicit and
 * strict at the cloud/native boundary.
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const P256_COORDINATE_BYTES = 32;
const P256_RAW_SIGNATURE_BYTES = P256_COORDINATE_BYTES * 2;

export function assertCanonicalUtc(value: string, subject: string): void {
  if (!CANONICAL_UTC.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${subject} must use canonical UTC millisecond format.`);
  }
}

export function canonicalUtcNow(now = new Date()): string {
  return now.toISOString();
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlDecode(value: string, subject = 'base64url value'): Uint8Array {
  if (!value || !BASE64URL.test(value) || value.length % 4 === 1) {
    throw new Error(`${subject} is not valid base64url.`);
  }
  const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (value.length % 4)) % 4)}`;
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(`${subject} is not valid base64url.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8JsonObjectFromBase64Url(value: string, subject: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(value, subject)));
  } catch {
    throw new Error(`${subject} must decode to a JSON object.`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${subject} must decode to a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/** The exact command byte sequence specified in the local-first protocol. */
export function commandBytes(command: {
  commandId: string;
  type: string;
  issuedAt: string;
  deviceId: string;
  staffSessionId: string;
  sequence: number;
  payloadBase64: string;
}): Uint8Array {
  if (!Number.isSafeInteger(command.sequence) || command.sequence < 0) throw new Error('Command sequence must be a non-negative safe integer.');
  assertCanonicalUtc(command.issuedAt, 'Command issuedAt');
  const fields = [
    command.commandId,
    command.type,
    command.issuedAt,
    command.deviceId,
    command.staffSessionId,
    String(command.sequence),
    command.payloadBase64,
  ];
  if (fields.some((field) => !field || field.includes('\u001f'))) throw new Error('Command fields are missing or contain the protocol separator.');
  return utf8(fields.join('\u001f'));
}

/** The exact proof bytes for a native Hub enrollment challenge. */
export function enrollmentChallengeBytes(proof: {
  requestId: string;
  challengeId: string;
  nonceBase64url: string;
  hubSigningPublicKeyBase64: string;
  hubTlsCertificateSha256: string;
}): Uint8Array {
  return lineProtocolBytes('theplugos.enrollment.v1', [
    proof.requestId,
    proof.challengeId,
    proof.nonceBase64url,
    proof.hubSigningPublicKeyBase64,
    proof.hubTlsCertificateSha256,
  ]);
}

/** Exact proof bytes for a non-Hub Android terminal enrollment challenge. */
export function terminalEnrollmentChallengeBytes(proof: {
  requestId: string;
  challengeId: string;
  nonceBase64url: string;
  terminalDeviceId: string;
  terminalSigningPublicKeyBase64: string;
}): Uint8Array {
  return lineProtocolBytes('theplugos.terminal-enrollment.v1', [
    proof.requestId,
    proof.challengeId,
    proof.nonceBase64url,
    proof.terminalDeviceId,
    proof.terminalSigningPublicKeyBase64,
  ]);
}

/** Exact proof bytes for renewal of an existing terminal admission. */
export function terminalRenewalChallengeBytes(proof: {
  requestId: string;
  challengeId: string;
  nonceBase64url: string;
  terminalDeviceId: string;
  terminalSigningPublicKeyBase64: string;
}): Uint8Array {
  return lineProtocolBytes('theplugos.terminal-renewal.v1', [
    proof.requestId,
    proof.challengeId,
    proof.nonceBase64url,
    proof.terminalDeviceId,
    proof.terminalSigningPublicKeyBase64,
  ]);
}

/** The proof that authorizes a bundle renewal for the currently active Hub. */
export function bundleRenewalBytes(request: {
  requestId: string;
  hubDeviceId: string;
  bundleId: string;
  issuedAt: string;
}): Uint8Array {
  assertCanonicalUtc(request.issuedAt, 'Bundle renewal issuedAt');
  return lineProtocolBytes('theplugos.bundle-renewal.v1', [
    request.requestId,
    request.hubDeviceId,
    request.bundleId,
    request.issuedAt,
  ]);
}

/** The proof that gates a native-only fresh staff-session completion. */
export function staffSessionChallengeBytes(proof: {
  requestId: string;
  challengeId: string;
  nonceBase64url: string;
  hubDeviceId: string;
  staffId: string;
}): Uint8Array {
  return lineProtocolBytes('theplugos.staff-session.v1', [
    proof.requestId,
    proof.challengeId,
    proof.nonceBase64url,
    proof.hubDeviceId,
    proof.staffId,
  ]);
}

/** The proof that binds a fresh native terminal staff session to both the
 * already admitted terminal key and the branch's active Hub. */
export function terminalStaffSessionChallengeBytes(proof: {
  requestId: string;
  challengeId: string;
  nonceBase64url: string;
  terminalDeviceId: string;
  hubDeviceId: string;
  staffId: string;
}): Uint8Array {
  return lineProtocolBytes('theplugos.terminal-staff-session.v1', [
    proof.requestId,
    proof.challengeId,
    proof.nonceBase64url,
    proof.terminalDeviceId,
    proof.hubDeviceId,
    proof.staffId,
  ]);
}

/** The proof that binds a native-only owner-authorized PIN reset to one Hub. */
export function staffCredentialResetChallengeBytes(proof: {
  requestId: string;
  challengeId: string;
  nonceBase64url: string;
  hubDeviceId: string;
  staffId: string;
}): Uint8Array {
  return lineProtocolBytes('theplugos.staff-credential-reset.v1', [
    proof.requestId,
    proof.challengeId,
    proof.nonceBase64url,
    proof.hubDeviceId,
    proof.staffId,
  ]);
}

/** The exact request proof for an immutable cloud-replication batch. */
export function syncRequestBytes(request: {
  requestId: string;
  hubDeviceId: string;
  bundleId: string;
  issuedAt: string;
  payloadBase64: string;
}): Uint8Array {
  assertCanonicalUtc(request.issuedAt, 'Hub sync issuedAt');
  return lineProtocolBytes('theplugos.sync.v1', [
    request.requestId,
    request.hubDeviceId,
    request.bundleId,
    request.issuedAt,
    request.payloadBase64,
  ]);
}

/** Converts Web Crypto's 64-byte P-256 r||s signature to strict ASN.1 DER. */
export function p256RawSignatureToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== P256_RAW_SIGNATURE_BYTES) throw new Error('P-256 raw signature must be 64 bytes.');
  const r = derInteger(raw.subarray(0, P256_COORDINATE_BYTES));
  const s = derInteger(raw.subarray(P256_COORDINATE_BYTES));
  const body = concat(Uint8Array.of(0x02, r.length), r, Uint8Array.of(0x02, s.length), s);
  return concat(Uint8Array.of(0x30, body.length), body);
}

/** Converts strict ASN.1 DER P-256 signatures to Web Crypto's 64-byte r||s. */
export function p256DerSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) {
    throw new Error('ECDSA signature is not strict short-form DER.');
  }
  let offset = 2;
  const r = readDerInteger(der, () => offset, (next) => { offset = next; });
  const s = readDerInteger(der, () => offset, (next) => { offset = next; });
  if (offset !== der.length) throw new Error('ECDSA signature has trailing DER data.');
  return concat(leftPad(r, P256_COORDINATE_BYTES), leftPad(s, P256_COORDINATE_BYTES));
}

export async function signP256Der(privateJwk: JsonWebKey, bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes));
  return base64UrlEncode(p256RawSignatureToDer(raw));
}

export async function verifyP256DerSignature(publicKeySpkiBase64Url: string, bytes: Uint8Array, signatureBase64Url: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      base64UrlDecode(publicKeySpkiBase64Url, 'P-256 public key'),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      p256DerSignatureToRaw(base64UrlDecode(signatureBase64Url, 'ECDSA signature')),
      bytes,
    );
  } catch {
    return false;
  }
}

function derInteger(source: Uint8Array): Uint8Array {
  let first = 0;
  while (first < source.length - 1 && source[first] === 0) first += 1;
  const compact = source.subarray(first);
  return compact[0] >= 0x80 ? concat(Uint8Array.of(0), compact) : compact;
}

function readDerInteger(source: Uint8Array, getOffset: () => number, setOffset: (offset: number) => void): Uint8Array {
  let offset = getOffset();
  if (source[offset] !== 0x02) throw new Error('ECDSA signature is missing an INTEGER.');
  const length = source[offset + 1];
  offset += 2;
  if (!length || length > P256_COORDINATE_BYTES + 1 || offset + length > source.length) {
    throw new Error('ECDSA signature INTEGER length is invalid.');
  }
  const integer = source.subarray(offset, offset + length);
  if (integer[0] & 0x80) throw new Error('ECDSA signature INTEGER is negative.');
  if (integer.length > 1 && integer[0] === 0 && integer[1] < 0x80) {
    throw new Error('ECDSA signature INTEGER is not minimally encoded.');
  }
  const unsigned = integer.length > 1 && integer[0] === 0 ? integer.subarray(1) : integer;
  if (unsigned.length > P256_COORDINATE_BYTES) throw new Error('ECDSA signature INTEGER exceeds P-256 width.');
  setOffset(offset + length);
  return unsigned;
}

function leftPad(value: Uint8Array, length: number): Uint8Array {
  if (!value.length || value.length > length) throw new Error('ECDSA signature coordinate length is invalid.');
  const padded = new Uint8Array(length);
  padded.set(value, length - value.length);
  return padded;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function lineProtocolBytes(protocol: string, fields: string[]): Uint8Array {
  if (!protocol || protocol.includes('\n') || protocol.includes('\r')) {
    throw new Error('Protocol name is invalid.');
  }
  if (fields.some((field) => !field || field.includes('\n') || field.includes('\r'))) {
    throw new Error('Protocol fields are missing or contain a line break.');
  }
  return utf8([protocol, ...fields].join('\n'));
}
