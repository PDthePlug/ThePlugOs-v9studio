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

const [releaseStatus, quarantinedSchema, certificationEntries] = await Promise.all([
  load('docs/operations/RELEASE_STATUS.md'),
  load('supabase/quarantine/legacy-browser-prototype-schema.sql'),
  readdir(resolve(root, 'docs/certification'), { withFileTypes: true }),
]);

assert.match(releaseStatus, /Status:\*\* HOLD — implementation foundation, not production-ready/, 'The current release gate must remain explicit.');
assert.match(
  releaseStatus,
  /Production mutation authority:\*\* narrowly authorized for the exact[\s\S]*product[\s\n]+  release authority remains withheld/,
  'The source may record the narrow owner-approved remediation window, but must not imply product-release authority.',
);
assert.equal(await exists('supabase/schema.sql'), false, 'The contradictory browser-prototype schema must not remain at the Supabase root.');
assert.match(quarantinedSchema, /QUARANTINED — NOT A DEPLOYMENT INPUT/, 'The historical schema must carry an unambiguous quarantine marker.');

const certificationFiles = certificationEntries
  .filter((entry) => entry.isFile() && /^\d{2}_.+\.md$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
assert.equal(certificationFiles.length, 27, 'The historical certification archive unexpectedly changed; review release claims before accepting new files.');

for (const file of certificationFiles) {
  const source = await load(`docs/certification/${file}`);
  assert.match(
    source,
    /Release status: superseded \/ not evidence\./,
    `${file} must not be usable as current release evidence.`,
  );
}

console.log('release-truth boundary checks passed');
