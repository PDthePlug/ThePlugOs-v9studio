import {
  assertCanonicalUtc,
  base64UrlEncode,
  signP256Der,
  utf8,
} from './hub-protocol.ts';
import {
  PlatformApiKeyConfigurationError,
  resolvePlatformApiKey,
} from './platform-api-keys.ts';

export type JsonObject = Record<string, unknown>;

export interface RpcClient {
  rpc(name: string, args?: JsonObject): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface IssuedBundle {
  bundleId: string;
  issuerKeyId: string;
  payload: JsonObject;
  payloadBase64: string;
  signature: string;
  issuedAt: string;
  expiresAt: string;
}

export interface IssuedTerminalAdmission {
  admissionId: string;
  issuerKeyId: string;
  payload: JsonObject;
  payloadBase64: string;
  signature: string;
  issuedAt: string;
  expiresAt: string;
}

/** A compact issuer-signed assertion installed only over an already
 * authenticated local terminal-to-Hub TLS link. It is not a bearer token: a
 * later command still needs the terminal Keystore signature. */
export interface IssuedTerminalStaffSession {
  issuerKeyId: string;
  payload: JsonObject;
  payloadBase64: string;
  signature: string;
  issuedAt: string;
  expiresAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const MAX_BUNDLE_TTL_MINUTES = 12 * 60;

export function noStoreJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Native receivers never accept browser CORS requests or cacheable responses. */
export async function requireNativeJson(request: Request, maxBytes: number): Promise<JsonObject> {
  if (request.method !== 'POST' || request.headers.has('origin')) {
    throw new HubHttpError(405, 'Native POST required.');
  }
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new HubHttpError(413, 'Request is too large.');
  }
  const raw = await request.text();
  if (utf8(raw).byteLength > maxBytes) throw new HubHttpError(413, 'Request is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HubHttpError(400, 'Request must be JSON.');
  }
  return object(parsed, 'Request');
}

export function object(value: unknown, subject: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new HubHttpError(400, `${subject} must be an object.`);
  }
  return value as JsonObject;
}

export function string(value: unknown, subject: string, maxLength = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HubHttpError(400, `${subject} is invalid.`);
  }
  return value.trim();
}

export function optionalString(value: unknown, fallback: string, maxLength = 4096): string {
  if (value === undefined || value === null || value === '') return fallback;
  return string(value, 'Optional value', maxLength);
}

export function uuid(value: unknown, subject: string): string {
  const result = string(value, subject, 36);
  if (!UUID.test(result)) throw new HubHttpError(400, `${subject} is invalid.`);
  return result.toLowerCase();
}

export function base64url(value: unknown, subject: string, minLength = 1, maxLength = 350_000): string {
  const result = string(value, subject, maxLength);
  if (result.length < minLength || !BASE64URL.test(result) || result.length % 4 === 1) {
    throw new HubHttpError(400, `${subject} is invalid.`);
  }
  return result;
}

export function fingerprint(value: unknown, subject: string): string {
  const result = string(value, subject, 64).toLowerCase();
  if (!FINGERPRINT.test(result)) throw new HubHttpError(400, `${subject} is invalid.`);
  return result;
}

export function canonicalUtc(value: unknown, subject: string): string {
  const result = string(value, subject, 24);
  try {
    assertCanonicalUtc(result, subject);
  } catch {
    throw new HubHttpError(400, `${subject} is invalid.`);
  }
  return result;
}

export function withinClockSkew(value: string, now = new Date(), maxSkewMs = 5 * 60_000): void {
  if (Math.abs(Date.parse(value) - now.getTime()) > maxSkewMs) {
    throw new HubHttpError(401, 'Request timestamp is outside the permitted window.');
  }
}

export function requestSource(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unavailable-source';
}

/** HMAC source/device values before they enter the database. */
export async function storageHmac(namespace: string, value: string): Promise<string> {
  const pepper = Deno.env.get('HUB_RATE_LIMIT_PEPPER');
  if (!pepper || pepper.length < 32) throw new HubConfigurationError('Hub rate-limit pepper is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(`${namespace}\u001f${value}`))));
}

export async function requestDigest(value: JsonObject): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(stableJson(value)))));
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new HubHttpError(400, 'Request digest input is invalid.');
  const record = value as JsonObject;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export async function rpc<T>(client: RpcClient, name: string, args: JsonObject): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new HubRpcError(name);
  return data as T;
}

