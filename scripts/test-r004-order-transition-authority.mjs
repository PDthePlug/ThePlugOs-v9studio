import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [migration, router, verifier, contract, releaseStatus, r001, r002, r003] = await Promise.all([
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandRouter.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCommandVerifier.kt'),
  load('docs/architecture/LOCAL_FIRST_ORDER_TRANSITION_AUTHORITY_CONTRACT.md'),
  load('docs/operations/RELEASE_STATUS.md'),
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, 'Authority matrix');
requireText(contract, 'Safe-stop behavior around payment capture');
requireText(contract, 'Cashier cancellation is limited to an unprepared, pending order');
requireText(contract, 'Cashier or Manager');

requireText(router, '.put("paymentStatus", "PENDING")');
requireText(router, 'private fun enforceTransitionAuthority');
requireText(router, '"KITCHEN_STAFF" ->');
requireText(router, 'currentStatus == "PLACED" && nextStatus == "PREPARING"');
requireText(router, 'currentStatus == "PREPARING" && nextStatus == "READY"');
requireText(router, 'currentStatus == "PLACED" && nextStatus == "CANCELLED" && paymentStatus == "PENDING"');
requireText(router, 'currentStatus == "READY" && nextStatus == "COLLECTED" && paymentStatus == "CAPTURED"');
assert.ok(
  !router.includes('context.role == "KITCHEN_STAFF" && nextStatus !in setOf("PREPARING", "READY")'),
  'The broad kitchen-only post-check must be replaced by the explicit transition matrix.',
);

requireText(verifier, '"CASHIER" -> setOf("order.create", "order.status.transition", "payment.capture")');
requireText(verifier, '"MANAGER" -> setOf(');
requireText(verifier, '"order.status.transition"');
assert.ok(!verifier.includes('"payment.refund"'), 'Unimplemented payment refund must not appear in native command authority.');
assert.ok(!verifier.includes('"cashup.approve"'), 'Unimplemented cashup approval must not appear in native command authority.');

requireText(migration, 'CREATE OR REPLACE FUNCTION private.r004_validate_hub_event_order_authority()');
requireText(migration, 'BEFORE INSERT ON public.hub_events');
requireText(migration, 'R004_ORDER_CREATE_ROLE_FORBIDDEN');
requireText(migration, 'R004_ORDER_KITCHEN_TRANSITION_FORBIDDEN');
requireText(migration, 'R004_ORDER_CASHIER_TRANSITION_FORBIDDEN');
requireText(migration, 'R004_ORDER_MANAGER_TRANSITION_FORBIDDEN');
requireText(migration, "v_order.payment_status = 'PENDING'");
requireText(migration, "v_order.payment_status = 'CAPTURED'");
requireText(migration, 'session.role INTO v_role');
requireText(migration, 'session.hub_device_id = NEW.hub_device_id');

requireText(releaseStatus, 'completed order collection');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000001',
  business: '10000000-0000-4000-8000-000000000001',
  branch: '11000000-0000-4000-8000-000000000001',
  device: '12000000-0000-4000-8000-000000000001',
  cashier: '20000000-0000-4000-8000-000000000001',
  kitchen: '20000000-0000-4000-8000-000000000002',
  manager: '20000000-0000-4000-8000-000000000003',
  cashierSession: '30000000-0000-4000-8000-000000000001',
  kitchenSession: '30000000-0000-4000-8000-000000000002',
  managerSession: '30000000-0000-4000-8000-000000000003',
  order: '40000000-0000-4000-8000-000000000001',
});

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function expectTriggerReject(db, statement, code) {
  await assert.rejects(
    () => db.exec(statement),
    (error) => error instanceof Error && error.message.includes(code),
    `Expected ${code}`,
  );
}

