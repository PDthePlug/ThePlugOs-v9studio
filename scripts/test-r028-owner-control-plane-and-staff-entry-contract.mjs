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
  marketing,
  roleEntry,
  ownerPortal,
  ownerStyles,
  ownerAdmin,
  ownerProjection,
  credentialReset,
  cashier,
  kitchen,
  manager,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('docs/architecture/ADR-019_OWNER_CONTROL_PLANE_AND_PUBLIC_STAFF_ENTRY.md'),
  load('src/screens/MarketingLanding.tsx'),
  load('src/components/RoleLoginModal.tsx'),
  load('src/components/OwnerPortalShell.tsx'),
  load('src/index.css'),
  load('src/lib/owner-admin.ts'),
  load('src/lib/owner-projection.ts'),
  load('src/components/NativeStaffCredentialResetControl.tsx'),
  load('src/workspaces/NativeCashierStation.tsx'),
  load('src/workspaces/NativeKitchenStation.tsx'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r028-owner-control-plane'],
  'node scripts/test-r028-owner-control-plane-and-staff-entry-contract.mjs',
  'R028 must retain a dedicated owner-control-plane gate.',
);
assert.ok(packageManifest.scripts['test:all'].includes('test:r028-owner-control-plane'), 'The full source gate must run R028.');

// The public site must visibly distinguish owner and staff access, and it may
// only advertise role experiences and owner insights that the runtime/data
// model actually supports.
for (const phrase of ['Owner sign in', 'Staff sign in', 'I’m staff', 'Start your shift on your shop device.']) requireText(marketing, phrase);
for (const role of ["role: 'Cashier'", "role: 'Kitchen'", "role: 'Manager'", "role: 'Owner'"]) requireText(marketing, role);
assert.ok(!marketing.includes("role: 'Administrator'"), 'Landing must not advertise an unsupported Administrator workspace.');
requireText(marketing, 'Sales, order status, stock pressure, team and device health become one synchronized owner picture when the cloud is available.');
requireText(marketing, '<span>Low stock</span><strong>18</strong>');
assert.ok(!marketing.includes('Avg. prep'), 'Landing must not advertise a preparation-duration metric that the owner data model does not record.');
assert.ok(!marketing.includes('Sales, pace,'), 'Landing must not promise owner pace analytics without recorded duration evidence.');
requireText(marketing, 'hasNativeHubHost()');
requireText(marketing, 'localHubRuntime.openNativeStaffSignIn()');
requireText(marketing, 'Staff PINs are never entered into the public website or owner portal.');
assert.ok(!marketing.includes('type="password"'), 'Marketing staff entry must never render a password/PIN input.');

// Browser owner presentation and native staff authority remain separate.
requireText(roleEntry, 'if (!nativeHost)');
requireText(roleEntry, '<OwnerPortalShell');
requireText(roleEntry, 'branches.filter((branch) => branch.isActive)');
requireText(roleEntry, 'localHubRuntime.openNativeStaffSignIn()');
requireText(roleEntry, 'localHubRuntime.getNativeOperatorContext()');
assert.ok(!roleEntry.includes('type="password"'), 'Role entry must not collect a staff PIN in React.');

// The owner experience is a real multi-section control plane, not one giant page.
for (const section of [
  "id: 'OVERVIEW'",
  "id: 'ORDERS'",
  "id: 'MENU'",
  "id: 'STOCK'",
  "id: 'FINANCE'",
  "id: 'TEAM'",
  "id: 'DEVICES'",
]) requireText(ownerPortal, section);
for (const copy of [
  'Order dashboard',
  'Products & pricing',
  'Inventory visibility',
  'Business performance',
  'Staff profiles and PIN recovery',
  'Connect the shop',
]) requireText(ownerPortal, copy);

// Phone users must be able to discover every owner section without swiping a
// hidden rail, and the order view must collapse into labeled cards rather than
// forcing horizontal panning across a desktop table.
requireText(ownerStyles, '@media (max-width: 639px)');
requireText(ownerStyles, 'nav[aria-label="Owner workspace"]');
requireText(ownerStyles, 'grid-template-columns: repeat(2, minmax(0, 1fr))');
requireText(ownerStyles, 'table tbody td:nth-child(1)::before { content: "Order"; }');
requireText(ownerStyles, 'table tbody td:nth-child(6)::before { content: "Total"; }');

// Catalog management is real owner RLS data, but stock quantities are not browser-overwritten.
requireText(ownerAdmin, "supabase.from('catalog_products').insert");
requireText(ownerAdmin, "supabase.from('catalog_products').update");
requireText(ownerAdmin, "status: active ? 'ACTIVE' : 'INACTIVE'");
assert.ok(!ownerAdmin.includes('stock_quantity:'), 'Owner catalog mutations must not write physical stock quantity.');
requireText(ownerProjection, 'description, stock_quantity, unit_of_measure, cost_price, status');
requireText(ownerPortal, 'Physical stock quantities are deliberately controlled by the shop inventory workflow.');
requireText(ownerPortal, 'Receipts, counts, corrections and waste remain physical Manager tasks');

// Staff profile creation is directory-only; credential activation remains native.
requireText(ownerAdmin, "const OPERATIONAL_STAFF_ROLES: UserRole[] = ['CASHIER', 'KITCHEN_STAFF', 'MANAGER']");
requireText(ownerAdmin, "supabase.from('staff_members').insert");
assert.ok(!ownerAdmin.includes('pin_hash'), 'Owner staff-profile creation must not write the legacy PIN column at all.');
assert.ok(!ownerAdmin.includes('password'), 'Owner staff-profile creation must not accept a password/PIN credential.');
requireText(ownerPortal, 'This creates a profile only. It does not create a PIN or operational session.');
requireText(credentialReset, "action: 'issue-staff-credential-reset-code'");
requireText(credentialReset, 'Replacement PINs are entered only on the native Android reset screen.');

// Finance surfaces must be honest about what synchronized facts do and do not prove.
requireText(ownerPortal, 'Captured sales · 30 days');
requireText(ownerPortal, 'Open / unpaid value');
requireText(ownerPortal, 'ThePlugOS will not invent profit');
requireText(ownerPortal, 'Profit, tax liability and bank settlement are therefore not presented as verified financial results yet.');

for (const [source, heading] of [
  [cashier, 'Sell, take payment, hand over'],
  [kitchen, 'Cook the queue'],
  [manager, 'Run the shift'],
]) requireText(source, heading);

for (const phrase of [
  'Owner sign in / Set up my business',
  'Staff sign in',
  'A staff PIN is never typed into, stored by, or verified by the public website or owner portal.',
  'Production readiness remains **HOLD**',
]) requireText(adr, phrase);
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Owner-portal hardening must not grant production release authority.');

console.log('R028 owner control plane and public staff-entry contract passed');
