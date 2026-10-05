import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, r005, r006, r007, contract, router, verifier, runtime, database, models, plugin, bridge, managerUi, managerPanel, syncEndpoint, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('supabase/migrations/005_cash_shift_and_capture.sql'),
  load('supabase/migrations/006_cash_shift_close.sql'),
  load('supabase/migrations/007_inventory_receipt.sql'),
  load('docs/architecture/LOCAL_FIRST_INVENTORY_RECEIPT_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubModels.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/ThePlugOSLocalHubPlugin.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('src/workspaces/ManagerInventoryReceiptPanel.tsx'),
  load('supabase/functions/hub-sync/index.ts'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, "type: 'inventory.receive'");
requireText(contract, 'Manager');
requireText(contract, 'No staging, deployment, Supabase mutation');
requireText(router, '"inventory.receive" -> receiveInventory(command, context)');
requireText(router, 'private fun receiveInventory(');
requireText(router, '"INVENTORY_RECEIVED"');
requireText(router, 'MAX_INVENTORY_RECEIPT_LINES = 100');
requireText(router, 'command.payload.requireExactFields(setOf("receiptId", "items"), "Inventory receipt")');
requireText(verifier, '"MANAGER" -> setOf(');
requireText(verifier, '"inventory.receive"');
requireText(runtime, '"inventory.receive"');
requireText(database, '"inventory.receive"');
requireText(models, 'data class NativeInventoryProduct(');
requireText(plugin, 'put("inventoryProducts", JSArray().apply');
requireText(bridge, "| 'inventory.receive'", 'The bridge must expose the receipt command type.');
requireText(managerUi, 'ManagerInventoryReceiptPanel');
requireText(managerPanel, 'Record counted receipt locally');
requireText(managerPanel, 'Supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable.');
assert.ok(!managerUi.includes('supabase'), 'Manager receipt UI must not mutate Supabase directly.');
assert.ok(!managerPanel.includes('product.price'), 'Manager receipt panel must not render price facts.');
assert.ok(!managerPanel.includes('supplierName'), 'Manager receipt panel must not render supplier facts.');
requireText(syncEndpoint, "'r007_ingest_hub_inventory_events'");
requireText(syncEndpoint, "if (action === 'INVENTORY_RECEIVED') return 'r007_ingest_hub_inventory_events';");
requireText(r007, 'R007_REQUIRES_ACCEPTED_R006');
requireText(r007, "'INVENTORY_RECEIVED'");
requireText(r007, 'CREATE TABLE public.inventory_receipts');
requireText(r007, 'CREATE TABLE public.inventory_receipt_lines');
requireText(r007, 'R007_INVENTORY_RECEIPT_ROLE_OR_SCOPE_FORBIDDEN');
requireText(r007, 'R007_INVENTORY_RECEIPT_STOCK_BALANCE_MISMATCH');
requireText(r007, 'CREATE OR REPLACE FUNCTION public.r007_ingest_hub_inventory_events');
requireText(releaseStatus, 'inventory-receipt workflow');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000111',
  business: '10000000-0000-4000-8000-000000000111',
  branch: '11000000-0000-4000-8000-000000000111',
  device: '12000000-0000-4000-8000-000000000111',
  cashier: '20000000-0000-4000-8000-000000000111',
  manager: '20000000-0000-4000-8000-000000000112',
  cashierSession: '30000000-0000-4000-8000-000000000111',
  managerSession: '30000000-0000-4000-8000-000000000112',
  bundle: '31000000-0000-4000-8000-000000000111',
  product: '40000000-0000-4000-8000-000000000111',
  receipt: '41000000-0000-4000-8000-000000000111',
  staleReceipt: '41000000-0000-4000-8000-000000000112',
  duplicateLineReceipt: '41000000-0000-4000-8000-000000000113',
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
  // PGlite has no JWT issuer; these envelope syntax checks are independently
  // exercised by the R002 source harness and are unrelated to receipt facts.
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
      to_regprocedure('public.r007_ingest_hub_inventory_events(text,uuid,jsonb)')::text AS ingest,
      (SELECT count(*)::integer FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory_movements' AND column_name = 'receipt_id') AS receipt_origin_column,
      (SELECT count(*)::integer FROM pg_constraint
        WHERE conrelid = 'public.inventory_movements'::regclass
          AND conname = 'inventory_movements_quantity_delta_direction_check') AS direction_check;
  `);
  assert.deepEqual(schema.rows[0], {
    ingest: 'r007_ingest_hub_inventory_events(text,uuid,jsonb)',
    receipt_origin_column: 1,
    direction_check: 1,
  });

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES (${quote(fixture.owner)}, 'inventory-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${quote(fixture.business)}, 'Inventory receipt test', ${quote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, 'Inventory branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${quote(fixture.device)}, 'HUB-INVENTORY-RECEIPT', ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Inventory Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
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
      ${quote(fixture.product)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Maize meal', 'Staples', 25, 8, 'bag', 'ACTIVE'
    );
    INSERT INTO public.inventory_branch_balances (branch_id, product_id, business_id, quantity)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.product)}, ${quote(fixture.business)}, 8);
  `);

  const cloudEvent = ({ eventId, commandId, receiptId, staffId, sessionId, sequence, items }) => ({
    eventId,
    commandId,
    entityId: receiptId,
    entityType: 'inventory_receipt',
    action: 'INVENTORY_RECEIVED',
    businessId: fixture.business,
    branchId: fixture.branch,
    deviceId: 'HUB-INVENTORY-RECEIPT',
    staffId,
    staffSessionId: sessionId,
    sequence,
    eventOrdinal: 0,
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    payload: { id: receiptId, receiptId, status: 'RECEIVED', items },
  });
  const ingest = async (event) => {
    const result = await db.query(
      'SELECT public.r007_ingest_hub_inventory_events($1::text, $2::uuid, $3::jsonb) AS receipt',
      ['HUB-INVENTORY-RECEIPT', fixture.bundle, JSON.stringify([event])],
    );
    assert.deepEqual(result.rows[0].receipt, { acknowledgedEventIds: [event.eventId] });
  };
  const receiptItem = (quantity, stockBefore, stockAfter) => ({
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
        '60000000-0000-4000-8000-000000000111', '50000000-0000-4000-8000-000000000111', ${quote(fixture.receipt)}, 'inventory_receipt', 'INVENTORY_RECEIVED',
        ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, ${quote(fixture.cashierSession)},
        1, 0, now(), 1, ${quote(JSON.stringify({ id: fixture.receipt, receiptId: fixture.receipt, status: 'RECEIVED', items: [receiptItem(12, 8, 20)] }))}::jsonb,
        decode(repeat('00', 32), 'hex')
      );
    `),
    (error) => error instanceof Error && error.message.includes('R007_INVENTORY_RECEIPT_ROLE_OR_SCOPE_FORBIDDEN'),
    'A Cashier cannot enter an inventory receipt directly.',
  );

  const stale = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000112',
    commandId: '50000000-0000-4000-8000-000000000112',
    receiptId: fixture.staleReceipt,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    items: [receiptItem(12, 7, 19)],
  });
  await assert.rejects(
    () => ingest(stale),
    (error) => error instanceof Error && error.message.includes('R007_INVENTORY_RECEIPT_STOCK_BALANCE_MISMATCH'),
    'A stale server stock fact must reject the entire receipt.',
  );
  const afterStale = await db.query(`
    SELECT
      (SELECT count(*)::integer FROM public.inventory_receipts) AS receipts,
      (SELECT quantity::text FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)}) AS balance;
  `);
  assert.deepEqual(afterStale.rows[0], { receipts: 0, balance: '8.000' });

  const valid = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000113',
    commandId: '50000000-0000-4000-8000-000000000113',
    receiptId: fixture.receipt,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    items: [receiptItem(12, 8, 20)],
  });
  await ingest(valid);
  await ingest(valid);
  const acceptedFacts = await db.query(`
    SELECT
      (SELECT quantity::text FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)}) AS balance,
      (SELECT count(*)::integer FROM public.inventory_receipts WHERE receipt_id = ${quote(fixture.receipt)}) AS receipt_count,
      (SELECT count(*)::integer FROM public.inventory_receipt_lines WHERE receipt_id = ${quote(fixture.receipt)}) AS line_count,
      (SELECT movement_type FROM public.inventory_movements WHERE receipt_id = ${quote(fixture.receipt)} LIMIT 1) AS movement_type,
      (SELECT count(*)::integer FROM public.hub_events WHERE event_id = ${quote(valid.eventId)}) AS event_count;
  `);
  assert.deepEqual(acceptedFacts.rows[0], {
    balance: '20.000',
    receipt_count: 1,
    line_count: 1,
    movement_type: 'MANAGER_RECEIPT',
    event_count: 1,
  });

  const duplicateLine = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000114',
    commandId: '50000000-0000-4000-8000-000000000114',
    receiptId: fixture.duplicateLineReceipt,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    items: [receiptItem(1, 20, 21), receiptItem(2, 21, 23)],
  });
  await assert.rejects(
    () => ingest(duplicateLine),
    (error) => error instanceof Error && error.message.includes('R007_INVENTORY_RECEIPT_DUPLICATE_PRODUCT'),
    'A receipt cannot add the same product twice.',
  );
  const finalBalance = await db.query(`SELECT quantity::text AS balance FROM public.inventory_branch_balances WHERE branch_id = ${quote(fixture.branch)} AND product_id = ${quote(fixture.product)};`);
  assert.equal(finalBalance.rows[0].balance, '20.000', 'A rejected duplicate line cannot change stock.');
} finally {
  await db.close();
}

console.log('R011 inventory receipt contract checks passed');