export async function issueAuthorizationBundle(bundleContextValue: unknown, now = new Date()): Promise<IssuedBundle> {
  const context = object(bundleContextValue, 'Bundle context');
  const businessId = uuid(context.businessId, 'Bundle business ID');
  const branchId = uuid(context.branchId, 'Bundle branch ID');
  const hubDeviceId = string(context.hubDeviceId, 'Hub device ID', 200);
  const hubSigningPublicKeyBase64 = base64url(context.hubSigningPublicKeyBase64, 'Hub signing public key', 64, 4096);
  const hubTlsCertificateSha256 = fingerprint(context.hubTlsCertificateSha256, 'Hub TLS certificate fingerprint');
  const revocationVersion = integer(context.revocationVersion, 'Bundle revocation version', 1);
  const pairedDevices = array(context.pairedDevices, 'Paired devices', 1, 64);
  const staffDirectory = array(context.staffDirectory, 'Staff directory', 0, 256);
  const staffSessions = array(context.staffSessions, 'Staff sessions', 0, 256);
  const configuration = object(context.configuration, 'Bundle configuration');

  const issuerKeyId = issuerKeyIdFromEnvironment();
  const privateJwk = issuerPrivateJwkFromEnvironment();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + bundleTtlMinutes() * 60_000).toISOString();
  const payload: JsonObject = {
    schemaVersion: 1,
    bundleId: crypto.randomUUID(),
    businessId,
    branchId,
    hubDeviceId,
    hubSigningPublicKeyBase64,
    hubTlsCertificateSha256,
    issuedAt,
    expiresAt,
    revocationVersion,
    pairedDevices,
    staffDirectory,
    staffSessions,
    configuration,
  };
  // The byte sequence is the authority. Serialize once so the exact decoded
  // payload that Android verifies is also the exact payload Edge signs.
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = utf8(payloadJson);
  const payloadBase64 = base64UrlEncode(payloadBytes);
  const signature = await signP256Der(privateJwk, payloadBytes);
  return {
    bundleId: payload.bundleId as string,
    issuerKeyId,
    payload,
    payloadBase64,
    signature,
    issuedAt,
    expiresAt,
  };
}

/**
 * A terminal admission is intentionally smaller than a Hub bundle. It binds a
 * native terminal key to one active Hub certificate fingerprint so the
 * terminal can discover a nearby Hub without trusting an IP address, BLE
 * advertisement, or browser-provided device record.
 */
export async function issueTerminalAdmission(admissionContextValue: unknown, now = new Date()): Promise<IssuedTerminalAdmission> {
  const context = object(admissionContextValue, 'Terminal admission context');
  const businessId = uuid(context.businessId, 'Terminal business ID');
  const branchId = uuid(context.branchId, 'Terminal branch ID');
  const hubDeviceId = string(context.hubDeviceId, 'Hub device ID', 200);
  const hubTlsCertificateSha256 = fingerprint(context.hubTlsCertificateSha256, 'Hub TLS certificate fingerprint');
  const terminalDeviceId = string(context.terminalDeviceId, 'Terminal device ID', 200);
  const terminalSigningPublicKeyBase64 = base64url(
    context.terminalSigningPublicKeyBase64,
    'Terminal signing public key',
    64,
    4096,
  );
  const terminalRole = string(context.terminalRole, 'Terminal role', 32);
  if (!['CASHIER', 'KITCHEN_STAFF', 'MANAGER'].includes(terminalRole)) {
    throw new HubConfigurationError('Terminal role is invalid.');
  }
  const revocationVersion = integer(context.revocationVersion, 'Terminal admission revocation version', 1);
  const issuerKeyId = issuerKeyIdFromEnvironment();
  const privateJwk = issuerPrivateJwkFromEnvironment();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + bundleTtlMinutes() * 60_000).toISOString();
  const payload: JsonObject = {
    schemaVersion: 1,
    admissionId: crypto.randomUUID(),
    businessId,
    branchId,
    hubDeviceId,
    hubTlsCertificateSha256,
    terminalDeviceId,
    terminalSigningPublicKeyBase64,
    terminalRole,
    issuedAt,
    expiresAt,
    revocationVersion,
    // BLE helps an operator find the right nearby Hub but it never carries
    // commands. LAN and Wi-Fi Direct both terminate in the same pinned TLS
    // local-WebSocket protocol.
    allowedTransports: ['LAN_WIFI', 'WIFI_DIRECT', 'BLE_PROXIMITY'],
  };
  const payloadBytes = utf8(JSON.stringify(payload));
  const payloadBase64 = base64UrlEncode(payloadBytes);
  const signature = await signP256Der(privateJwk, payloadBytes);
  return {
    admissionId: payload.admissionId as string,
    issuerKeyId,
    payload,
    payloadBase64,
    signature,
    issuedAt,
    expiresAt,
  };
}

/**
 * Issues the native-only terminal staff-session assertion defined by ADR-010.
 * Its input comes exclusively from a service-only database RPC after a fresh
 * PIN check and terminal-key proof; callers cannot supply tenancy or role
 * facts from a browser.
 */
