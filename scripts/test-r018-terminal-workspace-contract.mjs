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
  transport,
  runtime,
  database,
  localLink,
  protocol,
  workspace,
  terminalCommands,
  linkActivity,
  manifest,
  deployScript,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('docs/architecture/ADR-011_NATIVE_TERMINAL_OPERATOR_WORKSPACE.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/AuthenticatedLocalWebSocketTransport.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalLocalLinkController.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalOperatorContextProtocol.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeTerminalOperationalWorkspaceActivity.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/TerminalOperationalCommandClient.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeTerminalLocalLinkActivity.kt'),
  load('android/app/src/main/AndroidManifest.xml'),
  load('scripts/deploy-hub-cloud.sh'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r018-terminal-workspace'],
  'node scripts/test-r018-terminal-workspace-contract.mjs',
  'R018 must retain a dedicated native terminal-workspace contract command.',
);
assert.ok(packageManifest.scripts['test:all'].includes('test:r018-terminal-workspace'), 'The full source gate must run R018.');

requireText(adr, 'OPERATOR_CONTEXT_REQUEST');
requireText(adr, 'OPERATOR_CONTEXT');
requireText(adr, 'COMMAND_PENDING');
requireText(adr, 'not a bearer');
requireText(adr, 'Role-minimized context');

requireText(transport, '"OPERATOR_CONTEXT_REQUEST"');
requireText(transport, '"OPERATOR_CONTEXT"');
requireText(transport, 'terminalOperatorContextHandler');
requireText(transport, 'TerminalOperatorContextWire.encode(context)');
requireText(runtime, 'internal fun terminalOperatorContext');
requireText(runtime, 'database.terminalOperatorContext(authenticatedTerminalDeviceId, staffSessionId, nowIso())');
requireText(runtime, 'terminalOperatorContextHandler = ::terminalOperatorContext');

requireText(database, 'fun terminalOperatorContext(');
requireText(database, 'session.deviceId != terminalDeviceId');
requireText(database, 'session.revocationVersion != bundle.revocationVersion');
requireText(database, 'terminal.role != session.role');
requireText(database, 'operatorContextForSession(session, includeNativeRecovery = false)');

requireText(localLink, 'fun requestTerminalOperatorContext');
requireText(localLink, '"OPERATOR_CONTEXT_REQUEST"');
requireText(localLink, '"OPERATOR_CONTEXT"');
requireText(localLink, 'TerminalOperatorContextWire.decode');
requireText(localLink, '"EVENT_COMMITTED"');
requireText(protocol, 'object TerminalOperatorContextWire');
requireText(protocol, 'HubPayloadSafety.rejectSensitiveValues(value)');
requireText(protocol, 'The Cashier terminal context contains another role');
requireText(protocol, 'The Kitchen terminal context contains another role');
requireText(protocol, 'The Manager terminal context contains another role');
assert.ok(!protocol.includes('.put("sessionId"'), 'A terminal task context must never carry a staff-session ID.');
assert.ok(!protocol.includes('.put("terminalSigningPublicKeyBase64"'), 'A terminal task context must never carry a device public key.');

requireText(workspace, 'class NativeTerminalOperationalWorkspaceActivity');
requireText(workspace, 'TerminalOperationalCommandClient');
for (const command of [
  '"order.create"',
  '"payment.capture"',
  '"order.status.transition"',
  '"shift.open"',
  '"shift.close"',
  '"inventory.receive"',
  '"inventory.adjust"',
  '"inventory.waste"',
]) requireText(workspace, command);
assert.ok(!workspace.includes('@PluginMethod') && !workspace.includes('@CapacitorPlugin'), 'The terminal workspace must not expose a browser bridge.');
requireText(terminalCommands, 'keys.sign(commandBytes(unsigned))');
requireText(linkActivity, 'NativeTerminalOperationalWorkspaceActivity');
requireText(manifest, 'NativeTerminalOperationalWorkspaceActivity');
requireText(deployScript, 'test-r018-terminal-workspace-contract.mjs');
requireText(releaseStatus, 'ADR-011/R018');
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'R018 source implementation must not grant release authority.');

console.log('R018 native terminal-workspace contract checks passed');
