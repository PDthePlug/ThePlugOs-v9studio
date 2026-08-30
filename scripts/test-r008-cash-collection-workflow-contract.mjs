import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const [r001, r002, r003, r004, contract, models, database, plugin, bridge, cashierUi, releaseStatus] = await Promise.all([
  load('supabase/migrations/001_mvp_core.sql'),
  load('supabase/migrations/002_secure_identity_devices.sql'),
  load('supabase/migrations/003_local_hub_authority.sql'),
  load('supabase/migrations/004_order_transition_authority.sql'),
  load('docs/architecture/LOCAL_FIRST_CASH_COLLECTION_WORKFLOW_CONTRACT.md'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubModels.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/ThePlugOSLocalHubPlugin.kt'),
  load('packages/core/src/runtime/native-hub-bridge.ts'),
  load('src/workspaces/NativeCashierStation.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

function requireText(subject, fragment, message = `Expected source to contain: ${fragment}`) {
  assert.ok(subject.includes(fragment), message);
}

requireText(contract, 'Cashier collection transition');
requireText(contract, 'status = READY');
requireText(contract, 'paymentStatus = CAPTURED');
requireText(contract, 'No staging, deployment, Supabase mutation');
requireText(models, 'val readyForCollectionOrders: List<NativeReadyForCollectionOrder>');
requireText(models, 'data class NativeReadyForCollectionOrder(');
requireText(database, 'private fun readReadyForCollectionOrdersForBranch(');
requireText(database, 'MAX_NATIVE_READY_COLLECTION_ORDERS');
requireText(database, 'value.optString("status", "").trim() != "READY"');
requireText(database, 'value.optString("paymentStatus", "").trim() != "CAPTURED"');
requireText(plugin, 'put("readyForCollectionOrders", JSArray().apply');
requireText(bridge, 'export interface NativeHubReadyForCollectionOrder');
requireText(bridge, 'readyForCollectionOrders: NativeHubReadyForCollectionOrder[];');
requireText(cashierUi, "type: 'order.status.transition'");
requireText(cashierUi, "payload: { orderId: order.id, status: 'COLLECTED' }");
requireText(cashierUi, 'Ready for customer collection');
requireText(cashierUi, 'Retry the same collection request');
requireText(cashierUi, 'Abandon only if native confirms it never committed');
requireText(releaseStatus, 'Cashier collection workflow');
assert.ok(!cashierUi.includes('supabase'), 'Cashier collection must not mutate Supabase directly.');

const fixture = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000081',
  business: '10000000-0000-4000-8000-000000000081',
  branch: '11000000-0000-4000-8000-000000000081',
  device: '12000000-0000-4000-8000-000000000081',
  cashier: '20000000-0000-4000-8000-000000000081',
  cashierSession: '30000000-0000-4000-8000-000000000081',
  order: '40000000-0000-4000-8000-000000000081',
});

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const collectionEvent = ({ eventId, commandId, sequence }) => `
  INSERT INTO public.hub_events (
    event_id, command_id, aggregate_id, aggregate_type, action,
    business_id, branch_id, hub_device_id, staff_id, staff_session_id,
    sequence, event_ordinal, occurred_at, schema_version, payload, content_sha256
  ) VALUES (
    ${quote(eventId)}, ${quote(commandId)}, ${quote(fixture.order)}, 'order', 'ORDER_STATUS_CHANGED',
    ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, ${quote(fixture.cashierSession)},
    ${sequence}, 0, now(), 1,
    ${quote(JSON.stringify({ id: fixture.order, orderId: fixture.order, previousStatus: 'READY', status: 'COLLECTED' }))}::jsonb,
    decode(repeat('00', 32), 'hex')
  );
`;

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
    INSERT INTO auth.users (id, email) VALUES (${quote(fixture.owner)}, 'collection-owner@example.test');
    INSERT INTO public.businesses (id, name, owner_id, onboarding_status)
    VALUES (${quote(fixture.business)}, 'Collection workflow test', ${quote(fixture.owner)}, 'COMPLETED');
    INSERT INTO public.branches (id, business_id, name)
    VALUES (${quote(fixture.branch)}, ${quote(fixture.business)}, 'Collection branch');
    INSERT INTO public.devices (id, device_id, business_id, branch_id, name, type, status, last_seen, operational_role)
    VALUES (${quote(fixture.device)}, 'HUB-COLLECTION-WORKFLOW', ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Collection Hub', 'TERMINAL', 'ACTIVE', now(), 'CASHIER_HUB');
    INSERT INTO public.staff_members (id, business_id, branch_id, name, role, status)
    VALUES (${quote(fixture.cashier)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'Cashier', 'CASHIER', 'ACTIVE');
    INSERT INTO public.hub_staff_sessions (
      session_id, business_id, branch_id, hub_device_id, staff_id, role, revocation_version, status, expires_at, activated_at
    ) VALUES (
      ${quote(fixture.cashierSession)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, ${quote(fixture.device)}, ${quote(fixture.cashier)}, 'CASHIER', 0, 'ACTIVE', now() + interval '1 hour', now()
    );
    INSERT INTO public.orders (
      id, business_id, branch_id, device_id, cashier_id, cashier_name,
      subtotal, tax, total_amount, status, payment_method, payment_status
    ) VALUES (
      ${quote(fixture.order)}, ${quote(fixture.business)}, ${quote(fixture.branch)}, 'HUB-COLLECTION-WORKFLOW', ${quote(fixture.cashier)}, 'Cashier',
      25, 0, 25, 'READY', 'CASH', 'PENDING'
    );
  `);

  await assert.rejects(
    () => db.exec(collectionEvent({
      eventId: '60000000-0000-4000-8000-000000000081',
      commandId: '50000000-0000-4000-8000-000000000081',
      sequence: 1,
    })),
    (error) => error instanceof Error && error.message.includes('R004_ORDER_CASHIER_TRANSITION_FORBIDDEN'),
    'A pending order cannot be collected by a Cashier.',
  );

  await db.exec(`UPDATE public.orders SET payment_status = 'CAPTURED' WHERE id = ${quote(fixture.order)};`);
  await db.exec(collectionEvent({
    eventId: '60000000-0000-4000-8000-000000000082',
    commandId: '50000000-0000-4000-8000-000000000082',
    sequence: 2,
  }));
} finally {
  await db.close();
}

console.log('R008 cash collection workflow contract checks passed');
