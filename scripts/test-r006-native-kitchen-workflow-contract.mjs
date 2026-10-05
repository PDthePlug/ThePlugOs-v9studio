import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, contract, models, database, router, plugin, bridge, kitchenUi, app, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('docs/architecture/LOCAL_FIRST_NATIVE_KITCHEN_WORKFLOW_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubModels.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/ThePlugOSLocalHubPlugin.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/workspaces/NativeKitchenStation.tsx'),
  load('src/App.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, 'Scope and projection boundary');
requireText(contract, 'Retry, interruption, and safe abandonment');
requireText(contract, 'No printer, KDS-device, SMS, WhatsApp, or push-notification delivery claim.');
requireText(contract, 'No staging, deployment, production database mutation');

requireText(models, 'val pendingKitchenOrders: List<NativeKitchenOrder>');
requireText(models, 'data class NativeKitchenOrder(');
requireText(models, 'data class NativeKitchenOrderLine(');
requireText(database, 'private fun readPendingKitchenOrdersForBranch(');
requireText(database, 'AND e.action = \'ORDER_PLACED\'');
requireText(database, 'MAX_NATIVE_PENDING_KITCHEN_ORDERS');
requireText(database, 'PENDING_KITCHEN_ORDER_STATUSES = setOf("PLACED", "PREPARING")');
requireText(database, 'fun orderBelongsToScope(orderId: String, businessId: String, branchId: String): Boolean');
requireText(database, "AND intent.command_type IN (");
requireText(database, "'payment.capture'");
requireText(router, '.put("businessId", context.businessId)');
requireText(router, '.put("branchId", context.branchId)');
requireText(router, 'private fun requireOrderScope');
requireText(router, 'database.orderBelongsToScope(orderId, context.businessId, context.branchId)');
requireText(plugin, 'put("pendingKitchenOrders", JSArray().apply');
requireText(bridge, 'export interface NativeHubKitchenOrderLine');
requireText(bridge, 'pendingKitchenOrders: NativeHubKitchenOrder[];');
requireText(kitchenUi, "context.role !== 'KITCHEN_STAFF'");
requireText(kitchenUi, "type: 'order.status.transition'");
requireText(kitchenUi, "payload: { orderId: order.id, status: requestedStatus }");
requireText(kitchenUi, 'Retry exact native request');
requireText(kitchenUi, 'Abandon only if native confirms it never committed');
requireText(app, "nativeStationRole === 'KITCHEN_STAFF'");
requireText(releaseStatus, 'native Kitchen workflow');
assert.ok(!kitchenUi.includes('supabase'), 'Kitchen UI must not mutate Supabase directly.');
assert.ok(!kitchenUi.includes('paymentMethod'), 'Kitchen UI must not expose tender state as Kitchen authority.');
assert.ok(!kitchenUi.includes('totalAmount'), 'Kitchen UI must not expose financial amounts.');
assert.ok(!kitchenUi.includes("status: 'CANCELLED'"), 'Kitchen UI must not offer cancellation.');
assert.ok(!kitchenUi.includes("status: 'COLLECTED'"), 'Kitchen UI must not offer collection.');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000061',
  business: '10000000-0000-4000-8000-000000000061',
  branch: '11000000-0000-4000-8000-000000000061',
  device: '12000000-0000-4000-8000-000000000061',
  cashier: '20000000-0000-4000-8000-000000000061',
  kitchen: '20000000-0000-4000-8000-000000000062',
  cashierSession: '30000000-0000-4000-8000-000000000061',
  kitchenSession: '30000000-0000-4000-8000-000000000062',
  order: '40000000-0000-4000-8000-000000000061',
  startEvent: '60000000-0000-4000-8000-000000000061',
  readyEvent: '60000000-0000-4000-8000-000000000062',
});

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const eventStatement = ({ eventId, commandId, staffId, sessionId, sequence, payload }) => `
  INSERT INTO public.hub_events (
    event_id, command_id, aggregate_id, aggregate_type, action,
    business_id, branch_id, hub_device_id, staff_id, staff_session_id,
    sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
  ) VALUES (
    ${sqlQuote(eventId)}, ${sqlQuote(commandId)}, ${sqlQuote(fixture.order)}, 'order', 'ORDER_STATUS_CHANGED',
    ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.device)}, ${sqlQuote(staffId)}, ${sqlQuote(sessionId)},
    ${sequence}, 0, now(), 1, ${sqlQuote(JSON.stringify(payload))}::jsonb, decode(repeat('00', 32), 'hex')
  );
`;

