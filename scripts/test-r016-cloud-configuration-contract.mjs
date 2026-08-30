import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PlatformApiKeyConfigurationError,
  resolvePlatformApiKey,
} from '../supabase/functions/_shared/platform-api-keys.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');
const environment = (values) => (name) => values[name];

// Deliberately short fixtures: they exercise the key-family guard without
// resembling a usable platform credential or tripping repository secret scans.
const modernPublishable = 'sb_publishable_x';
const modernSecret = 'sb_secret_x';

assert.equal(
  resolvePlatformApiKey('publishable', environment({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: modernPublishable }),
    SUPABASE_ANON_KEY: 'legacy-value-must-not-win',
  })),
  modernPublishable,
  'Modern publishable key must win over a legacy fallback.',
);
assert.equal(
  resolvePlatformApiKey('secret', environment({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: modernSecret }),
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-value-must-not-win',
  })),
  modernSecret,
  'Modern secret key must win over a legacy fallback.',
);
assert.equal(
  resolvePlatformApiKey('publishable', environment({ SUPABASE_ANON_KEY: 'legacy-anon-key' })),
  'legacy-anon-key',
  'An older hosted project must remain usable while its modern map is absent.',
);
assert.equal(
  resolvePlatformApiKey('secret', environment({ SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-key' })),
  'legacy-service-key',
  'An older hosted project must remain usable while its modern map is absent.',
);

for (const values of [
  { SUPABASE_SECRET_KEYS: '{not-json', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-key' },
  { SUPABASE_SECRET_KEYS: JSON.stringify({ other: modernSecret }), SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-key' },
  { SUPABASE_SECRET_KEYS: JSON.stringify({ default: modernPublishable }), SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-key' },
  {},
]) {
  assert.throws(
    () => resolvePlatformApiKey('secret', environment(values)),
    PlatformApiKeyConfigurationError,
    'A malformed, incomplete, wrong-family, or absent secret-key configuration must fail closed.',
  );
}

const [
  packageSource,
  keyResolver,
  edgeShared,
  ownerEndpoint,
  enrollmentEndpoint,
  sessionEndpoint,
  syncEndpoint,
  terminalEndpoint,
  resetEndpoint,
  config,
  deployScript,
  issuerKeyVerifier,
  productionLedger,
  cloudManifest,
  releaseStatus,
  adr,
  controlledConfigurationAdr,
  releaseRunbook,
] = await Promise.all([
  load('package.json'),
  load('supabase/functions/_shared/platform-api-keys.ts'),
  load('supabase/functions/_shared/hub-edge.ts'),
  load('supabase/functions/hub-owner-enrollment/index.ts'),
  load('supabase/functions/hub-enrollment/index.ts'),
  load('supabase/functions/hub-staff-session/index.ts'),
  load('supabase/functions/hub-sync/index.ts'),
  load('supabase/functions/hub-terminal-enrollment/index.ts'),
  load('supabase/functions/hub-staff-credential-reset/index.ts'),
  load('supabase/config.toml'),
  load('scripts/deploy-hub-cloud.sh'),
  load('scripts/verify-issuer-key-configuration.mjs'),
  load('supabase/production/iwbbwcaylpulcpvbfkdx-r001a-r013-ledger.json'),
  load('docs/operations/PRODUCTION_CLOUD_CONFIGURATION_MANIFEST.md'),
  load('docs/operations/RELEASE_STATUS.md'),
  load('docs/architecture/ADR-007_MODERN_EDGE_API_KEY_RESOLUTION.md'),
  load('docs/architecture/ADR-009_CONTROLLED_PRODUCTION_FUNCTION_CONFIGURATION.md'),
  load('docs/operations/PRODUCTION_LINE_RELEASE_RUNBOOK.md'),
]);

const manifest = JSON.parse(packageSource);
assert.equal(
  manifest.scripts['test:r016-cloud-configuration'],
  'node --experimental-strip-types scripts/test-r016-cloud-configuration-contract.mjs',
  'R016 must have a dedicated executable contract command.',
);
assert.ok(manifest.scripts['test:all'].includes('test:r016-cloud-configuration'), 'The full source gate must include R016.');

assert.match(keyResolver, /SUPABASE_PUBLISHABLE_KEYS/);
assert.match(keyResolver, /SUPABASE_SECRET_KEYS/);
assert.match(keyResolver, /SUPABASE_ANON_KEY/);
assert.match(keyResolver, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(keyResolver, /sb_publishable_/);
assert.match(keyResolver, /sb_secret_/);
assert.match(keyResolver, /PlatformApiKeyConfigurationError/);
assert.match(edgeShared, /platformPublishableKey/);
assert.match(edgeShared, /platformServiceKey/);
assert.match(ownerEndpoint, /platformPublishableKey\(\)/);

for (const endpoint of [ownerEndpoint, enrollmentEndpoint, sessionEndpoint, syncEndpoint, terminalEndpoint, resetEndpoint]) {
  assert.match(endpoint, /platformServiceKey\(\)/, 'Every service-only Edge client must use the shared modern-key resolver.');
}

for (const nativeFunction of [
  'hub-enrollment',
  'hub-staff-session',
  'hub-staff-credential-reset',
  'hub-sync',
  'hub-terminal-enrollment',
]) {
  const start = config.indexOf(`[functions.${nativeFunction}]`);
  const next = config.indexOf('[functions.', start + 1);
  assert.ok(start >= 0, `${nativeFunction} must remain configured.`);
  assert.match(config.slice(start, next < 0 ? undefined : next), /verify_jwt\s*=\s*false/, `${nativeFunction} must retain its custom native-proof boundary.`);
}
const ownerStart = config.indexOf('[functions.hub-owner-enrollment]');
assert.match(config.slice(ownerStart), /verify_jwt\s*=\s*true/, 'The browser owner endpoint must retain platform JWT verification.');

assert.match(deployScript, /HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES/);
assert.match(deployScript, /must be an integer from 15 through 720/);
assert.match(deployScript, /HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES=\$HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES/);
assert.match(deployScript, /THEPLUGOS_PRODUCTION_MIGRATION_LEDGER_SHA256/);
assert.match(deployScript, /THEPLUGOS_REMOTE_MIGRATION_LEDGER_CONFIRM/);
assert.match(deployScript, /--configure-production-functions/);
assert.match(deployScript, /THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM/);
assert.match(deployScript, /HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64/);
assert.match(deployScript, /verify-issuer-key-configuration\.mjs/);
assert.match(deployScript, /require_hold_release/);
assert.match(deployScript, /configure-functions:production/);
assert.match(deployScript, /iwbbwcaylpulcpvbfkdx/);
assert.match(deployScript, /test-r016-cloud-configuration-contract\.mjs/);
assert.match(deployScript, /verify-production-migration-ledger\.mjs/);
assert.match(deployScript, /THEPLUGOS_DEPLOYMENT_ENV}" == "production"/);
assert.match(deployScript, /THEPLUGOS_DEPLOYMENT_ENV}" == "staging"/);
assert.ok(!deployScript.includes('supabase db push --project-ref "$SUPABASE_PROJECT_REF"\n\nfor function_name'), 'Production deployment must not blindly replay the recorded schema baseline.');
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Cloud configuration must not silently grant product-release authority.');
assert.match(adr, /malformed key map/);
assert.match(adr, /HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES/);
assert.match(controlledConfigurationAdr, /does not change\s+`RELEASE_STATUS\.md`/);
assert.match(controlledConfigurationAdr, /never runs `supabase db\s+push`/);
assert.match(controlledConfigurationAdr, /P-256 issuer private JWK/);
assert.match(releaseRunbook, /--configure-production-functions/);
assert.equal(JSON.parse(productionLedger).entries.length, 13, 'The production ledger must bind every applied R001A–R013 migration.');
for (const requiredConfiguration of [
  'HUB_AUTHORIZATION_ISSUER_KEY_ID',
  'HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON',
  'HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64',
  'HUB_RATE_LIMIT_PEPPER',
  'HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES',
  'HUB_OWNER_PORTAL_ORIGIN',
  'leaked-password protection',
]) {
  assert.match(cloudManifest, new RegExp(requiredConfiguration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `The cloud manifest must cover ${requiredConfiguration}.`);
}

execFileSync('bash', ['-n', resolve(root, 'scripts/deploy-hub-cloud.sh')], { stdio: 'pipe' });
const ledgerFingerprint = execFileSync(
  process.execPath,
  [resolve(root, 'scripts/verify-production-migration-ledger.mjs'), '--project-ref', 'iwbbwcaylpulcpvbfkdx', '--emit-fingerprint'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
).trim();
assert.match(ledgerFingerprint, /^[0-9a-f]{64}$/, 'The production ledger must verify its own source hashes.');

assert.match(issuerKeyVerifier, /createPrivateKey/);
assert.match(issuerKeyVerifier, /HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64/);
assert.match(issuerKeyVerifier, /does not match the P-256 private JWK/);

const issuer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const otherIssuer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateJwk = issuer.privateKey.export({ format: 'jwk' });
const publicSpki = issuer.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
const otherPublicSpki = otherIssuer.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
const issuerVerifierPath = resolve(root, 'scripts/verify-issuer-key-configuration.mjs');
const verifiedIssuerFingerprint = execFileSync(
  process.execPath,
  [issuerVerifierPath, '--emit-fingerprint'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      HUB_AUTHORIZATION_ISSUER_KEY_ID: 'test-issuer-2026',
      HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON: JSON.stringify(privateJwk),
      HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64: publicSpki,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
).trim();
assert.match(verifiedIssuerFingerprint, /^[0-9a-f]{64}$/, 'A matching P-256 issuer pair must produce a non-secret fingerprint.');
const mismatchedIssuer = spawnSync(
  process.execPath,
  [issuerVerifierPath, '--emit-fingerprint'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      HUB_AUTHORIZATION_ISSUER_KEY_ID: 'test-issuer-2026',
      HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON: JSON.stringify(privateJwk),
      HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64: otherPublicSpki,
    },
  },
);
assert.equal(mismatchedIssuer.status, 64, 'A mismatched Android issuer public key must stop configuration.');
assert.match(mismatchedIssuer.stderr, /does not match the P-256 private JWK/);

console.log('R016 cloud-configuration contract checks passed');