function eventStatement({ eventId, sessionId, staffId, sequence, action, payload }) {
  return `
    INSERT INTO public.hub_events (
      event_id, command_id, aggregate_id, aggregate_type, action,
      business_id, branch_id, hub_device_id, staff_id, staff_session_id,
      sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
    ) VALUES (
      ${sqlQuote(eventId)}, '50000000-0000-4000-8000-000000000001', ${sqlQuote(fixture.order)}, 'order', ${sqlQuote(action)},
      ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.device)}, ${sqlQuote(staffId)}, ${sqlQuote(sessionId)},
      ${sequence}, 0, now(), 1, ${sqlQuote(JSON.stringify(payload))}::jsonb, decode(repeat('00', 32), 'hex')
    );
  `;
}

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
  await db.exec(migration);
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES (${sqlQuote(fixture.owner)}, 'owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${sqlQuote(fixture.business)}, 'Order authority test', ${sqlQuote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.business)}, 'Main');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${sqlQuote(fixture.device)}, 'HUB-ORDER-AUTHORITY', ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
    INSERT INTO public.staff_members (id, business_id, branch_id, name, role, status)
    VALUES
      (${sqlQuote(fixture.cashier)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'Cashier', 'CASHIER', 'ACTIVE'),
      (${sqlQuote(fixture.kitchen)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'Kitchen', 'KITCHEN_STAFF', 'ACTIVE'),
      (${sqlQuote(fixture.manager)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'Manager', 'MANAGER', 'ACTIVE');
    INSERT INTO public.hub_staff_sessions (
      session_id, business_id, branch_id, hub_device_id, staff_id, role, revocation_version, status, expires_at, activated_at
    ) VALUES
      (${sqlQuote(fixture.cashierSession)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.device)}, ${sqlQuote(fixture.cashier)}, 'CASHIER', 0, 'ACTIVE', now() + interval '1 hour', now()),
      (${sqlQuote(fixture.kitchenSession)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.device)}, ${sqlQuote(fixture.kitchen)}, 'KITCHEN_STAFF', 0, 'ACTIVE', now() + interval '1 hour', now()),
      (${sqlQuote(fixture.managerSession)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, ${sqlQuote(fixture.device)}, ${sqlQuote(fixture.manager)}, 'MANAGER', 0, 'ACTIVE', now() + interval '1 hour', now());
    INSERT INTO public.orders (
      id, business_id, branch_id, device_id, cashier_id, cashier_name,
      subtotal, tax, total_amount, status, payment_method, payment_status
    ) VALUES (
      ${sqlQuote(fixture.order)}, ${sqlQuote(fixture.business)}, ${sqlQuote(fixture.branch)}, 'HUB-ORDER-AUTHORITY', ${sqlQuote(fixture.cashier)}, 'Cashier',
      10, 0, 10, 'PLACED', 'CASH', 'PENDING'
    );
  `);

  await expectTriggerReject(
    db,
    eventStatement({
      eventId: '60000000-0000-4000-8000-000000000001',
      sessionId: fixture.managerSession,
      staffId: fixture.manager,
      sequence: 1,
      action: 'ORDER_PLACED',
      payload: { id: fixture.order, orderId: fixture.order, status: 'PLACED' },
    }),
    'R004_ORDER_CREATE_ROLE_FORBIDDEN',
  );
  await expectTriggerReject(
    db,
    eventStatement({
      eventId: '60000000-0000-4000-8000-000000000002',
      sessionId: fixture.cashierSession,
      staffId: fixture.cashier,
      sequence: 1,
      action: 'ORDER_STATUS_CHANGED',
      payload: { id: fixture.order, orderId: fixture.order, previousStatus: 'PLACED', status: 'PREPARING' },
    }),
    'R004_ORDER_CASHIER_TRANSITION_FORBIDDEN',
  );
  await db.exec(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000003',
    sessionId: fixture.kitchenSession,
    staffId: fixture.kitchen,
    sequence: 1,
    action: 'ORDER_STATUS_CHANGED',
    payload: { id: fixture.order, orderId: fixture.order, previousStatus: 'PLACED', status: 'PREPARING' },
  }));
  await expectTriggerReject(
    db,
    eventStatement({
      eventId: '60000000-0000-4000-8000-000000000004',
      sessionId: fixture.cashierSession,
      staffId: fixture.cashier,
      sequence: 2,
      action: 'ORDER_STATUS_CHANGED',
      payload: { id: fixture.order, orderId: fixture.order, previousStatus: 'READY', status: 'COLLECTED' },
    }),
    'R004_ORDER_PREVIOUS_STATUS_INVALID',
  );
  await db.exec(`UPDATE public.orders SET status = 'READY', payment_status = 'PENDING' WHERE id = ${sqlQuote(fixture.order)};`);
  await expectTriggerReject(
    db,
    eventStatement({
      eventId: '60000000-0000-4000-8000-000000000005',
      sessionId: fixture.cashierSession,
      staffId: fixture.cashier,
      sequence: 3,
      action: 'ORDER_STATUS_CHANGED',
      payload: { id: fixture.order, orderId: fixture.order, previousStatus: 'READY', status: 'COLLECTED' },
    }),
    'R004_ORDER_CASHIER_TRANSITION_FORBIDDEN',
  );
  await db.exec(`UPDATE public.orders SET payment_status = 'CAPTURED' WHERE id = ${sqlQuote(fixture.order)};`);
  await db.exec(eventStatement({
    eventId: '60000000-0000-4000-8000-000000000006',
    sessionId: fixture.cashierSession,
    staffId: fixture.cashier,
    sequence: 4,
    action: 'ORDER_STATUS_CHANGED',
    payload: { id: fixture.order, orderId: fixture.order, previousStatus: 'READY', status: 'COLLECTED' },
  }));
} finally {
  await db.close();
}

console.log('R004 order transition authority contract checks passed');
