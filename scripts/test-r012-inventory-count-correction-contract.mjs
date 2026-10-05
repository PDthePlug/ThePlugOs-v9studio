import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, r005, r006, r007, r008, contract, router, verifier, runtime, database, bridge, managerUi, managerPanel, syncEndpoint, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('supabase/migrations/005_cash_shift_and_capture.sql'),
  load('supabase/migrations/006_cash_shift_close.sql'),
  load('supabase/migrations/007_inventory_receipt.sql'),
  load('supabase/migrations/008_inventory_count_correction.sql'),
  load('docs/architecture/LOCAL_FIRST_INVENTORY_COUNT_CORRECTION_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('src/workspaces/ManagerInventoryAdjustmentPanel.tsx'),
  load('supabase/functions/hub-sync/index.ts'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, "type: 'inventory.adjust'");
requireText(contract, 'COUNT_CORRECTION');
requireText(contract, 'No staging, deployment, Supabase mutation');
requireText(router, '"inventory.adjust" -> adjustInventory(command, context)');
requireText(router, 'private fun adjustInventory(');
requireText(router, '"INVENTORY_ADJUSTED"');
requireText(router, 'MAX_INVENTORY_ADJUSTMENT_LINES = 100');
requireText(router, 'command.payload.requireExactFields(setOf("adjustmentId", "reason", "items"), "Inventory count correction")');
requireText(verifier, '"inventory.receive", "inventory.adjust"');
requireText(runtime, '"inventory.receive", "inventory.adjust"');
requireText(database, '"inventory.receive", "inventory.adjust"');
requireText(bridge, "| 'inventory.adjust'");
requireText(managerUi, 'ManagerInventoryAdjustmentPanel');
requireText(managerPanel, 'Record count correction locally');
requireText(managerPanel, 'Waste, supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable.');
assert.ok(!managerUi.includes('supabase'), 'Manager correction UI must not mutate Supabase directly.');
assert.ok(!managerPanel.includes('product.price'), 'Manager correction panel must not render price facts.');
assert.ok(!managerPanel.includes('supplierName'), 'Manager correction panel must not render supplier facts.');
requireText(syncEndpoint, "'r008_ingest_hub_inventory_adjustment_events'");
requireText(syncEndpoint, "if (action === 'INVENTORY_ADJUSTED') return 'r008_ingest_hub_inventory_adjustment_events';");
requireText(r008, 'R008_REQUIRES_ACCEPTED_R007');
requireText(r008, "'INVENTORY_ADJUSTED'");
requireText(r008, 'CREATE TABLE public.inventory_adjustments');
requireText(r008, 'CREATE TABLE public.inventory_adjustment_lines');
requireText(r008, 'R008_INVENTORY_ADJUSTMENT_ROLE_OR_SCOPE_FORBIDDEN');
requireText(r008, 'R008_INVENTORY_ADJUSTMENT_STOCK_BALANCE_MISMATCH');
requireText(r008, 'CREATE OR REPLACE FUNCTION public.r008_ingest_hub_inventory_adjustment_events');
requireText(releaseStatus, 'inventory-count-correction workflow');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000121',
  business: '10000000-0000-4000-8000-000000000121',
  branch: '11000000-0000-4000-8000-000000000121',
  device: '12000000-0000-4000-8000-000000000121',
  cashier: '20000000-0000-4000-8000-000000000121',
  manager: '20000000-0000-4000-8000-000000000122',
  cashierSession: '30000000-0000-4000-8000-000000000121',
  managerSession: '30000000-0000-4000-8000-000000000122',
  bundle: '31000000-0000-4000-8000-000000000121',
  product: '40000000-0000-4000-8000-000000000121',
  adjustment: '41000000-0000-4000-8000-000000000121',
  staleAdjustment: '41000000-0000-4000-8000-000000000122',
  duplicateLineAdjustment: '41000000-0000-4000-8000-000000000123',
});

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID LANGUAGE sql STABLE
    AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::UUID';
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT LANGUAGE sql STABLE
    AS 'SELECT NULLIF(current_setting(''request.jwt.claim.role'', true), '''')';
  `);
  await db.exec(r001);
  await db.exec('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;');
  await db.exec(r002);
  await db.exec(r003);
  await db.exec(r004);
  await db.exec(r005);
  await db.exec(r006);
  await db.exec(r007);
  await db.exec(r008);
  await db.exec(`
    ALTER TABLE public.hub_authorization_bundles
      DROP CONSTRAINT IF EXISTS hub_authorization_bundles_issuer_key_id_check;
    ALTER TABLE public.hub_authorization_bundles
      DROP CONSTRAINT IF EXISTS hub_authorization_bundles_payload_base64_check;
    ALTER TABLE public.hub_authorization_bundles
      DROP CONSTRAINT IF EXISTS hub_authorization_bundles_signature_base64_check;
  `);

  const schema = await db.query(`
    SELECT
      to_regprocedure('public.r008_ingest_hub_inventory_adjustment_events(text,uuid,jsonb)')::text AS ingest,
      (SELECT count(*)::integer FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory_movements' AND column_name = 'adjustment_id') AS adjustment_origin_column,
      (SELECT count(*)::integer FROM pg_constraint
        WHERE conrelid = 'public.inventory_movements'::regclass
          AND conname = 'inventory_movements_origin_check') AS origin_check;
  `);
  assert.deepEqual(schema.rows[0], {
    ingest: 'r008_ingest_hub_inventory_adjustment_events(text,uuid,jsonb)',
    adjustment_origin_column: 1,
    origin_check: 1,
  });

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES (${quote(fixture.owner)}, 'correction-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${quote(fixture.business)}, 'Count correction test', ${quote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, 'Correction branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${quote(fixture.device)}, 'HUB-COUNT-CORRECTION', ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Correction Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
    INSERT INTO public.hub_branch_authority (branch_id, business_id, active_hub_device_id, revocation_version)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, ${quote(fixture.device)}, 0);
    INSERT INTO public.hub_authorization_bundles (
      bundle_id, business_id, branch_id, hub_device_id, issuer_key_id,
      payload_base64, signature_base64, payload_sha256,
      issued_at, expires_at, revocation_version, is_active
    ) VALUES (
      ${quote(fixture.bundle)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, 'test-issuer',
      'AA', 'AAAAAAAA', decode(repeat('00', 32), 'hex'),
      now() - interval '1 minute', now() + interval '1 hour', 0, true
    );
    INSERT INTO public.staff_members (id, business_id, branch_id, name, role, status)
    VALUES
      (${quote(fixture.cashier)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Cashier', 'CASHIER', 'ACTIVE'),
      (${quote(fixture.manager)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Manager', 'MANAGER', 'ACTIVE');
    INSERT INTO public.hub_staff_sessions (
      session_id, business_id, branch_id, hub_device_id, staff_id, role, revocation_version, status, expires_at, activated_at
    ) VALUES
      (${quote(fixture.cashierSession)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, 'CASHIER', 0, 'ACTIVE', now() + interval '1 hour', now()),
      (${quote(fixture.managerSession)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.manager)}, 'MANAGER', 0, 'ACTIVE', now() + interval '1 hour', now());
    INSERT INTO public.catalog_products (
      id, business_id, branch_id, name, category, price, stock_quantity, unit_of_measure, status
    ) VALUES (
      ${quote(fixture.product)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Cooking oil', 'Staples', 65, 8, 'bottle', 'ACTIVE'
    );
    INSERT INTO public.inventory_branch_balances (branch_id, product_id, business_id, quantity)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.product)}, ${quote(fixture.business)}, 8);
  `);

  const cloudEvent = ({ eventId, commandId, adjustmentId, staffId, sessionId, sequence, items }) => ({
    eventId,
    commandId,
    entityId: adjustmentId,
    entityType: 'inventory_adjustment',
    action: 'INVENTORY_ADJUSTED',
    businessId: fixture.business,
    branchId: fixture.branch,
    deviceId: 'HUB-COUNT-CORRECTION',
    staffId,
    staffSessionId: sessionId,
    sequence,
    eventOrdinal: 0,
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    payload: { id: adjustmentId, adjustmentId, status: 'ADJUSTED', reason: 'COUNT_CORRECTION', items },
  });
  const ingest = async (event) => {
    const result = await db.query(
      'SELECT public.r008_ingest_hub_inventory_adjustment_events($1::text, $2::uuid, $3::jsonb) AS receipt',
      ['HUB-COUNT-CORRECTION', fixture.bundle, JSON.stringify([event])],
    );
    assert.deepEqual(result.rows[0].receipt, { acknowledgedEventIds: [event.eventId] });
  };
  const correctionItem = (quantityDelta, stockBefore, stockAfter) => ({
    productId: fixture.product,
    quantityDelta,
    stockBefore,
    stockAfter,
  });

  await assert.rejects(
    () => db.exec(`
      INSERT INTO public.hub_events (
        event_id, command_id, aggregate_id, aggregate_type, action,
        business_id, branch_id, hub_device_id, staff_id, staff_session_id,
        sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
      ) VALUES (
        '60000000-0000-4000-8000-000000000121', '50000000-0000-4000-8000-000000000121', ${quote(fixture.adjustment)}, 'inventory_adjustment', 'INVENTORY_ADJUSTED',
        ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, ${quote(fixture.cashierSession)},
        1, 0, now(), 1, ${quote(JSON.stringify({ id: fixture.adjustment, adjustmentId: fixture.adjustment, status: 'ADJUSTED', reason: 'COUNT_CORRECTION', items: [correctionItem(-3, 8, 5)] }))}::jsonb,
        decode(repeat('00', 32), 'hex')
      );
    `),
    (error) => error instanceof Error && error.message.includes('R008_INVENTORY_ADJUSTMENT_ROLE_OR_SCOPE_FORBIDDEN'),
    'A Cashier cannot enter a count correction directly.',
  );

  const stale = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000122',
    commandId: '50000000-0000-4000-8000-000000000122',
    adjustmentId: fixture.staleAdjustment,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    items: [correctionItem(-3, 7, 4)],
  });
  await assert.rejects(
    () => ingest(stale),
    (error) => error instanceof Error && error.message.includes('R008_INVENTORY_ADJUSTMENT_STOCK_BALANCE_MISMATCH'),
    'A stale server stock fact must reject the entire count correction.',
  );
  const afterStale = await db.query(`
    SELECT
      (SELECT count(*)::integer FROM public.inventory_adjustments) AS corrections,
      (SELECT quantity::text FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)}) AS balance;
  `);
  assert.deepEqual(afterStale.rows[0], { corrections: 0, balance: '8.000' });

  const valid = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000123',
    commandId: '50000000-0000-4000-8000-000000000123',
    adjustmentId: fixture.adjustment,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    items: [correctionItem(-3, 8, 5)],
  });
  await ingest(valid);
  await ingest(valid);
  const acceptedFacts = await db.query(`
    SELECT
      (SELECT quantity::text FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)}) AS balance,
      (SELECT count(*)::integer FROM public.inventory_adjustments WHERE adjustment_id = ${quote(fixture.adjustment)}) AS correction_count,
      (SELECT count(*)::integer FROM public.inventory_adjustment_lines WHERE adjustment_id = ${quote(fixture.adjustment)}) AS line_count,
      (SELECT movement_type FROM public.inventory_movements WHERE adjustment_id = ${quote(fixture.adjustment)} LIMIT 1) AS movement_type,
      (SELECT quantity_delta::text FROM public.inventory_movements WHERE adjustment_id = ${quote(fixture.adjustment)} LIMIT 1) AS quantity_delta,
      (SELECT count(*)::integer FROM public.hub_events WHERE event_id = ${quote(valid.eventId)}) AS event_count;
  `);
  assert.deepEqual(acceptedFacts.rows[0], {
    balance: '5.000',
    correction_count: 1,
    line_count: 1,
    movement_type: 'MANAGER_COUNT_CORRECTION',
    quantity_delta: '-3.000',
    event_count: 1,
  });

  const noOp = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000124',
    commandId: '50000000-0000-4000-8000-000000000124',
    adjustmentId: fixture.duplicateLineAdjustment,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    items: [correctionItem(0, 5, 5)],
  });
  await assert.rejects(
    () => ingest(noOp),
    (error) => error instanceof Error && error.message.includes('R008_INVENTORY_ADJUSTMENT_STOCK_FACTS_INVALID'),
    'A no-op count correction cannot enter the ledger.',
  );

  const duplicateLine = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000125',
    commandId: '50000000-0000-4000-8000-000000000125',
    adjustmentId: fixture.duplicateLineAdjustment,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    items: [correctionItem(-1, 5, 4), correctionItem(1, 4, 5)],
  });
  await assert.rejects(
    () => ingest(duplicateLine),
    (error) => error instanceof Error && error.message.includes('R008_INVENTORY_ADJUSTMENT_DUPLICATE_PRODUCT'),
    'A count correction cannot contain the same product twice.',
  );
  const finalBalance = await db.query(`SELECT quantity::text AS balance FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)};`);
  assert.equal(finalBalance.rows[0].balance, '5.000', 'A rejected correction cannot change stock.');
} finally {
  await db.close();
}

console.log('R012 inventory count-correction contract checks passed');
