import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [migration, router, database, runtime, authorityClient, syncEndpoint, contract] = await Promise.all([
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCloudAuthorityClient.kt'),
  load('supabase/functions/hub-sync/index.ts'),
  load('docs/architecture/LOCAL_FIRST_INVENTORY_AND_RENEWAL_CONTRACT.md'),
]);

function requireText(subject, fragment) {
  assert.ok(subject.includes(fragment), `Expected source to contain: ${fragment}`);
}

requireText(contract, 'Bundle-renewal barrier');
requireText(contract, 'Bundle-delivery recovery');
requireText(contract, 'Expired-bundle recovery');
requireText(contract, 'inventory_branch_balances');

requireText(migration, 'CREATE TABLE public.inventory_branch_balances');
requireText(migration, 'CREATE TABLE public.inventory_movements');
requireText(migration, "FOREIGN KEY (branch_id, product_id)");
requireText(migration, "REFERENCES public.inventory_branch_balances(branch_id, product_id)");
requireText(migration, "'ORDER_RESERVATION'");
requireText(migration, "'ORDER_CANCELLATION_RELEASE'");
requireText(migration, "'stockBefore', 'stockAfter'");
requireText(migration, "AND expires_at > now() - interval '7 days'");
requireText(migration, "'state', CASE WHEN v_bundle.is_active AND v_bundle.expires_at > now() THEN 'ACTIVE' ELSE 'RECOVERY' END");
requireText(migration, 'v_recovery_mode AND v_occurred_at > v_bundle.expires_at');
requireText(migration, 'superseded_at IS NOT NULL AND superseded_at > now() - interval \'7 days\'');

const projection = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION private.r003_project_hub_order_event'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.r003_get_hub_sync_context'),
);
assert.ok(projection.length > 0, 'Expected the R003 order projection function.');
assert.ok(!projection.includes('UPDATE public.catalog_products'), 'Order projection must update branch balances, not shared catalog stock.');
requireText(projection, 'UPDATE public.inventory_branch_balances');
requireText(projection, 'p_staff_session_id');

requireText(router, '.put("stockBefore", stockBefore)');
requireText(router, '.put("stockAfter", stockAfter)');
requireText(database, 'DEFERRED_UNTIL_SYNC');
requireText(database, 'hasUnacknowledgedOperationalEvents');
requireText(runtime, 'requireEmptyOperationalOutboxForBundleInstall');
requireText(authorityClient, 'requireNoPendingEventsForAuthorityChange');
requireText(syncEndpoint, "context.state !== 'ACTIVE' && context.state !== 'RECOVERY'");

const maintenance = runtime.slice(
  runtime.indexOf('private fun maintainCloudAuthorityAndSync()'),
  runtime.indexOf('private fun renewalDue('),
);
assert.ok(maintenance.indexOf('cloudSync.syncOnce()') >= 0, 'Cloud sync must run during maintenance.');
assert.ok(maintenance.indexOf('cloudAuthority.renewAuthorizationBundle()') >= 0, 'Bundle renewal must run during maintenance.');
assert.ok(
  maintenance.indexOf('cloudSync.syncOnce()') < maintenance.indexOf('cloudAuthority.renewAuthorizationBundle()'),
  'Cloud sync must run before bundle renewal.',
);
requireText(maintenance, 'database.outboxDepth() == 0');

console.log('R003 local Hub inventory and renewal contract checks passed');
