import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = relativePath => readFile(resolve(root, relativePath), 'utf8');

const [r001, r015, ownerAdmin, adr, packageSource] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/015_owner_control_plane_rls_hardening.sql'),
  load('src/lib/owner-admin.ts'),
  load('docs/architecture/ADR-019_OWNER_CONTROL_PLANE_AND_PUBLIC_STAFF_ENTRY.md'),
  load('package.json'),
]);

// The migration must explicitly retire the original member-wide write policies.
for (const policy of [
  'Users can manage staff for their businesses',
  'Users can update staff for their businesses',
  'Users can manage products for their businesses',
  'Users can update products for their businesses',
]) {
  assert.ok(r001.includes(policy), `R001 baseline policy missing from source fixture: ${policy}`);
  assert.ok(r015.includes(`DROP POLICY IF EXISTS "${policy}"`), `R015 must retire broad policy: ${policy}`);
}

assert.ok(r015.includes('R015_REQUIRES_OWNER_CONTROL_PLANE_BASELINE'), 'R015 must fail closed on an unknown baseline.');
assert.ok(r015.includes('private.is_business_owner(business_id)'), 'Owner writes must be checked against owner identity.');
assert.ok(r015.includes("role IN ('CASHIER', 'KITCHEN_STAFF', 'MANAGER')"), 'Browser staff creation must be limited to operational roles.');
assert.ok(r015.includes('branch.id = staff_members.branch_id'), 'Staff creation must bind the requested branch.');
assert.ok(r015.includes('branch.business_id = staff_members.business_id'), 'Staff creation must keep business/branch scope aligned.');
assert.ok(r015.includes('branch.id = catalog_products.branch_id'), 'Catalog writes must bind branch scope.');
assert.ok(r015.includes('branch.business_id = catalog_products.business_id'), 'Catalog writes must keep business/branch scope aligned.');

assert.ok(r015.includes('ON public.staff_members FOR INSERT TO authenticated'), 'Owner staff-directory creation must have an INSERT policy.');
assert.doesNotMatch(
  r015,
  /CREATE POLICY[\s\S]*?ON public\.staff_members FOR UPDATE TO authenticated/,
  'R015 must not grant direct browser staff UPDATE authority before a session-revoking workflow exists.',
);
assert.ok(r015.includes('The table-level UPDATE grant remains inert'), 'R015 must document why direct staff updates stay denied.');

assert.ok(r015.includes('ON public.catalog_products FOR INSERT TO authenticated'), 'Owner catalog creation must have an INSERT policy.');
assert.ok(r015.includes('ON public.catalog_products FOR UPDATE TO authenticated'), 'Owner catalog editing must have an UPDATE policy.');
assert.ok(!ownerAdmin.includes("supabase.from('staff_members').update"), 'Owner browser code must not directly update staff rows.');
assert.ok(!ownerAdmin.includes('stock_quantity:'), 'Owner catalog code must not overwrite physical stock.');
assert.ok(adr.includes('Role changes, deactivation and other actions that can invalidate operational authority are not implemented as casual browser table edits.'), 'ADR must preserve the staff-update authority boundary.');

const manifest = JSON.parse(packageSource);
assert.equal(manifest.scripts['test:r029-owner-control-plane-rls'], 'node scripts/test-r029-owner-control-plane-rls-contract.mjs');
assert.ok(manifest.scripts['test:all'].includes('test:r029-owner-control-plane-rls'), 'The full source gate must run R029.');

console.log('R029 owner control-plane RLS contract passed');
