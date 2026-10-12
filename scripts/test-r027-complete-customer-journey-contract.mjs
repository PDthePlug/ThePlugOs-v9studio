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
  app,
  marketing,
  welcome,
  wizard,
  roleEntry,
  cashier,
  kitchen,
  manager,
  renderer,
  workflow,
  styles,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('docs/architecture/ADR-018_COMPLETE_CUSTOMER_JOURNEY_AND_VISUAL_ACCEPTANCE.md'),
  load('src/App.tsx'),
  load('src/screens/MarketingLanding.tsx'),
  load('src/screens/WelcomeScreen.tsx'),
  load('src/screens/FirstTimeSetupWizard.tsx'),
  load('src/components/RoleLoginModal.tsx'),
  load('src/workspaces/NativeCashierStation.tsx'),
  load('src/workspaces/NativeKitchenStation.tsx'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('scripts/qa-customer-journey-renderer.mjs'),
  load('.github/workflows/verify.yml'),
  load('src/index.css'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r027-customer-journey'],
  'node scripts/test-r027-complete-customer-journey-contract.mjs',
  'R027 must retain a dedicated complete-customer-journey gate.',
);
assert.ok(
  packageManifest.scripts['test:all'].includes('test:r027-customer-journey'),
  'The full source gate must run R027.',
);

// Owner journey: landing -> account/business -> onboarding -> owner dashboard.
requireText(marketing, 'Set up my business');
for (const copy of [
  'Create Business',
  'Business name',
  'First branch name',
  'Create owner account',
]) requireText(welcome, copy);
requireText(welcome, 'const { data: sessionData } = await supabase.auth.getSession();');
requireText(welcome, 'if (authenticatedOwnerId || sessionData.session?.user)');
requireText(welcome, 'supabase.auth.signUp');
requireText(welcome, "supabase.rpc('create_business_with_owner_and_branch'");
assert.ok(
  welcome.indexOf('if (!owner.email_confirmed_at)') < welcome.indexOf("supabase.rpc('create_business_with_owner_and_branch'"),
  'Email confirmation must remain ahead of business creation.',
);

for (const copy of ['Get your shop ready', 'Open owner dashboard', 'Continue setup on your Cashier Hub']) requireText(wizard, copy);
requireText(app, 'setOwnerSetupPending(setupPending)');
requireText(app, 'onOpenOwnerDashboard={() => setShowSetupWizard(false)}');
requireText(app, 'browserSetupPending={ownerSetupPending}');
requireText(app, 'onResumeSetup={() => setShowSetupWizard(true)}');
requireText(app, 'Shop setup is still in progress');
requireText(app, 'Resume setup');
assert.ok(!app.includes("onboarding_status: 'COMPLETED'"), 'Browser navigation must not fabricate onboarding completion.');

// The setup reminder is visually in flow rather than covering dashboard controls.
requireText(styles, '#root:has(> aside.fixed[role="status"])');
requireText(styles, 'position: static !important');
requireText(styles, 'order: -1');

// Native staff entry remains the only staff-credential handoff.
for (const copy of [
  'Who’s working this station?',
  'Choose profile & enter PIN',
  'Already signed in? Open my workspace',
]) requireText(roleEntry, copy);
requireText(roleEntry, 'localHubRuntime.openNativeStaffSignIn()');
requireText(roleEntry, 'localHubRuntime.getNativeOperatorContext()');
assert.ok(!roleEntry.includes('type="password"'), 'React staff entry must not capture a PIN/password field.');

for (const [source, heading] of [
  [cashier, 'Sell, take payment, hand over'],
  [kitchen, 'Cook the queue'],
  [manager, 'Run the shift'],
]) requireText(source, heading);

// Visual acceptance must drive all nine actual states at desktop and mobile.
for (const state of [
  '01-landing',
  '02-create-business',
  '03-onboarding',
  '04-owner-dashboard-pending-setup',
  '05-owner-sign-in',
  '06-staff-sign-in',
  '07-cashier',
  '08-kitchen',
  '09-manager',
]) requireText(renderer, state);
requireText(renderer, "[1280, 900, 'desktop']");
requireText(renderer, "[390, 844, 'mobile']");
requireText(renderer, 'metrics.scrollWidth <= metrics.innerWidth + 1');
requireText(renderer, "Kitchen workspace leaked catalog price.");
requireText(renderer, "scope: 'fixture-only owner and native presentation journey; no production Auth/PIN/pairing/LAN evidence'");

requireText(workflow, 'journey-visual:');
requireText(workflow, 'Render complete customer journey');
requireText(workflow, 'Upload customer journey evidence');
requireText(workflow, 'theplugos-customer-journey-${{ github.sha }}');

for (const phrase of [
  'landing → Set up my business → owner account → business and first branch → shop onboarding → owner dashboard',
  'staff access → native profile/PIN verification → verified operator context → Cashier, Kitchen or Manager workspace',
  'Production readiness remains **HOLD**',
]) requireText(adr, phrase);
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Visual journey recovery must not grant production release authority.');

console.log('R027 complete customer journey and responsive visual contract passed');
