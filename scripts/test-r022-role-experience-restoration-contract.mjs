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
  app,
  roleGate,
  nativeStaffSignIn,
  terminalStaffSignIn,
  terminalLocalLink,
  adr,
  legacyRetirement,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('src/App.tsx'),
  load('src/components/RoleLoginModal.tsx'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeStaffSignInActivity.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeTerminalStaffSignInActivity.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/NativeTerminalLocalLinkActivity.kt'),
  load('docs/architecture/ADR-012_ROLE_BASED_MERCHANT_EXPERIENCE_RESTORATION.md'),
  load('docs/architecture/LEGACY_BROWSER_PROTOTYPE_RETIREMENT.md'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r022-role-experience'],
  'node scripts/test-r022-role-experience-restoration-contract.mjs',
  'R022 must retain a dedicated role-experience contract command.',
);
assert.ok(packageManifest.scripts['test:all'].includes('test:r022-role-experience'), 'The full source gate must run R022.');

// The old merchant role experience is restored without restoring browser PIN authority.
requireText(roleGate, 'Who’s working this station?');
requireText(roleGate, 'Choose profile & enter PIN');
requireText(roleGate, 'Owner dashboard');
requireText(roleGate, 'Business heartbeat');
requireText(roleGate, 'NativeHubEnrollmentControl');
requireText(roleGate, 'NativeStaffCredentialResetControl');
requireText(roleGate, 'hasNativeHubHost');
requireText(roleGate, 'localHubRuntime.openNativeStaffSignIn()');
requireText(roleGate, 'localHubRuntime.getNativeOperatorContext()');
requireText(roleGate, 'onOpenNativeStation(context.role)');
assert.ok(!roleGate.includes('verifyStaffPin'), 'React must not regain PIN verification authority.');
assert.ok(!roleGate.includes('pinInput'), 'React must not hold a staff PIN input model.');
assert.ok(!roleGate.includes('type="password"'), 'The browser role gate must not capture a staff PIN.');
for (const mutation of ['.insert(', '.upsert(', '.update(', '.delete(', '.rpc(']) {
  assert.ok(!roleGate.includes(mutation), `The owner role surface must remain free of direct operational mutation: ${mutation}`);
}

// The Hub-device PIN remains native and successful verification returns control to role routing.
requireText(nativeStaffSignIn, 'TYPE_NUMBER_VARIATION_PASSWORD');
requireText(nativeStaffSignIn, 'beginStaffSessionFromNativeScreen');
requireText(nativeStaffSignIn, 'Who’s working this station?');
requireText(nativeStaffSignIn, 'Cashier');
requireText(nativeStaffSignIn, 'Kitchen');
requireText(nativeStaffSignIn, 'Manager');
requireText(nativeStaffSignIn, 'setResult(RESULT_OK)');
assert.ok(!nativeStaffSignIn.includes('@PluginMethod'), 'The PIN screen must remain outside the Capacitor command bridge.');

// A separately enrolled terminal follows the same product flow but keeps its stronger signed admission/session chain.
requireText(terminalStaffSignIn, 'TYPE_NUMBER_VARIATION_PASSWORD');
requireText(terminalStaffSignIn, 'cloud.startTerminalStaffSession(selected.staffId, nativePin)');
requireText(terminalStaffSignIn, 'controller.installTerminalStaffSession');
requireText(terminalStaffSignIn, 'setResult(RESULT_OK)');
requireText(terminalStaffSignIn, 'finish()');
requireText(terminalStaffSignIn, 'Who’s working this station?');
assert.ok(!terminalStaffSignIn.includes('@PluginMethod'), 'Terminal PIN/session material must remain outside the Capacitor bridge.');
requireText(terminalLocalLink, 'if (requestCode == TERMINAL_SIGN_IN_REQUEST && resultCode == RESULT_OK)');
requireText(terminalLocalLink, 'startActivity(Intent(this, NativeTerminalOperationalWorkspaceActivity::class.java))');

// App routing remains downstream of the native capability boundary.
requireText(app, 'hasNativeHubHost() ? <NativeStationAccess /> : <MainOSApp />');
requireText(app, 'nativeStationRole === \'MANAGER\'');
requireText(app, "nativeStationRole === 'KITCHEN_STAFF'");
requireText(app, "nativeStationRole === 'OWNER' || nativeStationRole === 'ADMINISTRATOR'");

// R022 is a UX restoration, not a rollback of R021 or release authority.
requireText(adr, 'React routes only from `getNativeOperatorContext()`');
requireText(adr, 'Cashier');
requireText(adr, 'Kitchen');
requireText(adr, 'Manager');
requireText(legacyRetirement, 'Android Cashier Hub is the local operational authority');
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Role experience restoration must not grant release authority.');

console.log('R022 role-based merchant experience contract checks passed');
