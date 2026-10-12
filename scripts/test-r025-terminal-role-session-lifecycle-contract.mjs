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
  adr,
  workspace,
  signIn,
  terminalProtocol,
  terminalCommands,
  hubVerifier,
  hubDatabase,
  terminalSessions,
  localLink,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('docs/architecture/ADR-016_TERMINAL_WORKSPACE_SAFE_STOP_AND_AUTHORITY_REVALIDATION.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeTerminalOperationalWorkspaceActivity.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeTerminalStaffSignInActivity.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalOperatorContextProtocol.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalOperationalCommandClient.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalStaffSessionCoordinator.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalLocalLinkController.kt'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r025-terminal-role-session-lifecycle'],
  'node scripts/test-r025-terminal-role-session-lifecycle-contract.mjs',
  'R025 must retain a dedicated role-session lifecycle gate.',
);
assert.ok(
  packageManifest.scripts['test:all'].includes('test:r025-terminal-role-session-lifecycle'),
  'The full source gate must run R025.',
);

// ADR-011 safe-stop is implemented rather than documented only.
requireText(workspace, 'const val CONTEXT_REVALIDATION_MS = 15_000L');
requireText(workspace, 'lifecycleHandler.postDelayed(sessionRevalidation, CONTEXT_REVALIDATION_MS)');
requireText(workspace, 'lifecycleHandler.removeCallbacks(sessionRevalidation)');
requireText(workspace, 'requestContext(force = true)');
requireText(workspace, 'FINAL_CONTEXT_REMEASURE_OUTCOMES = setOf("APPLIED", "DUPLICATE", "REJECTED")');
requireText(workspace, 'if (result.outcome in FINAL_CONTEXT_REMEASURE_OUTCOMES) requestContext(force = true)');
requireText(workspace, 'basket.clear()');
assert.ok(
  !workspace.includes('snapshot.state !in setOf(TerminalLocalLinkState.DISCOVERING'),
  'Rediscovery states must no longer preserve previously rendered operational controls.',
);
const authenticatedBranch = 'if (snapshot.state in setOf(TerminalLocalLinkState.AUTHENTICATED, TerminalLocalLinkState.STAFF_SESSION_ACTIVE))';
const authenticatedIndex = workspace.indexOf(authenticatedBranch);
const safeStopIndex = workspace.indexOf('// ADR-011/ADR-016 safe-stop');
assert.ok(authenticatedIndex >= 0 && safeStopIndex > authenticatedIndex, 'Every non-authenticated local-link state must enter the safe-stop branch.');
requireText(workspace.slice(safeStopIndex, safeStopIndex + 500), 'context = null');
requireText(workspace.slice(safeStopIndex, safeStopIndex + 500), 'taskRoot.removeAllViews()');

// The native PIN surface must re-measure its role-filtered roster after a
// local-link reconnect instead of remaining disabled behind stale request state.
requireText(signIn, 'snapshot.state == TerminalLocalLinkState.AUTHENTICATED && !directoryRequested');
const signInDisconnect = signIn.indexOf('snapshot.state !in setOf(TerminalLocalLinkState.AUTHENTICATED, TerminalLocalLinkState.STAFF_SESSION_ACTIVE)');
assert.ok(signInDisconnect >= 0, 'Native sign-in must handle every non-authenticated local-link state.');
const disconnectWindow = signIn.slice(signInDisconnect, signInDisconnect + 900);
for (const fragment of [
  'directoryRequested = false',
  'staff = emptyList()',
  'staffSpinner.isEnabled = false',
  'pin.isEnabled = false',
  'signIn.isEnabled = false',
]) requireText(disconnectWindow, fragment, `Native sign-in reconnect reset must retain: ${fragment}`);
requireText(signIn, 'controller.requestTerminalStaffDirectory');

// Keep the wire protocol backward-compatible: revalidation reuses OPERATOR_CONTEXT_REQUEST.
requireText(localLink, '"OPERATOR_CONTEXT_REQUEST"');
assert.ok(!localLink.includes('AUTHORITY_CHANGED'), 'R025 must not introduce an unsolicited authority-change wire message.');

// Local expiry and persisted-session verification remain fail-closed.
requireText(terminalSessions, 'HubTime.isExpired(verified.expiresAt, HubCloudTime.now())');
requireText(terminalSessions, 'keys.clearStaffSession()');
requireText(terminalSessions, 'intent.deviceId != verified.terminalDeviceId');
requireText(terminalSessions, 'intent.staffSessionId != verified.sessionId');

// The Hub binds context and commands to the same current terminal/session role.
requireText(hubDatabase, 'session.deviceId != terminalDeviceId');
requireText(hubDatabase, 'session.revocationVersion != bundle.revocationVersion');
requireText(hubDatabase, 'terminal.role != session.role');
requireText(hubVerifier, 'if (session.role != device.role)');

// Cashier, Kitchen, and Manager contexts remain mutually minimized.
requireText(terminalProtocol, 'if (role != expectedRole || role !in TERMINAL_ROLES)');
for (const failure of [
  "The Cashier terminal context contains another role's data.",
  "The Kitchen terminal context contains another role's data.",
  "The Manager terminal context contains another role's data.",
]) requireText(terminalProtocol, failure);
assert.ok(!terminalProtocol.includes('.put("sessionId"'), 'Role context must not carry a staff-session bearer.');
assert.ok(!terminalProtocol.includes('.put("terminalSigningPublicKeyBase64"'), 'Role context must not carry the terminal signing public key.');

// Role permissions are independently enforced before signed command delivery.
for (const roleFragment of [
  '"CASHIER" -> setOf("order.create", "order.status.transition", "payment.capture")',
  '"KITCHEN_STAFF" -> setOf("order.status.transition")',
  '"MANAGER" -> setOf("order.status.transition", "shift.open", "shift.close", "inventory.receive", "inventory.adjust", "inventory.waste")',
]) requireText(terminalCommands, roleFragment);
requireText(terminalCommands, 'if (type !in permissionsFor(session.role))');

// ADR and release truth stay explicit.
for (const phrase of [
  'Non-authenticated link state invalidates rendered operational context',
  'Periodic authenticated context revalidation detects expiry and supersession',
  'Every final Hub command result remeasures context',
  'Native PIN roster is remeasured after local-link reconnect',
  'physical multi-device evidence pending',
]) requireText(adr, phrase);
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Role-session lifecycle hardening must not grant release authority.');

console.log('R025 terminal role-session lifecycle and safe-stop checks passed');
