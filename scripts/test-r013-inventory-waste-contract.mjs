import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, r005, r006, r007, r008, r009, contract, router, verifier, runtime, database, bridge, managerUi, managerPanel, syncEndpoint, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('supabase/migrations/005_cash_shift_and_capture.sql'),
  load('supabase/migrations/006_cash_shift_close.sql'),
  load('supabase/migrations/007_inventory_receipt.sql'),
  load('supabase/migrations/008_inventory_count_correction.sql'),
  load('supabase/migrations/009_inventory_waste.sql'),
  load('docs/architecture/LOCAL_FIRST_INVENTORY_WASTE_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('src/workspaces/ManagerInventoryWastePanel.tsx'),
  load('supabase/functions/hub-sync/index.ts'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, "type: 'inventory.waste'");
requireText(contract, "'SPOILAGE' | 'DAMAGE' | 'EXPIRED'");
requireText(contract, 'No staging, deployment, Supabase mutation');
requireText(router, '"inventory.waste" -> wasteInventory(command, context)');
requireText(router, 'private fun wasteInventory(');
requireText(router, '"INVENTORY_WASTED"');
requireText(router, 'MAX_INVENTORY_WASTE_LINES = 100');
requireText(router, 'command.payload.requireExactFields(setOf("wasteId", "reason", "items"), "Inventory waste")');
requireText(verifier, '"inventory.adjust", "inventory.waste"');
requireText(runtime, '"inventory.adjust", "inventory.waste"');
requireText(database, '"inventory.adjust", "inventory.waste"');
requireText(bridge, "| 'inventory.waste';");
requireText(managerUi, 'ManagerInventoryWastePanel');
requireText(managerPanel, 'Record waste locally');
requireText(managerPanel, 'Waste, supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable.');
assert.ok(!managerUi.includes('supabase'), 'Manager waste UI must not mutate Supabase directly.');
assert.ok(!managerPanel.includes('product.price'), 'Manager waste panel must not render price facts.');
assert.ok(!managerPanel.includes('supplierName'), 'Manager waste panel must not render supplier facts.');
requireText(syncEndpoint, "'r009_ingest_hub_inventory_waste_events'");
requireText(syncEndpoint, "if (action === 'INVENTORY_WASTED') return 'r009_ingest_hub_inventory_waste_events';");
requireText(r009, 'R009_REQUIRES_ACCEPTED_R008');
requireText(r009, "'INVENTORY_WASTED'");
requireText(r009, 'CREATE TABLE public.inventory_waste');
requireText(r009, 'CREATE TABLE public.inventory_waste_lines');
requireText(r009, 'R009_INVENTORY_WASTE_ROLE_OR_SCOPE_FORBIDDEN');
requireText(r009, 'R009_INVENTORY_WASTE_STOCK_BALANCE_MISMATCH');
requireText(r009, 'CREATE OR REPLACE FUNCTION public.r009_ingest_hub_inventory_waste_events');
requireText(releaseStatus, 'inventory-waste workflow');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000131',
  business: '10000000-0000-4000-8000-000000000131',
  branch: '11000000-0000-4000-8000-000000000131',
  device: '12000000-0000-4000-8000-000000000131',
  cashier: '20000000-0000-4000-8000-000000000131',
  manager: '20000000-0000-4000-8000-000000000132',
  cashierSession: '30000000-0000-4000-8000-000000000131',
  managerSession: '30000000-0000-4000-8000-000000000132',
  bundle: '31000000-0000-4000-8000-000000000131',
  product: '40000000-0000-4000-8000-000000000131',
  waste: '41000000-0000-4000-8000-000000000131',
  staleWaste: '41000000-0000-4000-8000-000000000132',
  duplicateLineWaste: '41000000-0000-4000-8000-000000000133',
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
  await db.exec(r009);
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
      to_regprocedure('public.r009_ingest_hub_inventory_waste_events(text,uuid,jsonb)')::text AS ingest,
      (SELECT count(*)::integer FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory_movements' AND column_name = 'waste_id') AS waste_origin_column,
      (SELECT count(*)::integer FROM pg_constraint
        WHERE conrelid = 'public.inventory_movements'::regclass
          AND conname = 'inventory_movements_origin_check') AS origin_check;
  `);
  assert.deepEqual(schema.rows[0], {
    ingest: 'r009_ingest_hub_inventory_waste_events(text,uuid,jsonb)',
    waste_origin_column: 1,
    origin_check: 1,
  });

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES (${quote(fixture.owner)}, 'waste-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${quote(fixture.business)}, 'Inventory waste test', ${quote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, 'Waste branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${quote(fixture.device)}, 'HUB-INVENTORY-WASTE', ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Waste Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
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

  const cloudEvent = ({ eventId, commandId, wasteId, staffId, sessionId, sequence, reason = 'SPOILAGE', items }) => ({
    eventId,
    commandId,
    entityId: wasteId,
    entityType: 'inventory_waste',
    action: 'INVENTORY_WASTED',
    businessId: fixture.business,
    branchId: fixture.branch,
    deviceId: 'HUB-INVENTORY-WASTE',
    staffId,
    staffSessionId: sessionId,
    sequence,
    eventOrdinal: 0,
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    payload: { id: wasteId, wasteId, status: 'RECORDED', reason, items },
  });
  const ingest = async (event) => {
    const result = await db.query(
      'SELECT public.r009_ingest_hub_inventory_waste_events($1::text, $2::uuid, $3::jsonb) AS receipt',
      ['HUB-INVENTORY-WASTE', fixture.bundle, JSON.stringify([event])],
    );
    assert.deepEqual(result.rows[0].receipt, { acknowledgedEventIds: [event.eventId] });
  };
  const wasteItem = (quantity, stockBefore, stockAfter) => ({
    productId: fixture.product,
    quantity,
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
        '60000000-0000-4000-8000-000000000131', '50000000-0000-4000-8000-000000000131', ${quote(fixture.waste)}, 'inventory_waste', 'INVENTORY_WASTED',
        ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, ${quote(fixture.cashierSession)},
        1, 0, now(), 1, ${quote(JSON.stringify({ id: fixture.waste, wasteId: fixture.waste, status: 'RECORDED', reason: 'SPOILAGE', items: [wasteItem(3, 8, 5)] }))}::jsonb,
        decode(repeat('00', 32), 'hex')
      );
    `),
    (error) => error instanceof Error && error.message.includes('R009_INVENTORY_WASTE_ROLE_OR_SCOPE_FORBIDDEN'),
    'A Cashier cannot enter inventory waste directly.',
  );

  const stale = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000132',
    commandId: '50000000-0000-4000-8000-000000000132',
    wasteId: fixture.staleWaste,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    items: [wasteItem(3, 7, 4)],
  });
  await assert.rejects(
    () => ingest(stale),
    (error) => error instanceof Error && error.message.includes('R009_INVENTORY_WASTE_STOCK_BALANCE_MISMATCH'),
    'A stale server stock fact must reject the entire waste record.',
  );
  const afterStale = await db.query(`
    SELECT
      (SELECT count(*)::integer FROM public.inventory_waste) AS waste_records,
      (SELECT quantity::text FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)}) AS balance;
  `);
  assert.deepEqual(afterStale.rows[0], { waste_records: 0, balance: '8.000' });

  const valid = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000133',
    commandId: '50000000-0000-4000-8000-000000000133',
    wasteId: fixture.waste,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    reason: 'DAMAGE',
    items: [wasteItem(3, 8, 5)],
  });
  await ingest(valid);
  await ingest(valid);
  const acceptedFacts = await db.query(`
    SELECT
      (SELECT quantity::text FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)}) AS balance,
      (SELECT count(*)::integer FROM public.inventory_waste WHERE waste_id = ${quote(fixture.waste)}) AS waste_count,
      (SELECT count(*)::integer FROM public.inventory_waste_lines WHERE waste_id = ${quote(fixture.waste)}) AS line_count,
      (SELECT movement_type FROM public.inventory_movements WHERE waste_id = ${quote(fixture.waste)} LIMIT 1) AS movement_type,
      (SELECT quantity_delta::text FROM public.inventory_movements WHERE waste_id = ${quote(fixture.waste)} LIMIT 1) AS quantity_delta,
      (SELECT reason FROM public.inventory_waste WHERE waste_id = ${quote(fixture.waste)}) AS reason,
      (SELECT count(*)::integer FROM public.hub_events WHERE event_id = ${quote(valid.eventId)}) AS event_count;
  `);
  assert.deepEqual(acceptedFacts.rows[0], {
    balance: '5.000',
    waste_count: 1,
    line_count: 1,
    movement_type: 'MANAGER_WASTE',
    quantity_delta: '-3.000',
    reason: 'DAMAGE',
    event_count: 1,
  });

  const insufficient = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000134',
    commandId: '50000000-0000-4000-8000-000000000134',
    wasteId: fixture.staleWaste,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    items: [wasteItem(6, 5, -1)],
  });
  await assert.rejects(
    () => ingest(insufficient),
    (error) => error instanceof Error && error.message.includes('R009_INVENTORY_WASTE_STOCK_FACTS_INVALID'),
    'Waste cannot exceed the current signed balance.',
  );

  const duplicateLine = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000135',
    commandId: '50000000-0000-4000-8000-000000000135',
    wasteId: fixture.duplicateLineWaste,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    items: [wasteItem(1, 5, 4), wasteItem(1, 4, 3)],
  });
  await assert.rejects(
    () => ingest(duplicateLine),
    (error) => error instanceof Error && error.message.includes('R009_INVENTORY_WASTE_DUPLICATE_PRODUCT'),
    'A waste record cannot contain the same product twice.',
  );
  const finalBalance = await db.query(`SELECT quantity::text AS balance FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)};`);
  assert.equal(finalBalance.rows[0].balance, '5.000', 'A rejected waste record cannot change stock.');
} finally {
  await db.close();
}

console.log('R013 inventory-waste contract checks passed');
