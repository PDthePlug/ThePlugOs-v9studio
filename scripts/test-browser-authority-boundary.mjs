import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, 'src');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

const activeEntryModules = [
  'src/App.tsx',
  'src/screens/FirstTimeSetupWizard.tsx',
  'src/components/NativeHubEnrollmentControl.tsx',
  'src/components/RoleLoginModal.tsx',
  'src/workspaces/NativeCashierStation.tsx',
  'src/workspaces/NativeKitchenStation.tsx',
  'src/workspaces/NativeManagerStation.tsx',
];

const activeSources = await Promise.all(activeEntryModules.map(async (path) => [path, await readFile(resolve(root, path), 'utf8')]));
const allSourcePaths = await sourceFiles(sourceRoot);
const allSources = await Promise.all(allSourcePaths.map(async (path) => [path, await readFile(path, 'utf8')]));

for (const [path, source] of activeSources) {
  assert.ok(!source.includes('@plugos/sdk'), `${path} must not import the retired browser SDK facade.`);
  assert.ok(!source.includes('@plugos/react'), `${path} must not mount the retired browser SDK provider.`);
  assert.ok(!source.includes('IndexedDBStorageAdapter'), `${path} must not initialize browser persistence as operational authority.`);
  assert.ok(!source.includes('BroadcastChannel'), `${path} must not present browser tab transport as shop-local transport.`);
  assert.ok(!source.includes('sdk.'), `${path} must communicate with the measured native Hub runtime directly.`);
}

const app = activeSources.find(([path]) => path === 'src/App.tsx')?.[1] || '';
assert.match(app, /await localHubRuntime\.boot\(\)/, 'The application entry point must boot only the native Hub bridge.');
assert.match(app, /localHubRuntime\.subscribe/, 'The application entry point must subscribe to measured native Hub state.');

for (const [path, source] of allSources) {
  assert.ok(
    !/\.(?:insert|upsert|update|delete)\s*\(/.test(source),
    `${path} contains a browser-side mutation call; operational and master-data writes require an accepted authority command.`,
  );
}

const rpcNames = [];
const functionNames = [];
for (const [, source] of allSources) {
  for (const match of source.matchAll(/\.rpc\(\s*['\"]([^'\"]+)['\"]/g)) rpcNames.push(match[1]);
  for (const match of source.matchAll(/\.functions\.invoke\(\s*['\"]([^'\"]+)['\"]/g)) functionNames.push(match[1]);
}
assert.deepEqual([...new Set(rpcNames)].sort(), ['create_business_with_owner_and_branch'], 'Only the R001 atomic business foundation RPC is available to the browser.');
assert.deepEqual([...new Set(functionNames)].sort(), ['hub-owner-enrollment'], 'Only the owner pairing-code endpoint is available to the browser.');

const server = await readFile(resolve(root, 'server.ts'), 'utf8');
assert.match(server, /RETIRED_OPERATIONAL_ENDPOINTS/, 'The web process must enumerate retired operational endpoints.');
assert.match(server, /res\.status\(410\)/, 'Retired operational endpoints must fail closed.');
assert.ok(!/app\.use\(\s*cors/i.test(server), 'The web process must not expose a permissive CORS write surface.');

console.log('browser authority boundary checks passed');
