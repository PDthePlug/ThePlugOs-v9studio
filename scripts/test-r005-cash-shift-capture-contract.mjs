import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, r005, contract, router, verifier, runtime, database, bridge, syncEndpoint, cashierUi, managerUi, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('supabase/migrations/005_cash_shift_and_capture.sql'),
  load('docs/architecture/LOCAL_FIRST_CASH_SHIFT_AND_CAPTURE_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/CashierHubRuntime.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('supabase/functions/hub-sync/index.ts'),
  load('src/workspaces/NativeCashierStation.tsx'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, 'A signed Manager session opens it');
requireText(contract, 'financialPostings');
requireText(contract, '`CARD` and `SPAZAPAY_QR` remain valid **order tender intents** only');
requireText(contract, 'shift.close');

requireText(router, '"shift.open" -> openCashShift(command, context)');
requireText(router, '"payment.capture" -> captureCashPayment(command, context)');
requireText(router, 'A Manager must open the branch cash shift before a Cashier can create an order.');
requireText(router, 'Only cash capture is available on this Hub release.');
requireText(router, '"CASH_DRAWER"');
requireText(router, '"ORDER_SETTLEMENT_CLEARING"');
requireText(router, '.put("paymentStatus", "CAPTURED")');
requireText(router, 'val CAPTURABLE_ORDER_STATUSES = setOf("PLACED", "PREPARING", "READY")');
requireText(database, 'ORDER BY o.rowid ASC');
requireText(database, 'fun discardUncommittedNativeCommandIntent');
requireText(database, 'if (readReceipt(db, commandId) != null)');
requireText(runtime, 'internal fun discardNativeCommandRequest(commandId: String): Boolean');
requireText(verifier, '"CASHIER" -> setOf("order.create", "order.status.transition", "payment.capture")');
requireText(verifier, '"MANAGER" -> setOf(');
requireText(verifier, '"shift.open"');
requireText(verifier, '"shift.close"');
requireText(runtime, '"shift.open"');
requireText(runtime, '"payment.capture"');
requireText(bridge, "type: 'shift.open'");
requireText(bridge, "| 'shift.close'");
requireText(bridge, "| 'payment.capture'");
requireText(bridge, 'activeCashShift: NativeHubCashShift | null;');
requireText(bridge, 'pendingCashOrders: NativeHubPendingCashOrder[];');
requireText(bridge, 'recoverableNativeCommands: NativeHubRecoverableCommand[];');
requireText(bridge, 'discardNativeCommandRequest(commandId: string): Promise<boolean>;');
requireText(cashierUi, 'Capture-enabled tender');
requireText(cashierUi, 'Cash only.');
requireText(cashierUi, 'Capture cash locally');
requireText(cashierUi, 'Abandon only if native confirms it never committed');
requireText(managerUi, 'Open cash shift locally');
requireText(managerUi, 'Cash-up approval and bank deposit remain unavailable.');
requireText(managerUi, 'Abandon only if native confirms it never committed');
requireText(syncEndpoint, 'r005_ingest_hub_financial_events');
requireText(syncEndpoint, 'Preserve durable event order');

requireText(r005, 'CREATE TABLE public.cash_shifts');
requireText(r005, 'CREATE TABLE public.hub_payments');
requireText(r005, 'CREATE TABLE public.financial_postings');
requireText(r005, 'CASH_DRAWER');
requireText(r005, 'ORDER_SETTLEMENT_CLEARING');
requireText(r005, 'R005_ORDER_ACTIVE_SHIFT_REQUIRED');
requireText(r005, 'CREATE OR REPLACE FUNCTION public.r005_ingest_hub_financial_events');
requireText(r005, 'r005_hub_events_cash_authority');
requireText(r005, "CHECK (change_due = cash_tendered - amount)");
requireText(r005, "CHECK (expected_cash = opening_float + cash_sales_total)");
requireText(r004, 'IF NEW.aggregate_type <> \'order\' THEN\n        RETURN NEW;');
requireText(releaseStatus, 'cash-shift/cash-capture path');

// This is a source-only database compatibility check. It does not touch
// staging or production, but catches migration syntax/order regressions before
// the future evidence gate is available.
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
  // PGlite's regexp engine cannot evaluate the deliberately large upper bound
  // on R003 bundle payloads. Remove only those fixture constraints after the
  // migration itself has applied so this source-only harness can exercise the
  // R005 authenticated receiver path.
  await db.exec(`
    ALTER TABLE public.hub_authorization_bundles
      DROP CONSTRAINT IF EXISTS hub_authorization_bundles_issuer_key_id_check;
    ALTER TABLE public.hub_authorization_bundles
      DROP CONSTRAINT IF EXISTS hub_authorization_bundles_payload_base64_check;
    ALTER TABLE public.hub_authorization_bundles
      DROP CONSTRAINT IF EXISTS hub_authorization_bundles_signature_base64_check;
  `);
  const result = await db.query(`
    SELECT
      to_regclass('public.cash_shifts')::text AS cash_shifts,
      to_regclass('public.hub_payments')::text AS payments,
      to_regclass('public.financial_postings')::text AS postings,
      to_regprocedure('public.r005_ingest_hub_financial_events(text,uuid,jsonb)')::text AS ingest;
  `);
  assert.deepEqual(result.rows[0], {
    cash_shifts: 'cash_shifts',
    payments: 'hub_payments',
    postings: 'financial_postings',
    ingest: 'r005_ingest_hub_financial_events(text,uuid,jsonb)',
  });

  const fixture = Object.freeze({
    owner: '00000000-0000-4000-8000-000000000051',
    business: '10000000-0000-4000-8000-000000000051',
    branch: '11000000-0000-4000-8000-000000000051',
    device: '12000000-0000-4000-8000-000000000051',
    cashier: '20000000-0000-4000-8000-000000000051',
    manager: '20000000-0000-4000-8000-000000000052',
    cashierSession: '30000000-0000-4000-8000-000000000051',
    managerSession: '30000000-0000-4000-8000-000000000052',
    bundle: '31000000-0000-4000-8000-000000000051',
    order: '40000000-0000-4000-8000-000000000051',
    shift: '41000000-0000-4000-8000-000000000051',
    duplicateShift: '41000000-0000-4000-8000-000000000052',
    payment: '42000000-0000-4000-8000-000000000051',
  });
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const eventStatement = ({ eventId, commandId, aggregateId, aggregateType, action, staffId, sessionId, sequence, payload }) => `
    INSERT INTO public.hub_events (
      event_id, command_id, aggregate_id, aggregate_type, action,
      business_id, branch_id, hub_device_id, staff_id, staff_session_id,
      sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
    ) VALUES (
      ${quote(eventId)}, ${quote(commandId)}, ${quote(aggregateId)}, ${quote(aggregateType)}, ${quote(action)},
      ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(staffId)}, ${quote(sessionId)},
      ${sequence}, 0, now(), 1, ${quote(JSON.stringify(payload))}::jsonb, decode(repeat('00', 32), 'hex')
    );
  `;
  const reject = async (statement, code) => assert.rejects(
    () => db.exec(statement),
    (error) => error instanceof Error && error.message.includes(code),
    `Expected ${code}`,
  );
  const cloudEvent = ({ eventId, commandId, aggregateId, aggregateType, action, staffId, sessionId, sequence, payload }) => ({
    eventId,
    commandId,
    entityId: aggregateId,
    entityType: aggregateType,
    action,
    businessId: fixture.business,
    branchId: fixture.branch,
    deviceId: 'HUB-CASH-AUTHORITY',
    staffId,
    staffSessionId: sessionId,
    sequence,
    eventOrdinal: 0,
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    payload,
  });
  const ingestR005 = async (event) => {
    const result = await db.query(
      'SELECT public.r005_ingest_hub_financial_events($1::text, $2::uuid, $3::jsonb) AS receipt',
      ['HUB-CASH-AUTHORITY', fixture.bundle, JSON.stringify([event])],
    );
    assert.deepEqual(result.rows[0].receipt, { acknowledgedEventIds: [event.eventId] });
  };
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES (${quote(fixture.owner)}, 'cash-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${quote(fixture.business)}, 'Cash authority test', ${quote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, 'Cash branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${quote(fixture.device)}, 'HUB-CASH-AUTHORITY', ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Cash Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
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
    INSERT INTO public.orders (
      id, business_id, branch_id, device_id, cashier_id, cashier_name,
      subtotal, tax, total_amount, status, payment_method, payment_status
    ) VALUES (
      ${quote(fixture.order)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'HUB-CASH-AUTHORITY', ${quote(fixture.cashier)}, 'Cashier',
      75, 0, 75, 'PLACED', 'CASH', 'PENDING'
    );
  `);

  await reject(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000051',
    commandId: '50000000-0000-4000-8000-000000000051',
    aggregateId: fixture.order,
    aggregateType: 'order',
    action: 'ORDER_PLACED',
    staffId: fixture.cashier,
    sessionId: fixture.cashierSession,
    sequence: 1,
    payload: { id: fixture.order, orderId: fixture.order, status: 'PLACED' },
  }), 'R005_ORDER_ACTIVE_SHIFT_REQUIRED');

  const openingPayload = {
    id: fixture.shift,
    shiftId: fixture.shift,
    status: 'OPEN',
    currency: 'ZAR',
    openingFloat: 500,
    cashSalesTotal: 0,
    cashTenderedTotal: 0,
    cashChangeTotal: 0,
    expectedCash: 500,
  };
  const openingEvent = '60000000-0000-4000-8000-000000000052';
  await ingestR005(cloudEvent({
    eventId: openingEvent,
    commandId: '50000000-0000-4000-8000-000000000052',
    aggregateId: fixture.shift,
    aggregateType: 'shift',
    action: 'SHIFT_OPENED',
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    payload: openingPayload,
  }));

  await assert.rejects(
    () => ingestR005(cloudEvent({
      eventId: '60000000-0000-4000-8000-000000000054',
      commandId: '50000000-0000-4000-8000-000000000054',
      aggregateId: fixture.duplicateShift,
      aggregateType: 'shift',
      action: 'SHIFT_OPENED',
      staffId: fixture.manager,
      sessionId: fixture.managerSession,
      sequence: 2,
      payload: { ...openingPayload, id: fixture.duplicateShift, shiftId: fixture.duplicateShift },
    })),
    (error) => error instanceof Error && error.message.includes('R005_SHIFT_ALREADY_OPEN'),
    'Expected the receiver to reject a second active branch shift.',
  );

  const paymentPayload = {
    id: fixture.payment,
    paymentId: fixture.payment,
    orderId: fixture.order,
    shiftId: fixture.shift,
    tender: 'CASH',
    status: 'CAPTURED',
    currency: 'ZAR',
    amount: 75,
    cashTendered: 100,
    changeDue: 25,
    financialPostings: [
      { account: 'CASH_DRAWER', debit: 75, credit: 0 },
      { account: 'ORDER_SETTLEMENT_CLEARING', debit: 0, credit: 75 },
    ],
  };
  const paymentEvent = '60000000-0000-4000-8000-000000000053';
  const paymentCloudEvent = cloudEvent({
    eventId: paymentEvent,
    commandId: '50000000-0000-4000-8000-000000000053',
    aggregateId: fixture.payment,
    aggregateType: 'payment',
    action: 'PAYMENT_CAPTURED',
    staffId: fixture.cashier,
    sessionId: fixture.cashierSession,
    sequence: 2,
    payload: paymentPayload,
  });
  await ingestR005(paymentCloudEvent);
  await ingestR005(paymentCloudEvent);
  const financialFacts = await db.query(`
    SELECT
      (SELECT payment_status FROM public.orders WHERE id = ${quote(fixture.order)}) AS order_payment_status,
      (SELECT cash_tendered::text FROM public.orders WHERE id = ${quote(fixture.order)}) AS cash_tendered,
      (SELECT change_due::text FROM public.orders WHERE id = ${quote(fixture.order)}) AS change_due,
      (SELECT expected_cash::text FROM public.cash_shifts WHERE shift_id = ${quote(fixture.shift)}) AS expected_cash,
      (SELECT count(*)::integer FROM public.hub_payments WHERE payment_id = ${quote(fixture.payment)}) AS payment_count,
      (SELECT count(*)::integer FROM public.financial_postings WHERE payment_id = ${quote(fixture.payment)}) AS posting_count,
      (SELECT coalesce(sum(debit), 0)::text FROM public.financial_postings WHERE payment_id = ${quote(fixture.payment)}) AS debit_total,
      (SELECT coalesce(sum(credit), 0)::text FROM public.financial_postings WHERE payment_id = ${quote(fixture.payment)}) AS credit_total;
  `);
  assert.deepEqual(financialFacts.rows[0], {
    order_payment_status: 'CAPTURED',
    cash_tendered: '100.00',
    change_due: '25.00',
    expected_cash: '575.00',
    payment_count: 1,
    posting_count: 2,
    debit_total: '75.00',
    credit_total: '75.00',
  });
} finally {
  await db.close();
}

console.log('R005 cash shift and cash capture contract checks passed');