const projectTransition = async (db, { eventId, commandId, staffId, sessionId, payload }) => {
  await db.exec(`
    SELECT private.r003_project_hub_order_event(
      ${sqlQuote(eventId)}::uuid,
      ${sqlQuote(commandId)}::uuid,
      ${sqlQuote(fixture.business)}::uuid,
      ${sqlQuote(fixture.branch)}::uuid,
      'HUB-KITCHEN-WORKFLOW',
      ${sqlQuote(staffId)}::uuid,
      ${sqlQuote(sessionId)}::uuid,
      ${sqlQuote(fixture.order)},
      'ORDER_STATUS_CHANGED',
      ${sqlQuote(JSON.stringify(payload))}::jsonb
    );
  `);
};

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
    INSERT INTO auth.users (id, email) VALUES (${sqlQuote(fixture.owner)}, 'kitchen-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${sqlQuote(fixture.business)}, 'Kitchen workflow test', ${sqlQuote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.business)}, 'Kitchen branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${sqlQuote(fixture.device)}, 'HUB-KITCHEN-WORKFLOW', ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'Kitchen Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
    INSERT INTO public.staff_members (id, business_id, branch_id, name, role, status)
    VALUES
      (${sqlQuote(fixture.cashier)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'Cashier', 'CASHIER', 'ACTIVE'),
      (${sqlQuote(fixture.kitchen)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'Kitchen', 'KITCHEN_STAFF', 'ACTIVE');
    INSERT INTO public.hub_staff_sessions (
      session_id, business_id, branch_id, hub_device_id, staff_id, role, revocation_version, status, expires_at, activated_at
    ) VALUES
      (${sqlQuote(fixture.cashierSession)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.device)}, ${sqlQuote(fixture.cashier)}, 'CASHIER', 0, 'ACTIVE', now() + interval '1 hour', now()),
      (${sqlQuote(fixture.kitchenSession)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.device)}, ${sqlQuote(fixture.kitchen)}, 'KITCHEN_STAFF', 0, 'ACTIVE', now() + interval '1 hour', now());
    INSERT INTO public.orders (
      id, business_id, branch_id, device_id, cashier_id, cashier_name,
      subtotal, tax, total_amount, status, payment_method, payment_status
    ) VALUES (
      ${sqlQuote(fixture.order)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'HUB-KITCHEN-WORKFLOW', ${sqlQuote(fixture.cashier)}, 'Cashier',
      40, 0, 40, 'PLACED', 'CASH', 'PENDING'
    );
  `);

  await assert.rejects(
    () => db.exec(eventStatement({
      eventId: '60000000-0000-4000-8000-000000000063',
      commandId: '50000000-0000-4000-8000-000000000061',
      staffId: fixture.cashier,
      sessionId: fixture.cashierSession,
      sequence: 1,
      payload: { id: fixture.order, orderId: fixture.order, previousStatus: 'PLACED', status: 'PREPARING' },
    })),
    (error) => error instanceof Error && error.message.includes('R004_ORDER_CASHIER_TRANSITION_FORBIDDEN'),
    'Cashier cannot start Kitchen preparation through the receiver.',
  );

  const startPayload = { id: fixture.order, orderId: fixture.order, previousStatus: 'PLACED', status: 'PREPARING' };
  await db.exec(eventStatement({
    eventId: fixture.startEvent,
    commandId: '50000000-0000-4000-8000-000000000062',
    staffId: fixture.kitchen,
    sessionId: fixture.kitchenSession,
    sequence: 1,
    payload: startPayload,
  }));
  await projectTransition(db, {
    eventId: fixture.startEvent,
    commandId: '50000000-0000-4000-8000-000000000062',
    staffId: fixture.kitchen,
    sessionId: fixture.kitchenSession,
    payload: startPayload,
  });
  assert.equal((await db.query(`SELECT status FROM public.orders WHERE id = ${sqlQuote(fixture.order)}`)).rows[0].status, 'PREPARING');

  const readyPayload = { id: fixture.order, orderId: fixture.order, previousStatus: 'PREPARING', status: 'READY' };
  await db.exec(eventStatement({
    eventId: fixture.readyEvent,
    commandId: '50000000-0000-4000-8000-000000000063',
    staffId: fixture.kitchen,
    sessionId: fixture.kitchenSession,
    sequence: 2,
    payload: readyPayload,
  }));
  await projectTransition(db, {
    eventId: fixture.readyEvent,
    commandId: '50000000-0000-4000-8000-000000000063',
    staffId: fixture.kitchen,
    sessionId: fixture.kitchenSession,
    payload: readyPayload,
  });
  assert.equal((await db.query(`SELECT status FROM public.orders WHERE id = ${sqlQuote(fixture.order)}`)).rows[0].status, 'READY');
} finally {
  await db.close();
}

console.log('R006 native Kitchen workflow contract checks passed');
