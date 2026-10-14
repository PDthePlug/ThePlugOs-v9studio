import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const MAX_TTL_MINUTES = 12 * 60;
const DEFAULT_OWNER_ORIGIN = 'https://theplugos-v9studio.vercel.app';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value.`);
  return value;
}

const outDir = resolve(arg('--out-dir', process.cwd()));
const ownerOrigin = arg('--owner-origin', DEFAULT_OWNER_ORIGIN);
const ttlRaw = arg('--ttl-minutes', String(MAX_TTL_MINUTES));
const keyLabel = arg('--key-label', 'theplugos-staging');

let parsedOrigin;
try {
  parsedOrigin = new URL(ownerOrigin);
} catch {
  fail('Owner origin must be a valid HTTPS origin.');
}
if (
  parsedOrigin.protocol !== 'https:' ||
  parsedOrigin.username ||
  parsedOrigin.password ||
  parsedOrigin.search ||
  parsedOrigin.hash ||
  (parsedOrigin.pathname !== '/' && parsedOrigin.pathname !== '')
) {
  fail('Owner origin must be a bare HTTPS origin.');
}
const canonicalOwnerOrigin = parsedOrigin.origin;

if (!/^\d+$/.test(ttlRaw)) fail('TTL must be an integer number of minutes.');
const ttlMinutes = Number(ttlRaw);
if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < 15 || ttlMinutes > MAX_TTL_MINUTES) {
  fail(`TTL must be between 15 and ${MAX_TTL_MINUTES} minutes.`);
}
if (!/^[A-Za-z0-9._-]{1,80}$/.test(keyLabel)) {
  fail('Key label contains unsupported characters.');
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateJwk = privateKey.export({ format: 'jwk' });
const publicJwk = publicKey.export({ format: 'jwk' });
if (
  privateJwk.kty !== 'EC' ||
  privateJwk.crv !== 'P-256' ||
  typeof privateJwk.d !== 'string' ||
  publicJwk.kty !== 'EC' ||
  publicJwk.crv !== 'P-256' ||
  typeof publicJwk.x !== 'string' ||
  typeof publicJwk.y !== 'string'
) {
  fail('Generated issuer material is not a P-256 JWK pair.');
}

const publicCanonical = JSON.stringify({
  kty: publicJwk.kty,
  crv: publicJwk.crv,
  x: publicJwk.x,
  y: publicJwk.y,
});
const publicJwkFingerprint = createHash('sha256').update(publicCanonical).digest('hex');
const publicSpkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
if (!/^[A-Za-z0-9_-]{64,4096}$/.test(publicSpkiBase64)) {
  fail('Generated issuer SPKI public key is invalid.');
}
const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const issuerKeyId = `${keyLabel}.${date}.${publicJwkFingerprint.slice(0, 16)}`;
if (!/^[A-Za-z0-9._-]{1,128}$/.test(issuerKeyId)) fail('Generated issuer key ID is invalid.');
const configurationFingerprint = createHash('sha256')
  .update(`${issuerKeyId}\n${publicSpkiBase64}`, 'utf8')
  .digest('hex');

const rateLimitPepper = randomBytes(32).toString('base64url');
if (rateLimitPepper.length < 32) fail('Generated rate-limit pepper is too short.');

await mkdir(outDir, { recursive: true });
const privatePath = resolve(outDir, '.env.theplugos-staging.local');
const publicPath = resolve(outDir, '.env.theplugos-staging.public');

const privateEnv = [
  `HUB_AUTHORIZATION_ISSUER_KEY_ID=${issuerKeyId}`,
  `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON='${JSON.stringify(privateJwk)}'`,
  `HUB_RATE_LIMIT_PEPPER=${rateLimitPepper}`,
  `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES=${ttlMinutes}`,
  `HUB_OWNER_PORTAL_ORIGIN=${canonicalOwnerOrigin}`,
  '',
].join('\n');

const publicEnv = [
  `HUB_AUTHORIZATION_ISSUER_KEY_ID=${issuerKeyId}`,
  `HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64=${publicSpkiBase64}`,
  `HUB_AUTHORIZATION_ISSUER_PUBLIC_JWK_JSON='${publicCanonical}'`,
  `HUB_AUTHORIZATION_ISSUER_PUBLIC_JWK_SHA256=${publicJwkFingerprint}`,
  `HUB_AUTHORIZATION_ISSUER_CONFIGURATION_SHA256=${configurationFingerprint}`,
  `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES=${ttlMinutes}`,
  `HUB_OWNER_PORTAL_ORIGIN=${canonicalOwnerOrigin}`,
  '',
].join('\n');

await writeFile(privatePath, privateEnv, { mode: 0o600, flag: 'wx' });
await writeFile(publicPath, publicEnv, { mode: 0o600, flag: 'wx' });

console.log('Generated ThePlugOS staging issuer material.');
console.log(`Private material: ${privatePath}`);
console.log(`Public material:  ${publicPath}`);
console.log(`Issuer key ID:    ${issuerKeyId}`);
console.log(`Public JWK SHA-256: ${publicJwkFingerprint}`);
console.log(`Issuer configuration SHA-256: ${configurationFingerprint}`);
console.log('Private JWK and rate-limit pepper were not printed.');
