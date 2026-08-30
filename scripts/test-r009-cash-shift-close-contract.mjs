import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, r005, r006, contract, router, verifier, runtime, database, bridge, managerUi, syncEndpoint, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('supabase/migrations/005_cash_shift_and_capture.sql'),
  load('supabase/migrations/006_cash_shift_close.sql'),
  load('docs/architecture/LOCAL_FIRST_CASH_SHIFT_CLOSE_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('supabase/functions/hub-sync/index.ts'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, "type: 'shift.close'");
requireText(contract, 'pending order');
requireText(contract, 'cashVariance = countedCash - expectedCash');
requireText(contract, 'No staging, deployment, Supabase mutation');
requireText(router, '"shift.close" -> closeCashShift(command, context)');
requireText(router, 'private fun closeCashShift(');
requireText(router, 'hasPendingOrdersForCashShift');
requireText(router, '"SHIFT_CLOSED"');
requireText(router, '.put("cashVariance", variance)');
requireText(database, 'fun hasPendingOrdersForCashShift(');
requireText(database, 'if (value.optString("status", "").trim() == "CLOSED") return null');
requireText(database, '"shift.close"');
requireText(verifier, '"MANAGER" -> setOf(');
requireText(verifier, '"shift.close"');
requireText(runtime, '"shift.close"');
requireText(bridge, "| 'shift.close'");
requireText(managerUi, 'Close cash shift locally');
requireText(managerUi, 'Retry the same close request');
requireText(managerUi, 'Cash-up approval and bank deposit remain unavailable.');
requireText(managerUi, 'Abandon only if native confirms it never committed');
assert.ok(!managerUi.includes('Shift close and cashup are intentionally unavailable.'), 'The Manager station must not hide the implemented close command.');
assert.ok(!managerUi.includes('supabase'), 'The Manager close UI must not mutate Supabase directly.');
requireText(syncEndpoint, "'r006_ingest_hub_shift_close_events'");
requireText(syncEndpoint, "if (action === 'SHIFT_CLOSED') return 'r006_ingest_hub_shift_close_events';");
requireText(r006, 'R006_REQUIRES_ACCEPTED_R005');
requireText(r006, "'SHIFT_CLOSED'");
requireText(r006, 'cash_shift_id uuid');
requireText(r006, 'R006_SHIFT_CLOSE_ROLE_OR_SCOPE_FORBIDDEN');
requireText(r006, 'R006_SHIFT_PENDING_ORDERS');
requireText(r006, 'R006_SHIFT_CLOSE_VARIANCE_INVALID');
requireText(r006, 'CREATE OR REPLACE FUNCTION public.r006_ingest_hub_shift_close_events');
requireText(releaseStatus, 'cash-shift-close workflow');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000091',
  business: '10000000-0000-4000-8000-000000000091',
  branch: '11000000-0000-4000-8000-000000000091',
  device: '12000000-0000-4000-8000-000000000091',
  cashier: '20000000-0000-4000-8000-000000000091',
  manager: '20000000-0000-4000-8000-000000000092',
  cashierSession: '30000000-0000-4000-8000-000000000091',
  managerSession: '30000000-0000-4000-8000-000000000092',
  bundle: '31000000-0000-4000-8000-000000000091',
  shift: '41000000-0000-4000-8000-000000000091',
  nextShift: '41000000-0000-4000-8000-000000000092',
  order: '40000000-0000-4000-8000-000000000091',
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
      to_regprocedure('public.r006_ingest_hub_shift_close_events(text,uuid,jsonb)')::text AS ingest,
      (SELECT count(*)::integer FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cash_shifts' AND column_name IN ('closing_event_id', 'counted_cash', 'cash_variance', 'closed_at')) AS close_columns,
      (SELECT count(*)::integer FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cash_shift_id') AS order_shift_column;
  `);
  assert.deepEqual(schema.rows[0], {
    ingest: 'r006_ingest_hub_shift_close_events(text,uuid,jsonb)',
    close_columns: 4,
    order_shift_column: 1,
  });

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES (${quote(fixture.owner)}, 'close-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${quote(fixture.business)}, 'Close authority test', ${quote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, 'Close branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${quote(fixture.device)}, 'HUB-CLOSE-AUTHORITY', ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Close Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
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
  `);

  const cloudEvent = ({ eventId, commandId, aggregateId, action, staffId, sessionId, sequence, payload }) => ({
    eventId,
    commandId,
    entityId: aggregateId,
    entityType: 'shift',
    action,
    businessId: fixture.business,
    branchId: fixture.branch,
    deviceId: 'HUB-CLOSE-AUTHORITY',
    staffId,
    staffSessionId: sessionId,
    sequence,
    eventOrdinal: 0,
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    payload,
  });
  const ingest = async (functionName, event) => {
    const result = await db.query(
      `SELECT public.${functionName}($1::text, $2::uuid, $3::jsonb) AS receipt`,
      ['HUB-CLOSE-AUTHORITY', fixture.bundle, JSON.stringify([event])],
    );
    assert.deepEqual(result.rows[0].receipt, { acknowledgedEventIds: [event.eventId] });
  };
  const openingPayload = (shiftId, openingFloat) => ({
    id: shiftId,
    shiftId,
    status: 'OPEN',
    currency: 'ZAR',
    openingFloat,
    cashSalesTotal: 0,
    cashTenderedTotal: 0,
    cashChangeTotal: 0,
    expectedCash: openingFloat,
  });
  await ingest('r005_ingest_hub_financial_events', cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000091',
    commandId: '50000000-0000-4000-8000-000000000091',
    aggregateId: fixture.shift,
    action: 'SHIFT_OPENED',
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    payload: openingPayload(fixture.shift, 500),
  }));

  // R003 projects a Hub order only after its immutable placement event has
  // entered the ledger. Exercise the R006 projection trigger at that boundary
  // rather than supplying a drawer ID from the order row.
  await db.exec(`
    INSERT INTO public.hub_events (
      event_id, command_id, aggregate_id, aggregate_type, action,
      business_id, branch_id, hub_device_id, staff_id, staff_session_id,
      sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
    ) VALUES (
      '60000000-0000-4000-8000-000000000097', '50000000-0000-4000-8000-000000000097', ${quote(fixture.order)}, 'order', 'ORDER_PLACED',
      ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, ${quote(fixture.cashierSession)},
      1, 0, now(), 1, ${quote(JSON.stringify({ id: fixture.order, orderId: fixture.order, status: 'PLACED' }))}::jsonb, decode(repeat('00', 32), 'hex')
    );
    INSERT INTO public.orders (
      id, business_id, branch_id, device_id, cashier_id, cashier_name,
      subtotal, tax, total_amount, status, payment_method, payment_status
    ) VALUES (
      ${quote(fixture.order)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'HUB-CLOSE-AUTHORITY', ${quote(fixture.cashier)}, 'Cashier',
      10, 0, 10, 'PLACED', 'CASH', 'PENDING'
    );
  `);
  const orderShiftBinding = await db.query(`SELECT cash_shift_id::text AS cash_shift_id FROM public.orders WHERE id = ${quote(fixture.order)};`);
  assert.equal(orderShiftBinding.rows[0].cash_shift_id, fixture.shift, 'A Hub order is bound to the active shift by its placement event, not caller input.');

  const closePayload = (countedCash, cashVariance) => ({
    id: fixture.shift,
    shiftId: fixture.shift,
    status: 'CLOSED',
    currency: 'ZAR',
    expectedCash: 500,
    countedCash,
    cashVariance,
  });
  await assert.rejects(
    () => db.exec(`
      INSERT INTO public.hub_events (
        event_id, command_id, aggregate_id, aggregate_type, action,
        business_id, branch_id, hub_device_id, staff_id, staff_session_id,
        sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
      ) VALUES (
        '60000000-0000-4000-8000-000000000092', '50000000-0000-4000-8000-000000000092', ${quote(fixture.shift)}, 'shift', 'SHIFT_CLOSED',
        ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, ${quote(fixture.cashierSession)},
        1, 0, now(), 1, ${quote(JSON.stringify(closePayload(500, 0)))}::jsonb, decode(repeat('00', 32), 'hex')
      );
    `),
    (error) => error instanceof Error && error.message.includes('R006_SHIFT_CLOSE_ROLE_OR_SCOPE_FORBIDDEN'),
    'A Cashier cannot close a cash shift.',
  );

  const blockedClose = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000093',
    commandId: '50000000-0000-4000-8000-000000000093',
    aggregateId: fixture.shift,
    action: 'SHIFT_CLOSED',
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    payload: closePayload(500, 0),
  });
  await assert.rejects(
    () => ingest('r006_ingest_hub_shift_close_events', blockedClose),
    (error) => error instanceof Error && error.message.includes('R006_SHIFT_PENDING_ORDERS'),
    'A pending cash-shift order blocks close.',
  );

  await db.exec(`UPDATE public.orders SET status = 'CANCELLED' WHERE id = ${quote(fixture.order)};`);
  const invalidVariance = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000094',
    commandId: '50000000-0000-4000-8000-000000000094',
    aggregateId: fixture.shift,
    action: 'SHIFT_CLOSED',
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    payload: closePayload(475, 0),
  });
  await assert.rejects(
    () => ingest('r006_ingest_hub_shift_close_events', invalidVariance),
    (error) => error instanceof Error && error.message.includes('R006_SHIFT_CLOSE_VARIANCE_INVALID'),
    'The cloud receiver derives rather than trusts the close variance.',
  );

  const validClose = cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000095',
    commandId: '50000000-0000-4000-8000-000000000095',
    aggregateId: fixture.shift,
    action: 'SHIFT_CLOSED',
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    payload: closePayload(475, -25),
  });
  await ingest('r006_ingest_hub_shift_close_events', validClose);
  await ingest('r006_ingest_hub_shift_close_events', validClose);
  const closedFacts = await db.query(`
    SELECT status, expected_cash::text AS expected_cash, counted_cash::text AS counted_cash,
      cash_variance::text AS cash_variance,
      (closing_event_id = ${quote(validClose.eventId)}::uuid) AS has_close_event
    FROM public.cash_shifts WHERE shift_id = ${quote(fixture.shift)};
  `);
  assert.deepEqual(closedFacts.rows[0], {
    status: 'CLOSED',
    expected_cash: '500.00',
    counted_cash: '475.00',
    cash_variance: '-25.00',
    has_close_event: true,
  });
  const closeCount = await db.query(`SELECT count(*)::integer AS count FROM public.hub_events WHERE event_id = ${quote(validClose.eventId)};`);
  assert.equal(closeCount.rows[0].count, 1, 'An exact close retry must retain one event.');

  await ingest('r005_ingest_hub_financial_events', cloudEvent({
    eventId: '60000000-0000-4000-8000-000000000096',
    commandId: '50000000-0000-4000-8000-000000000096',
    aggregateId: fixture.nextShift,
    action: 'SHIFT_OPENED',
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 3,
    payload: openingPayload(fixture.nextShift, 0),
  }));
  const activeShift = await db.query(`SELECT shift_id::text AS shift_id, status FROM public.cash_shifts WHERE status = 'OPEN';`);
  assert.deepEqual(activeShift.rows, [{ shift_id: fixture.nextShift, status: 'OPEN' }]);
} finally {
  await db.close();
}

console.log('R009 cash shift close contract checks passed');
