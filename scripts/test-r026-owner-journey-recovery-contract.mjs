import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');
const requireText = (subject, fragment, message = `Expected source to contain: ${fragment}`) => {
  assert.ok(subject.includes(fragment), message);
};

const [packageSource, adr, wizard, ownerPortal, roleGate, releaseStatus] = await Promise.all([
  load('package.json'),
  load('docs/architecture/ADR-017_OWNER_JOURNEY_RECOVERY_AND_NATIVE_ONBOARDING_HANDOFF.md'),
  load('src/screens/FirstTimeSetupWizard.tsx'),
  load('src/lib/ownerPortal.ts'),
  load('src/components/RoleLoginModal.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r026-owner-journey'],
  'node scripts/test-r026-owner-journey-recovery-contract.mjs',
  'R026 must retain a dedicated owner-journey recovery gate.',
);
assert.ok(
  packageManifest.scripts['test:all'].includes('test:r026-owner-journey'),
  'The full source gate must run R026.',
);

// The merchant setup experience must no longer expose the internal release safe-stop.
for (const retiredCopy of [
  'Native onboarding required',
  'Release path before this business may trade',
  'Clone R001 into staging',
  'signed bundle, local ledger',
]) {
  assert.ok(!wizard.includes(retiredCopy), `Merchant setup must not expose internal engineering copy: ${retiredCopy}`);
}

for (const merchantCopy of [
  'Get your shop ready',
  'Business created',
  'Connect your main shop device',
  'Team & stations',
  'Menu & stock',
  'Continue on your Cashier Hub',
]) requireText(wizard, merchantCopy);

// Reuse the established light merchant setup presentation contract.
requireText(wizard, 'plug-setup-head');
requireText(wizard, 'plug-setup-body');

// Browser setup may request bounded enrollment, but cannot regain staff/device authority.
requireText(wizard, '<NativeHubEnrollmentControl');
requireText(wizard, 'This owner portal never asks for, stores or verifies a staff PIN.');
for (const forbidden of [
  'type="password"',
  'pin_hash',
  'setPin',
  'verifyPin',
  'localStorage',
  'sessionStorage',
  'supabase.from(',
  'supabase.rpc(',
]) assert.ok(!wizard.includes(forbidden), `Browser onboarding must not contain authority/mutation path: ${forbidden}`);

// Owner credentials remain bound to one explicit origin.
requireText(ownerPortal, "'UNAPPROVED_RUNTIME_ORIGIN'");
requireText(ownerPortal, 'runtimeOrigin !== approvedOrigin');
requireText(ownerPortal, 'Owner access is available only from the approved owner portal.');

// Operational roles still enter only through the native runtime.
requireText(roleGate, 'localHubRuntime.openNativeStaffSignIn()');
requireText(roleGate, 'localHubRuntime.getNativeOperatorContext()');
assert.ok(!roleGate.includes('type="password"'), 'Role gate must not capture a browser staff credential.');

// Architecture and release truth remain explicit.
requireText(adr, 'V9 Studio remains canonical.');
requireText(adr, 'must not collect or verify staff PINs');
requireText(releaseStatus, '**Status:** HOLD');

console.log('R026 owner journey recovery contract passed.');
