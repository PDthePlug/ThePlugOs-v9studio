#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

if (process.argv.length !== 3 || process.argv[2] !== '--emit-fingerprint') {
  fail('Usage: node scripts/verify-issuer-key-configuration.mjs --emit-fingerprint');
}

const issuerKeyId = process.env.HUB_AUTHORIZATION_ISSUER_KEY_ID;
const rawPrivateJwk = process.env.HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON;
const suppliedPublicSpki = process.env.HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64;

if (typeof issuerKeyId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(issuerKeyId)) {
  fail('HUB_AUTHORIZATION_ISSUER_KEY_ID must be a stable public issuer key label.');
}
if (typeof rawPrivateJwk !== 'string' || rawPrivateJwk.length > 8192) {
  fail('HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON is missing or invalid.');
}
if (typeof suppliedPublicSpki !== 'string' || !/^[A-Za-z0-9_-]{64,4096}$/.test(suppliedPublicSpki)) {
  fail('HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64 must be a canonical Base64URL SPKI public key.');
}

let privateJwk;
try {
  privateJwk = JSON.parse(rawPrivateJwk);
} catch {
  fail('HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON is missing or invalid.');
}

if (
  !privateJwk ||
  typeof privateJwk !== 'object' ||
  privateJwk.kty !== 'EC' ||
  privateJwk.crv !== 'P-256' ||
  typeof privateJwk.d !== 'string' ||
  typeof privateJwk.x !== 'string' ||
  typeof privateJwk.y !== 'string'
) {
  fail('HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON must contain a P-256 private JWK.');
}

let derivedPublicSpki;
try {
  const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' });
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    fail('HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON must contain a P-256 private JWK.');
  }
  derivedPublicSpki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64url');
} catch {
  fail('HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON must contain a valid P-256 private JWK.');
}

let canonicalSuppliedPublicSpki;
try {
  canonicalSuppliedPublicSpki = Buffer.from(suppliedPublicSpki, 'base64url').toString('base64url');
} catch {
  fail('HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64 must be a canonical Base64URL SPKI public key.');
}

if (canonicalSuppliedPublicSpki !== suppliedPublicSpki || derivedPublicSpki !== suppliedPublicSpki) {
  fail('The supplied Android issuer public key does not match the P-256 private JWK.');
}

const fingerprint = createHash('sha256')
  .update(`${issuerKeyId}\n${derivedPublicSpki}`, 'utf8')
  .digest('hex');
process.stdout.write(`${fingerprint}\n`);
