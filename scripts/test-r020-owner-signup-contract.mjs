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
  accessContract,
  appSource,
  welcomeScreen,
  ownerPortal,
  environmentExample,
  developmentRunbook,
  cloudManifest,
  releaseStatus,
  deployScript,
] = await Promise.all([
  load('package.json'),
  load('docs/architecture/OWNER_BROWSER_ACCESS_AND_RECOVERY_CONTRACT.md'),
  load('src/App.tsx'),
  load('src/screens/WelcomeScreen.tsx'),
  load('src/lib/ownerPortal.ts'),
  load('.env.example'),
  load('docs/operations/DEVELOPMENT_ENVIRONMENT_RUNBOOK.md'),
  load('docs/operations/PRODUCTION_CLOUD_CONFIGURATION_MANIFEST.md'),
  load('docs/operations/RELEASE_STATUS.md'),
  load('scripts/deploy-hub-cloud.sh'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r020-owner-signup'],
  'node scripts/test-r020-owner-signup-contract.mjs',
  'R020 must retain a dedicated owner-signup contract command.',
);
assert.ok(packageManifest.scripts['test:all'].includes('test:r020-owner-signup'), 'The full source gate must run R020.');

for (const fragment of [
  'Account-signup configuration contract',
  'Confirm email',
  'Redirect allow-list',
  'SIGNUP_CONFIRMATION',
  'email_confirmed_at',
]) requireText(accessContract, fragment);

requireText(ownerPortal, 'VITE_OWNER_PORTAL_ORIGIN');
requireText(ownerPortal, 'VITE_SUPABASE_URL');
requireText(ownerPortal, 'VITE_SUPABASE_ANON_KEY');
requireText(ownerPortal, "purpose === 'RECOVERY'");
requireText(ownerPortal, '?auth=recovery');
requireText(ownerPortal, "purpose === 'RECOVERY'\n    ? `${configuration.approvedOrigin}?auth=recovery`\n    : configuration.approvedOrigin");
requireText(ownerPortal, "failure: 'UNAPPROVED_RUNTIME_ORIGIN'");
requireText(ownerPortal, "failure: 'MISSING_BROWSER_AUTH_CONFIGURATION'");
requireText(ownerPortal, 'isBrowserPublishableKey');
requireText(ownerPortal, "!parsed.hostname.includes('*')");
requireText(ownerPortal, "parsed.protocol !== 'https:' && !isLocalDevelopmentOrigin");

requireText(welcomeScreen, "ownerAuthRedirectUrl('SIGNUP_CONFIRMATION')");
requireText(welcomeScreen, "ownerAuthRedirectUrl('RECOVERY')");
requireText(welcomeScreen, '!ownerPortal.isReady');
requireText(welcomeScreen, 'if (!owner.email_confirmed_at)');
requireText(welcomeScreen, 'No business data was created yet.');
assert.ok(!welcomeScreen.includes('recoveryRedirectUrl'), 'Signup may not reuse the password-recovery redirect helper.');
assert.ok(
  welcomeScreen.indexOf('if (!owner.email_confirmed_at)')
    < welcomeScreen.indexOf("supabase.rpc('create_business_with_owner_and_branch'"),
  'The browser must reject an unconfirmed account before the R001 foundation RPC.',
);
assert.ok(
  welcomeScreen.indexOf("ownerAuthRedirectUrl('SIGNUP_CONFIRMATION')")
    < welcomeScreen.indexOf('supabase.auth.signUp'),
  'Signup must compute the dedicated confirmation redirect before requesting Auth.',
);
requireText(appSource, "event === 'SIGNED_IN' && session?.user && !recoveryMode");
requireText(appSource, 'void acceptOwnerIdentity({ ownerId: session.user.id });');
requireText(appSource, 'reconciledOwnerIdRef');

requireText(environmentExample, 'VITE_OWNER_PORTAL_ORIGIN=');
requireText(environmentExample, 'Supabase Auth\'s Site URL and signup');
requireText(environmentExample, '?auth=recovery');
requireText(developmentRunbook, 'VITE_OWNER_PORTAL_ORIGIN');
requireText(developmentRunbook, 'intentionally unavailable until the exact current portal origin');
for (const fragment of [
  'Email/password provider',
  'Confirm email',
  'leaked-password protection',
  'VITE_OWNER_PORTAL_ORIGIN',
]) requireText(cloudManifest, fragment);
requireText(releaseStatus, 'Owner account signup is source-guarded');
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Signup source hardening must not grant release authority.');
requireText(deployScript, 'test-r020-owner-signup-contract.mjs');

console.log('R020 owner account-signup contract checks passed');
