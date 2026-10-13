import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workdir = await mkdtemp(join(tmpdir(), 'theplugos-r031-'));
try {
  const run = spawnSync(process.execPath, [
    'scripts/generate-staging-secret-material.mjs',
    '--out-dir', workdir,
    '--owner-origin', 'https://theplugos-v9studio.vercel.app',
    '--ttl-minutes', '720',
    '--key-label', 'theplugos-staging-test',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, `Generator failed: ${run.stderr}`);
  const privatePath = join(workdir, '.env.theplugos-staging.local');
  const publicPath = join(workdir, '.env.theplugos-staging.public');
  const privateSource = await readFile(privatePath, 'utf8');
  const publicSource = await readFile(publicPath, 'utf8');
  const privateMode = (await stat(privatePath)).mode & 0o777;
  const publicMode = (await stat(publicPath)).mode & 0o777;

  assert.equal(privateMode, 0o600, 'Private staging material must be owner-readable/writable only.');
  assert.equal(publicMode, 0o600, 'Generated public handoff file must remain local-only by default.');

  const privateJwkMatch = privateSource.match(/HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON='([^\n]+)'/);
  const pepperMatch = privateSource.match(/HUB_RATE_LIMIT_PEPPER=([^\n]+)/);
  const keyIdMatch = privateSource.match(/HUB_AUTHORIZATION_ISSUER_KEY_ID=([^\n]+)/);
  assert.ok(privateJwkMatch && pepperMatch && keyIdMatch, 'Required private staging values are missing.');

  const privateJwk = JSON.parse(privateJwkMatch[1]);
  assert.equal(privateJwk.kty, 'EC');
  assert.equal(privateJwk.crv, 'P-256');
  assert.equal(typeof privateJwk.d, 'string');
  assert.ok(privateJwk.d.length >= 40, 'Private P-256 scalar is unexpectedly short.');
  assert.ok(pepperMatch[1].length >= 32, 'Rate-limit pepper must meet the Edge minimum.');
  assert.match(keyIdMatch[1], /^[A-Za-z0-9._-]{1,128}$/);

  assert.ok(publicSource.includes('HUB_AUTHORIZATION_ISSUER_PUBLIC_JWK_JSON='));
  assert.ok(publicSource.includes('HUB_AUTHORIZATION_ISSUER_PUBLIC_JWK_SHA256='));
  assert.ok(publicSource.includes('HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES=720'));
  assert.ok(publicSource.includes('HUB_OWNER_PORTAL_ORIGIN=https://theplugos-v9studio.vercel.app'));
  assert.ok(!publicSource.includes(privateJwk.d), 'Public handoff must not contain the private scalar.');
  assert.ok(!publicSource.includes(pepperMatch[1]), 'Public handoff must not contain the rate-limit pepper.');

  assert.ok(!run.stdout.includes(privateJwk.d), 'Generator stdout must not print private JWK material.');
  assert.ok(!run.stdout.includes(pepperMatch[1]), 'Generator stdout must not print the rate-limit pepper.');
  assert.ok(run.stdout.includes('Private JWK and rate-limit pepper were not printed.'));

  const second = spawnSync(process.execPath, [
    'scripts/generate-staging-secret-material.mjs',
    '--out-dir', workdir,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(second.status, 0, 'Generator must refuse to overwrite existing staging secret material.');

  const invalidOrigin = await mkdtemp(join(tmpdir(), 'theplugos-r031-origin-'));
  try {
    const bad = spawnSync(process.execPath, [
      'scripts/generate-staging-secret-material.mjs',
      '--out-dir', invalidOrigin,
      '--owner-origin', 'http://example.com',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.notEqual(bad.status, 0, 'Generator must reject non-HTTPS owner origins.');
  } finally {
    await rm(invalidOrigin, { recursive: true, force: true });
  }

  console.log('R031 staging secret-material contract checks passed');
} finally {
  await rm(workdir, { recursive: true, force: true });
}
