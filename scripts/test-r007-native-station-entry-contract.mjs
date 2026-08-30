import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [contract, database, runtime, plugin, bridge, localHub, app, cashier, kitchen, manager, roleLogin, releaseStatus] = await Promise.all([
  load('docs/architecture/NATIVE_STATION_ENTRY_AND_SESSION_END_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/ThePlugOSLocalHubPlugin.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('packages/core/src/runtime/local-hub.ts'),
  load('src/App.tsx'),
  load('src/workspaces/NativeCashierStation.tsx'),
  load('src/workspaces/NativeKitchenStation.tsx'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('src/components/RoleLoginModal.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

function methodBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `Missing method signature: ${signature}`);
  const next = source.indexOf('\n    /**', start + signature.length);
  return source.slice(start, next >= 0 ? next : undefined);
}

requireText(contract, 'Operational staff must not need an Owner\'s browser session');
requireText(contract, '`endNativeStaffSession()` is a native capability with no request parameters.');
requireText(contract, 'No cloud revocation or remote logout protocol.');
requireText(contract, 'No staging, deployment, production database mutation');

const databaseEnd = methodBody(database, 'fun endActiveNativeStaffSession(): Boolean');
requireText(databaseEnd, 'open().delete("active_native_staff_session", "singleton = 1", null) == 1');
assert.ok(!databaseEnd.includes('native_command_intents'), 'Local session end must retain recoverable native intents.');
assert.ok(!databaseEnd.includes('command_receipts'), 'Local session end must retain committed receipts.');
assert.ok(!databaseEnd.includes('events'), 'Local session end must retain immutable events.');
assert.ok(!databaseEnd.includes('cloud_outbox'), 'Local session end must retain queued outbox facts.');

const runtimeEnd = methodBody(runtime, 'internal fun endNativeStaffSession(): Boolean');
requireText(runtimeEnd, 'database.endActiveNativeStaffSession()');
assert.ok(!runtimeEnd.includes('activeAuthorizationBundle'), 'A stale local selector must be clearable without active cloud authority.');
assert.ok(!runtimeEnd.includes('staffSessionId'), 'Browser code must not select a native staff session to end.');

const pluginEnd = methodBody(plugin, 'fun endNativeStaffSession(call: PluginCall)');
requireText(pluginEnd, 'runtime().endNativeStaffSession()');
assert.ok(!pluginEnd.includes('getString'), 'The plugin must not accept a browser-provided staff/session selector.');

requireText(bridge, 'endNativeStaffSession(): Promise<boolean>;');
requireText(bridge, 'export function hasNativeHubHost(): boolean');
requireText(bridge, 'Native staff-session end is unavailable in this browser build.');
requireText(localHub, 'public async endNativeStaffSession(): Promise<boolean>');
requireText(localHub, 'export { NativeHubCapabilityError, hasNativeHubHost }');

requireText(app, 'return hasNativeHubHost() ? <NativeStationAccess /> : <MainOSApp />;');
requireText(app, 'await localHubRuntime.endNativeStaffSession();');
requireText(app, "nativeStationRole === 'KITCHEN_STAFF'");
requireText(app, "nativeStationRole === 'MANAGER'");
requireText(roleLogin, 'This browser cannot select a staff identity or become a Cashier, Kitchen, or Manager station.');
for (const source of [cashier, kitchen, manager]) {
  requireText(source, 'onEndNativeSession: () => Promise<void>;');
  requireText(source, 'End native staff session');
  assert.ok(!source.includes('Return to owner browser shell'), 'A native station must not rely on an Owner browser shell for session end.');
}
requireText(releaseStatus, 'native station-entry and local');

console.log('R007 native station-entry and session-end contract checks passed');
