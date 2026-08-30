import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

async function exists(relativePath) {
  try {
    await access(resolve(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

const [
  retirementBoundary,
  releaseStatus,
  browserSecurity,
  ownerEnrollmentControl,
  roleLoginModal,
  serverSource,
  certificationReadme,
  certificationEntries,
] = await Promise.all([
  load('docs/architecture/LEGACY_BROWSER_PROTOTYPE_RETIREMENT.md'),
  load('docs/operations/RELEASE_STATUS.md'),
  load('src/lib/security.ts'),
  load('src/components/NativeHubEnrollmentControl.tsx'),
  load('src/components/RoleLoginModal.tsx'),
  load('server.ts'),
  load('docs/certification/README.md'),
  readdir(resolve(root, 'docs/certification'), { withFileTypes: true }),
]);

assert.equal(await exists('src/services/PairingService.ts'), false, 'The retired browser PairingService must not return.');
assert.equal(await exists('src/components/DevicePairingWizard.tsx'), false, 'The disconnected browser pairing wizard must not return.');

const normalizedRetirementBoundary = retirementBoundary.replace(/\s+/g, ' ');
for (const fragment of [
  'Android Cashier Hub is the local operational authority',
  'browser owner portal may request a short-lived enrollment code only',
  'Express/SSE relay',
  'R021 verifies',
]) {
  assert.ok(normalizedRetirementBoundary.includes(fragment), `Retirement boundary must explain: ${fragment}`);
}

assert.ok(!browserSecurity.includes("from '../lib/supabase'"), 'Retired browser security must not import a Supabase client.');
assert.ok(browserSecurity.includes('Browser security operations are retired.'), 'Browser security compatibility calls must fail closed.');
assert.ok(ownerEnrollmentControl.includes("supabase.functions.invoke('hub-owner-enrollment'"), 'The owner portal must use the bounded owner-enrollment Function.');
assert.ok(roleLoginModal.includes('NativeHubEnrollmentControl'), 'The live browser pairing entry must present only the native-enrollment control.');
assert.ok(serverSource.includes('Device pairing, local-hub discovery, and operational writes are not served by this web process.'), 'The Express process must not become a competing local Hub.');

assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Legacy cleanup must not change the HOLD release boundary.');
assert.match(certificationReadme, /Not release evidence\./, 'Certification archive README must remain explicit.');

const certificationFiles = certificationEntries
  .filter((entry) => entry.isFile() && /^\d{2}_.+\.md$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
assert.equal(certificationFiles.length, 27, 'Historical certification archive unexpectedly changed; review release claims before accepting new files.');

for (const file of certificationFiles) {
  const source = await load(`docs/certification/${file}`);
  assert.match(source, /Release status: superseded \/ not evidence\./, `${file} must remain visibly superseded.`);
  assert.doesNotMatch(source, /^\*\*Status:\*\*/m, `${file} must not display an active status heading.`);
  assert.doesNotMatch(source, /^\*\*System Status:\*\*/m, `${file} must not display an active system-status heading.`);
}

console.log('R021 legacy browser retirement contract checks passed');
