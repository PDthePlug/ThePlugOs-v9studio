import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = resolve(root, 'supabase/production/iwbbwcaylpulcpvbfkdx-r001a-r013-ledger.json');
const args = process.argv.slice(2);
const emitFingerprint = args.includes('--emit-fingerprint');
const projectFlag = args.indexOf('--project-ref');
const suppliedProjectRef = projectFlag >= 0 ? args[projectFlag + 1] : undefined;

if (projectFlag >= 0 && (!suppliedProjectRef || suppliedProjectRef.startsWith('--'))) {
  fail('A project reference is required after --project-ref.');
}
if (args.some((arg, index) => arg !== '--emit-fingerprint' && arg !== '--project-ref' && index !== projectFlag + 1)) {
  fail('Unsupported ledger verification argument.');
}

let ledger;
try {
  ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
} catch {
  fail('Production migration ledger is unreadable.');
}

if (!ledger || ledger.schemaVersion !== 1 || ledger.projectRef !== 'iwbbwcaylpulcpvbfkdx' || !Array.isArray(ledger.entries)) {
  fail('Production migration ledger has an invalid shape.');
}
if (suppliedProjectRef && suppliedProjectRef !== ledger.projectRef) {
  fail('Production migration ledger does not match the supplied project reference.');
}

for (const entry of ledger.entries) {
  if (!entry
    || !/^\d{14}$/.test(entry.remoteVersion)
    || typeof entry.remoteName !== 'string'
    || !/^supabase\/migrations\/[A-Za-z0-9][A-Za-z0-9a-z_-]*\.sql$/.test(entry.sourceFile)
    || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    fail('Production migration ledger contains an invalid entry.');
  }
  const sourceFileName = entry.sourceFile.slice(entry.sourceFile.lastIndexOf('/') + 1, -4);
  if (sourceFileName !== entry.remoteName) fail('Production migration ledger source and remote names do not match.');
  const source = await readFile(resolve(root, entry.sourceFile));
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (sourceHash !== entry.sha256) fail('A production baseline migration differs from its recorded source hash.');
}

const fingerprintMaterial = JSON.stringify({
  projectRef: ledger.projectRef,
  entries: ledger.entries.map(({ remoteVersion, remoteName, sourceFile, sha256 }) => ({
    remoteVersion,
    remoteName,
    sourceFile,
    sha256,
  })),
});
const fingerprint = createHash('sha256').update(fingerprintMaterial).digest('hex');

if (emitFingerprint) {
  process.stdout.write(`${fingerprint}\n`);
} else {
  console.log(`Production migration ledger verified for ${ledger.projectRef}: ${fingerprint}`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
