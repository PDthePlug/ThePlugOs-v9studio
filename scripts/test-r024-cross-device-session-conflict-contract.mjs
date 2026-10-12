import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');
const requireText = (subject, fragment, message = `Expected source to contain: ${fragment}`) => {
  assert.ok(subject.includes(fragment), message);
};

const [
  packageSource,
  hubDatabase,
  hubCommandVerifier,
  terminalSessionCoordinator,
  r014,
  adr,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalStaffSessionCoordinator.kt'),
  load('supabase/migrations/014_terminal_staff_session_and_command_authority.sql'),
  load('docs/architecture/ADR-015_CROSS_DEVICE_STAFF_SESSION_CONFLICT_HARDENING.md'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r024-cross-device-session-conflicts'],
  'node scripts/test-r024-cross-device-session-conflict-contract.mjs',
  'R024 must retain a dedicated cross-device session conflict gate.',
);
assert.ok(
  packageManifest.scripts['test:all'].includes('test:r024-cross-device-session-conflicts'),
  'The full source gate must run R024.',
);

const localRetirement = 'UPDATE staff_sessions SET revoked_at = ? WHERE (device_id = ? OR staff_id = ?) AND session_id <> ? AND revoked_at IS NULL';
requireText(
  hubDatabase,
  localRetirement,
  'The Hub must atomically retire another active session for either the same terminal or the same staff member.',
);
requireText(
  hubDatabase,
  'arrayOf(installedAt, assertion.terminalDeviceId, assertion.staffId, assertion.sessionId)',
  'Local conflict retirement must bind both terminal and staff identity from the verified assertion.',
);

const roleMatch = 'if (session.role != device.role)';
const roleMatchIndex = hubCommandVerifier.indexOf(roleMatch);
const permissionIndex = hubCommandVerifier.indexOf('if (!isPermitted(session.role, command.type))');
assert.ok(roleMatchIndex >= 0, 'Every command must re-check the staff-session role against the current paired terminal role.');
assert.ok(
  permissionIndex > roleMatchIndex,
  'Terminal/session role equality must be checked before role permissions can authorize a command.',
);
requireText(
  hubCommandVerifier,
  'The staff session role no longer matches the paired terminal role.',
);

for (const binding of [
  'intent.deviceId != verified.terminalDeviceId',
  'intent.staffSessionId != verified.sessionId',
  'intent.sequence != serialized.lastAllocatedSequence',
]) {
  requireText(
    terminalSessionCoordinator,
    binding,
    `Recovered pending terminal authority must validate ${binding}.`,
  );
}
requireText(
  terminalSessionCoordinator,
  'The persisted terminal command is not bound to the verified staff session.',
);

requireText(
  r014,
  'command_device_id = v_terminal.id OR (hub_device_id = v_hub.id AND staff_id = v_session.staff_id)',
  'The cloud R014 authority must retain the same-terminal/same-staff retirement rule mirrored by the Hub.',
);

for (const phrase of [
  'One active local operational session per staff member per Hub authority',
  'Device role and session role are checked on every command',
  'physical multi-device evidence pending',
]) requireText(adr, phrase);

assert.match(
  releaseStatus,
  /Status:\*\* HOLD|Status:\* HOLD|Status:\*\*\s*HOLD|Status:\s*HOLD|\*\*Status:\*\*\s*HOLD/,
  'Source hardening must not silently promote the product release status.',
);

assert.ok(!terminalSessionCoordinator.includes('@PluginMethod'), 'Terminal session and pending command authority must remain outside the Capacitor bridge.');

console.log('R024 cross-device staff-session conflict hardening checks passed');