export async function issueTerminalStaffSession(
  sessionContextValue: unknown,
  now = new Date(),
): Promise<IssuedTerminalStaffSession> {
  const context = object(sessionContextValue, 'Terminal staff-session context');
  const sessionId = uuid(context.sessionId, 'Terminal staff-session ID');
  const staffId = uuid(context.staffId, 'Terminal staff ID');
  const businessId = uuid(context.businessId, 'Terminal staff-session business ID');
  const branchId = uuid(context.branchId, 'Terminal staff-session branch ID');
  const hubDeviceId = string(context.hubDeviceId, 'Terminal staff-session Hub device ID', 200);
  const terminalDeviceId = string(context.terminalDeviceId, 'Terminal staff-session device ID', 200);
  const terminalSigningPublicKeyBase64 = base64url(
    context.terminalSigningPublicKeyBase64,
    'Terminal staff-session signing public key',
    64,
    4096,
  );
  const role = string(context.role, 'Terminal staff-session role', 32);
  if (!['CASHIER', 'KITCHEN_STAFF', 'MANAGER'].includes(role)) {
    throw new HubConfigurationError('Terminal staff-session role is invalid.');
  }
  const revocationVersion = integer(context.revocationVersion, 'Terminal staff-session revocation version', 1);
  const expiresAt = canonicalUtc(context.expiresAt, 'Terminal staff-session expiry');
  const expiryMs = Date.parse(expiresAt);
  if (expiryMs <= now.getTime() || expiryMs > now.getTime() + MAX_BUNDLE_TTL_MINUTES * 60_000 + 5 * 60_000) {
    throw new HubConfigurationError('Terminal staff-session expiry is invalid.');
  }

  const issuerKeyId = issuerKeyIdFromEnvironment();
  const privateJwk = issuerPrivateJwkFromEnvironment();
  const issuedAt = now.toISOString();
  const payload: JsonObject = {
    schemaVersion: 1,
    sessionId,
    staffId,
    businessId,
    branchId,
    hubDeviceId,
    terminalDeviceId,
    terminalSigningPublicKeyBase64,
    role,
    issuedAt,
    expiresAt,
    revocationVersion,
  };
  const payloadBytes = utf8(JSON.stringify(payload));
  const payloadBase64 = base64UrlEncode(payloadBytes);
  const signature = await signP256Der(privateJwk, payloadBytes);
  return { issuerKeyId, payload, payloadBase64, signature, issuedAt, expiresAt };
}

export function genericFailure(status = 401): Response {
  return noStoreJson({ ok: false, error: 'The native authorization request could not be accepted.' }, status);
}

export class HubHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class HubRpcError extends Error {
  constructor(readonly operation: string) {
    super(`Hub RPC failed: ${operation}`);
  }
}

export class HubConfigurationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Platform-managed API credentials only; callers can never supply these. */
export function platformPublishableKey(): string {
  return platformApiKey('publishable');
}

export function platformServiceKey(): string {
  return platformApiKey('secret');
}

function platformApiKey(kind: 'publishable' | 'secret'): string {
  try {
    return resolvePlatformApiKey(kind, (name) => Deno.env.get(name));
  } catch (error) {
    if (error instanceof PlatformApiKeyConfigurationError) {
      throw new HubConfigurationError('Supabase API-key configuration is invalid.');
    }
    throw error;
  }
}

function array(value: unknown, subject: string, minLength: number, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    throw new HubConfigurationError(`${subject} is invalid.`);
  }
  return value;
}

function integer(value: unknown, subject: string, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new HubConfigurationError(`${subject} is invalid.`);
  }
  return value;
}

function issuerKeyIdFromEnvironment(): string {
  const value = Deno.env.get('HUB_AUTHORIZATION_ISSUER_KEY_ID');
  if (!value || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new HubConfigurationError('Hub issuer key ID is not configured.');
  }
  return value;
}

function issuerPrivateJwkFromEnvironment(): JsonWebKey {
  const raw = Deno.env.get('HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON');
  if (!raw) throw new HubConfigurationError('Hub issuer private key is not configured.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HubConfigurationError('Hub issuer private key is invalid.');
  }
  const jwk = object(parsed, 'Hub issuer private key') as JsonWebKey;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') {
    throw new HubConfigurationError('Hub issuer private key is invalid.');
  }
  return jwk;
}

function bundleTtlMinutes(): number {
  const raw = Deno.env.get('HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES') || String(MAX_BUNDLE_TTL_MINUTES);
  if (!/^\d+$/.test(raw)) throw new HubConfigurationError('Hub bundle TTL is invalid.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 15 || value > MAX_BUNDLE_TTL_MINUTES) {
    throw new HubConfigurationError('Hub bundle TTL is invalid.');
  }
  return value;
}
