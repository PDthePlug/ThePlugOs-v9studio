import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, contract, models, database, router, plugin, bridge, cashierUi, managerUi, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('docs/architecture/LOCAL_FIRST_PENDING_ORDER_CANCELLATION_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubModels.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/ThePlugOSLocalHubPlugin.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/workspaces/NativeCashierStation.tsx'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, 'Cashier');
requireText(contract, 'Manager');
requireText(contract, "status: 'CANCELLED'");
requireText(contract, 'No staging, deployment, Supabase mutation');
requireText(models, 'val cancellableOrders: List<NativeCancellableOrder>');
requireText(models, 'data class NativeCancellableOrder(');
requireText(database, 'private fun readCancellableOrdersForBranch(');
requireText(database, 'CANCELLABLE_MANAGER_ORDER_STATUSES = setOf("PLACED", "PREPARING")');
requireText(database, 'MAX_NATIVE_CANCELLABLE_ORDERS');
requireText(router, 'private fun restoreStockForCancelledOrder(');
requireText(router, 'currentStatus == "PLACED" && nextStatus == "CANCELLED" && paymentStatus == "PENDING"');
requireText(router, 'currentStatus in setOf("PLACED", "PREPARING")');
requireText(plugin, 'put("cancellableOrders", JSArray().apply');
requireText(bridge, 'export interface NativeHubCancellableOrder');
requireText(bridge, 'cancellableOrders: NativeHubCancellableOrder[];');
requireText(cashierUi, "payload: { orderId: order.id, status: 'CANCELLED' }");
requireText(cashierUi, 'Cancel unprepared order locally');
requireText(cashierUi, 'Retry the same cancellation request');
requireText(managerUi, 'Cancellation authority before close');
requireText(managerUi, 'Cancel order locally');
requireText(managerUi, 'Retry the same cancellation request');
requireText(managerUi, 'native cancellation request is unresolved');
requireText(releaseStatus, 'pending-order-cancellation workflow');
assert.ok(!cashierUi.includes('supabase'), 'Cashier cancellation must not mutate Supabase directly.');
assert.ok(!managerUi.includes('supabase'), 'Manager cancellation must not mutate Supabase directly.');
assert.ok(!managerUi.includes('totalAmount'), 'Manager cancellation tasks must not expose financial amounts.');
assert.ok(!managerUi.includes('paymentMethod'), 'Manager cancellation tasks must not expose tender details.');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000101',
  business: '10000000-0000-4000-8000-000000000101',
  branch: '11000000-0000-4000-8000-000000000101',
  device: '12000000-0000-4000-8000-000000000101',
  cashier: '20000000-0000-4000-8000-000000000101',
  manager: '20000000-0000-4000-8000-000000000102',
  kitchen: '20000000-0000-4000-8000-000000000103',
  cashierSession: '30000000-0000-4000-8000-000000000101',
  managerSession: '30000000-0000-4000-8000-000000000102',
  kitchenSession: '30000000-0000-4000-8000-000000000103',
  cashierOrder: '40000000-0000-4000-8000-000000000101',
  managerOrder: '40000000-0000-4000-8000-000000000102',
  capturedOrder: '40000000-0000-4000-8000-000000000103',
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
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES (${quote(fixture.owner)}, 'cancel-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${quote(fixture.business)}, 'Cancellation authority test', ${quote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, 'Cancellation branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${quote(fixture.device)}, 'HUB-CANCELLATION-AUTHORITY', ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Cancellation Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
    INSERT INTO public.staff_members (id, business_id, branch_id, name, role, status)
    VALUES
      (${quote(fixture.cashier)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Cashier', 'CASHIER', 'ACTIVE'),
      (${quote(fixture.manager)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Manager', 'MANAGER', 'ACTIVE'),
      (${quote(fixture.kitchen)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Kitchen', 'KITCHEN_STAFF', 'ACTIVE');
    INSERT INTO public.hub_staff_sessions (
      session_id, business_id, branch_id, hub_device_id, staff_id, role, revocation_version, status, expires_at, activated_at
    ) VALUES
      (${quote(fixture.cashierSession)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, 'CASHIER', 0, 'ACTIVE', now() + interval '1 hour', now()),
      (${quote(fixture.managerSession)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.manager)}, 'MANAGER', 0, 'ACTIVE', now() + interval '1 hour', now()),
      (${quote(fixture.kitchenSession)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.kitchen)}, 'KITCHEN_STAFF', 0, 'ACTIVE', now() + interval '1 hour', now());
    INSERT INTO public.orders (
      id, business_id, branch_id, device_id, cashier_id, cashier_name,
      subtotal, tax, total_amount, status, payment_method, payment_status
    ) VALUES
      (${quote(fixture.cashierOrder)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'HUB-CANCELLATION-AUTHORITY', ${quote(fixture.cashier)}, 'Cashier', 10, 0, 10, 'PLACED', 'CASH', 'PENDING'),
      (${quote(fixture.managerOrder)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'HUB-CANCELLATION-AUTHORITY', ${quote(fixture.cashier)}, 'Cashier', 10, 0, 10, 'PREPARING', 'CASH', 'PENDING'),
      (${quote(fixture.capturedOrder)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'HUB-CANCELLATION-AUTHORITY', ${quote(fixture.cashier)}, 'Cashier', 10, 0, 10, 'PLACED', 'CASH', 'CAPTURED');
  `);

  const eventStatement = ({ eventId, commandId, orderId, staffId, sessionId, sequence, previousStatus }) => `
    INSERT INTO public.hub_events (
      event_id, command_id, aggregate_id, aggregate_type, action,
      business_id, branch_id, hub_device_id, staff_id, staff_session_id,
      sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
    ) VALUES (
      ${quote(eventId)}, ${quote(commandId)}, ${quote(orderId)}, 'order', 'ORDER_STATUS_CHANGED',
      ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(staffId)}, ${quote(sessionId)},
      ${sequence}, 0, now(), 1,
      ${quote(JSON.stringify({ id: orderId, orderId, previousStatus, status: 'CANCELLED' }))}::jsonb,
      decode(repeat('00', 32), 'hex')
    );
  `;
  const reject = async (statement, code) => assert.rejects(
    () => db.exec(statement),
    (error) => error instanceof Error && error.message.includes(code),
    `Expected ${code}`,
  );

  await db.exec(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000101',
    commandId: '50000000-0000-4000-8000-000000000101',
    orderId: fixture.cashierOrder,
    staffId: fixture.cashier,
    sessionId: fixture.cashierSession,
    sequence: 1,
    previousStatus: 'PLACED',
  }));
  await reject(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000102',
    commandId: '50000000-0000-4000-8000-000000000102',
    orderId: fixture.managerOrder,
    staffId: fixture.cashier,
    sessionId: fixture.cashierSession,
    sequence: 2,
    previousStatus: 'PREPARING',
  }), 'R004_ORDER_CASHIER_TRANSITION_FORBIDDEN');
  await db.exec(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000103',
    commandId: '50000000-0000-4000-8000-000000000103',
    orderId: fixture.managerOrder,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 1,
    previousStatus: 'PREPARING',
  }));
  await reject(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000104',
    commandId: '50000000-0000-4000-8000-000000000104',
    orderId: fixture.capturedOrder,
    staffId: fixture.manager,
    sessionId: fixture.managerSession,
    sequence: 2,
    previousStatus: 'PLACED',
  }), 'R004_ORDER_MANAGER_TRANSITION_FORBIDDEN');
  await reject(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000105',
    commandId: '50000000-0000-4000-8000-000000000105',
    orderId: fixture.cashierOrder,
    staffId: fixture.kitchen,
    sessionId: fixture.kitchenSession,
    sequence: 1,
    previousStatus: 'PLACED',
  }), 'R004_ORDER_KITCHEN_TRANSITION_FORBIDDEN');
  const accepted = await db.query(`SELECT count(*)::integer AS count FROM public.hub_events WHERE action = 'ORDER_STATUS_CHANGED';`);
  assert.equal(accepted.rows[0].count, 2, 'Only the explicitly authorized pending cancellation events may enter the ledger.');
} finally {
  await db.close();
}

console.log('R010 pending-order cancellation contract checks passed');
