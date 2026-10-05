import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { z } from "zod";
import { stationMiddleware, pairingMiddleware } from "./station-auth";
import { getSql } from "@/lib/db";
import { hashCode, hashPin, verifyCode, verifyPin } from "@/lib/pin";
import { newId, sixDigitCode } from "@/lib/ids";
import {
  STARTER_MENU,
  type CashShift,
  type Device,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Product,
  type ShopSnapshot,
  type StaffMember,
  type StaffRole,
  type StationContext,
} from "@/lib/types";

type Sql = Awaited<ReturnType<typeof getSql>>;

function asNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function requireRole(role: string, allowed: StaffRole[]) {
  if (!allowed.includes(role as StaffRole)) {
    throw new Error("This action is not available for your role.");
  }
}

async function requireShop(sql: Sql, userId: string) {
  const rows = await sql<{
    id: string;
    name: string;
    branch_name: string;
    onboarding_status: string;
  }>`select id, name, branch_name, onboarding_status from shops where user_id = ${userId} limit 1`;
  return rows[0] ?? null;
}

async function loadProducts(sql: Sql, userId: string): Promise<Product[]> {
  const rows = await sql<{
    id: string;
    name: string;
    category: string;
    price_cents: number;
    stock: string | number;
    active: boolean;
  }>`select id, name, category, price_cents, stock, active from products where user_id = ${userId} order by category, name`;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    priceCents: asNumber(row.price_cents),
    stock: asNumber(row.stock),
    active: Boolean(row.active),
  }));
}

async function loadStaff(sql: Sql, userId: string): Promise<StaffMember[]> {
  const rows = await sql<{
    id: string;
    name: string;
    role: StaffRole;
    status: string;
  }>`select id, name, role, status from staff where user_id = ${userId} order by role, name`;
  return rows;
}

async function loadDevices(sql: Sql, userId: string): Promise<Device[]> {
  const rows = await sql<{
    id: string;
    name: string;
    role: Device["role"];
    status: string;
    last_seen: string | null;
  }>`select id, name, role, status, last_seen from devices where user_id = ${userId} order by created_at`;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    lastSeen: row.last_seen,
  }));
}

async function loadOrders(sql: Sql, userId: string): Promise<Order[]> {
  const orderRows = await sql<{
    id: string;
    number: number;
    status: OrderStatus;
    cashier_id: string | null;
    cashier_name: string | null;
    payment_status: "UNPAID" | "PAID";
    tendered_cents: number | null;
    total_cents: number;
    created_at: string;
  }>`select id, number, status, cashier_id, cashier_name, payment_status, tendered_cents, total_cents, created_at from orders where user_id = ${userId} and (status in ('PLACED', 'PREPARING', 'READY') or created_at >= now() - interval '7 days') order by created_at desc`;
  if (orderRows.length === 0) return [];
  const itemRows = await sql<{
    id: string;
    order_id: string;
    product_id: string | null;
    name: string;
    qty: number;
    price_cents: number;
  }>`select id, order_id, product_id, name, qty, price_cents from order_items where user_id = ${userId} and order_id in (select id from orders where user_id = ${userId} and (status in ('PLACED', 'PREPARING', 'READY') or created_at >= now() - interval '7 days'))`;
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({
      id: item.id,
      productId: item.product_id,
      name: item.name,
      qty: asNumber(item.qty),
      priceCents: asNumber(item.price_cents),
    });
    itemsByOrder.set(item.order_id, list);
  }
  return orderRows.map((row) => ({
    id: row.id,
    number: asNumber(row.number),
    status: row.status,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name,
    paymentStatus: row.payment_status,
    tenderedCents: row.tendered_cents == null ? null : asNumber(row.tendered_cents),
    totalCents: asNumber(row.total_cents),
    createdAt: row.created_at,
    items: itemsByOrder.get(row.id) ?? [],
  }));
}

async function loadOpenShift(sql: Sql, userId: string): Promise<CashShift | null> {
  const rows = await sql<{
    id: string;
    status: "OPEN" | "CLOSED";
    opened_by: string;
    opening_float_cents: number;
    expected_cents: number | null;
    counted_cents: number | null;
    opened_at: string;
  }>`select id, status, opened_by, opening_float_cents, expected_cents, counted_cents, opened_at from cash_shifts where user_id = ${userId} and status = 'OPEN' order by opened_at desc limit 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    openedBy: row.opened_by,
    openingFloatCents: asNumber(row.opening_float_cents),
    expectedCents: row.expected_cents == null ? null : asNumber(row.expected_cents),
    countedCents: row.counted_cents == null ? null : asNumber(row.counted_cents),
    openedAt: row.opened_at,
  };
}

async function expectedDrawer(sql: Sql, userId: string, shift: CashShift | null) {
  if (!shift) return 0;
  const rows = await sql<{ sum: string | number | null }>`
    select coalesce(sum(total_cents), 0) as sum
    from orders
    where user_id = ${userId}
      and payment_status = 'PAID'
      and status <> 'CANCELLED'
      and shift_id = ${shift.id}
  `;
  return shift.openingFloatCents + asNumber(rows[0]?.sum);
}

async function pendingOutboxCount(sql: Sql, userId: string) {
  const rows = await sql<{ n: string | number }>`select count(*) as n from outbox where user_id = ${userId} and status = 'PENDING'`;
  return asNumber(rows[0]?.n);
}

async function buildSnapshot(sql: Sql, userId: string): Promise<ShopSnapshot | null> {
  const shop = await requireShop(sql, userId);
  if (!shop) return null;
  const [staff, products, devices, orders, shift, pendingOutbox] = await Promise.all([
    loadStaff(sql, userId),
    loadProducts(sql, userId),
    loadDevices(sql, userId),
    loadOrders(sql, userId),
    loadOpenShift(sql, userId),
    pendingOutboxCount(sql, userId),
  ]);

  const today = await sql<{ sales: string | number; n: string | number }>`
    select coalesce(sum(total_cents), 0) as sales, count(*) as n
    from orders
    where user_id = ${userId}
      and payment_status = 'PAID'
      and status <> 'CANCELLED'
      and paid_at >= (date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')
  `;
  return {
    shop: {
      id: shop.id,
      name: shop.name,
      branchName: shop.branch_name,
      onboardingStatus: shop.onboarding_status,
    },
    staff,
    products,
    devices,
    orders,
    shift,
    pendingOutbox,
    salesTodayCents: asNumber(today[0]?.sales),
    ordersToday: asNumber(today[0]?.n),
    report: await loadReport(sql, userId),
  };
}

async function requireSession(sql: Sql, userId: string, sessionId: string, deviceId: string | null) {
  const rows = await sql<{
    id: string;
    staff_id: string;
    role: StaffRole;
    name: string;
    status: string;
    device_id: string | null;
  }>`
    select s.id, s.staff_id, s.role, st.name, st.status, s.device_id
    from staff_sessions s
    join staff st on st.id = s.staff_id and st.user_id = s.user_id and st.role = s.role
    where s.id = ${sessionId} and s.user_id = ${userId} and s.created_at > now() - interval '12 hours'
    limit 1
  `;
  const session = rows[0];
  if (!session || session.status !== "ACTIVE") {
    throw new Error("Sign in at this station again.");
  }
  if (session.device_id !== deviceId) throw new Error("Sign in on the paired device again.");
  if (session.device_id) {
    const devices = await sql`select id from devices where id = ${session.device_id} and user_id = ${userId} and role = ${session.role} and status = 'ACTIVE'`;
    if (!devices[0]) throw new Error("This device is no longer available.");
    await sql`update devices set last_seen = now() where id = ${session.device_id} and user_id = ${userId}`;
  }
  return session;
}

async function ackOutbox(sql: Sql, userId: string, kind: string, payload: unknown) {
  await sql`
    insert into outbox (id, user_id, kind, payload, status, acked_at)
    values (${newId("ob")}, ${userId}, ${kind}, ${JSON.stringify(payload)}, 'ACKED', now())
  `;
}

const id = z.string().trim().min(1).max(150);
const name = z.string().trim().min(2).max(100);
const role = z.enum(["MANAGER", "CASHIER", "KITCHEN"]);
const pin = z.string().regex(/^\d{4,8}$/);
const cents = z.number().int().min(0).max(100000000);
const qty = z.number().min(0).max(1000000).refine(n => Number.isInteger(n * 1000), "Use at most three decimal places.");
async function transaction<T>(userId: string, work: (sql: Sql) => Promise<T>) {
  const db = await getSql();
  return db.transaction(async sql => {
    await sql`select id from shops where user_id = ${userId} for update`;
    return work(sql);
  });
}
async function replayCommand(sql: Sql, userId: string, requestId: string, payload: string) {
  const rows = await sql<{payload: string}>`select payload from business_commands where user_id = ${userId} and request_id = ${requestId}`;
  if (rows[0]) {
    if (rows[0].payload !== payload) throw new Error("This request was already used for another action.");
    return true;
  }
  await sql`insert into business_commands(user_id, request_id, payload) values (${userId}, ${requestId}, ${payload})`;
  return false;
}

export const getShopState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return buildSnapshot(sql, context.userId);
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ businessName: name, branchName: name, team: z.array(z.object({ name, role, pin })).min(3).max(100) }).parse(input))
  .handler(async ({ context, data }) => {
    const businessName = data.businessName.trim();
    const branchName = data.branchName.trim();
    if (businessName.length < 2) throw new Error("Give the business a name.");
    if (branchName.length < 2) throw new Error("Give the first branch a name.");
    if (!(["CASHIER", "KITCHEN", "MANAGER"] as const).every(role => data.team.some(member => member.role === role))) throw new Error("Add cashier, kitchen and manager roles.");
    if (data.team.length < 3) throw new Error("Add at least cashier, kitchen and manager.");
    for (const member of data.team) {
      if (!/^\d{4,8}$/.test(member.pin)) throw new Error("Each PIN must be 4–8 digits.");
      if (!member.name.trim()) throw new Error("Every staff member needs a name.");
    }
    return transaction(context.userId, async (sql) => {
    const existing = await requireShop(sql, context.userId);
    if (existing) throw new Error("This business is already set up.");

    const shopId = newId("shop");
    await sql`
      insert into shops (id, user_id, name, branch_name, onboarding_status)
      values (${shopId}, ${context.userId}, ${businessName}, ${branchName}, 'COMPLETED')
    `;
    for (const member of data.team) {
      await sql`
        insert into staff (id, user_id, name, role, pin_hash, status)
        values (${newId("stf")}, ${context.userId}, ${member.name.trim()}, ${member.role}, ${hashPin(member.pin)}, 'ACTIVE')
      `;
    }
    for (const item of STARTER_MENU) {
      await sql`
        insert into products (id, user_id, name, category, price_cents, stock, active)
        values (${newId("prd")}, ${context.userId}, ${item.name}, ${item.category}, ${item.priceCents}, ${0}, true)
      `;
    }
    return { ok: true as const };
    });
  });

export const addStaffMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ name, role, pin }).parse(input))
  .handler(async ({ context, data }) => {
    if (!/^\d{4,8}$/.test(data.pin)) throw new Error("PIN must be 4–8 digits.");
    return transaction(context.userId, async (sql) => {
    if (!(await requireShop(sql, context.userId))) throw new Error("Set up the business first.");
    await sql`
      insert into staff (id, user_id, name, role, pin_hash, status)
      values (${newId("stf")}, ${context.userId}, ${data.name.trim()}, ${data.role}, ${hashPin(data.pin)}, 'ACTIVE')
    `;
    return buildSnapshot(sql, context.userId);
    });
  });

export const setStaffStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ staffId: id, status: z.enum(["ACTIVE", "SUSPENDED"]) }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    await sql`delete from staff_sessions where staff_id = ${data.staffId} and user_id = ${context.userId}`;
    await sql`update staff set status = ${data.status} where id = ${data.staffId} and user_id = ${context.userId}`;
    return buildSnapshot(sql, context.userId);
    });
  });

export const resetStaffPin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ staffId: id, pin }).parse(input))
  .handler(async ({ context, data }) => {
    if (!/^\d{4,8}$/.test(data.pin)) throw new Error("PIN must be 4–8 digits.");
    return transaction(context.userId, async (sql) => {
    await sql`update staff set failed_attempts = 0, locked_until = null, pin_hash = ${hashPin(data.pin)} where id = ${data.staffId} and user_id = ${context.userId}`;
    await sql`delete from staff_sessions where staff_id = ${data.staffId} and user_id = ${context.userId}`;
    return { ok: true as const };
    });
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ id: id.optional(), name, category: name, priceCents: cents, stock: qty, active: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    if (data.id) {
      await sql`
        update products
        set name = ${data.name.trim()}, category = ${data.category.trim()}, price_cents = ${data.priceCents}, active = ${data.active}
        where id = ${data.id} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into products (id, user_id, name, category, price_cents, stock, active)
        values (${newId("prd")}, ${context.userId}, ${data.name.trim()}, ${data.category.trim()}, ${data.priceCents}, ${0}, ${data.active})
      `;
    }
    return buildSnapshot(sql, context.userId);
    });
  });

export const issuePairingCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ role }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    if (!(await requireShop(sql, context.userId))) throw new Error("Set up the business first.");
    const pairingId = newId("pair");
    const code = sixDigitCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await sql`
      insert into pairing_codes (id, user_id, code_hash, role, expires_at)
      values (${pairingId}, ${context.userId}, ${hashCode(code)}, ${data.role}, ${expires})
    `;
    return { pairingId, code, expiresAt: expires, role: data.role };
    });
  });

export const claimPairingCode = createServerFn({ method: "POST" })
  .middleware([pairingMiddleware])
  .validator((input: unknown) => z.object({ pairingId: id, code: z.string().regex(/^\d{6}$/), deviceName: name }).parse(input))
  .handler(async ({ data }) => {
    const { createDeviceToken, setDeviceToken } = await import("./station-auth.server");
    const db = await getSql();
    const result = await db.transaction(async sql => {
      const rows = await sql<{id: string; user_id: string; role: StaffRole; code_hash: string; expires_at: string; used_at: string | null; attempts: number}>`select * from pairing_codes where id = ${data.pairingId} for update`;
      const row = rows[0];
      if (!row || row.used_at || Date.parse(row.expires_at) < Date.now() || row.attempts >= 5) return { error: "That invitation is unavailable. Ask the owner for a new one." };
      if (!verifyCode(data.code, row.code_hash)) {
        await sql`update pairing_codes set attempts = attempts + 1 where id = ${row.id}`;
        return { error: "That pairing code is not valid." };
      }
      const deviceId = newId("dev");
      const token = createDeviceToken();
      await sql`update pairing_codes set used_at = now() where id = ${row.id}`;
      await sql`insert into devices(id, user_id, name, role, status, last_seen, token_hash) values (${deviceId}, ${row.user_id}, ${data.deviceName}, ${row.role}, 'ACTIVE', now(), ${token.hash})`;
      return { deviceId, role: row.role, token: token.token };
    });
    if ("error" in result) throw new Error(result.error);
    setDeviceToken(result.token);
    return { deviceId: result.deviceId, role: result.role };
  });

export const getStationGate = createServerFn({ method: "GET" })
  .middleware([stationMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const shop = await requireShop(sql, context.userId);
    if (!shop) throw new Error("Set up the business in the owner dashboard first.");
    const staff = (await loadStaff(sql, context.userId)).filter(s => s.status === "ACTIVE" && s.role !== "OWNER" && (!context.deviceRole || s.role === context.deviceRole));
    return { shopName: shop.name, branchName: shop.branch_name, staff, pairedRole: context.deviceRole, deviceId: context.deviceId };
  });

export const signInStation = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ staffId: id, pin }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await getSql();
    const result = await db.transaction(async sql => {
      const rows = await sql<{id: string; name: string; role: StaffRole; status: string; pin_hash: string; failed_attempts: number; locked_until: string | null}>`select * from staff where id = ${data.staffId} and user_id = ${context.userId} for update`;
      const staff = rows[0];
      if (!staff || staff.status !== "ACTIVE" || (context.deviceRole && context.deviceRole !== staff.role)) return { error: "That staff profile is not available at this station." };
      if (staff.locked_until && Date.parse(staff.locked_until) > Date.now()) return { error: "PIN entry is locked for 15 minutes. Ask the owner to reset it." };
      if (!verifyPin(data.pin, staff.pin_hash)) {
        const attempts = staff.locked_until ? 1 : staff.failed_attempts + 1;
        await sql`update staff set failed_attempts = ${attempts}, locked_until = ${attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null} where id = ${staff.id} and user_id = ${context.userId}`;
        return { error: "PIN is incorrect." };
      }
      await sql`update staff set failed_attempts = 0, locked_until = null where id = ${staff.id} and user_id = ${context.userId}`;
      const sessionId = newId("ses");
      await sql`insert into staff_sessions(id, user_id, staff_id, role, device_id) values (${sessionId}, ${context.userId}, ${staff.id}, ${staff.role}, ${context.deviceId})`;
      return { sessionId, staff: { id: staff.id, name: staff.name, role: staff.role, status: staff.status } };
    });
    if ("error" in result) throw new Error(result.error);
    return result;
  });

export const revokeDevice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ deviceId: id }).parse(input))
  .handler(async ({ context, data }) => transaction(context.userId, async sql => {
    await sql`update devices set status = 'REVOKED', token_hash = null where id = ${data.deviceId} and user_id = ${context.userId}`;
    await sql`delete from staff_sessions where device_id = ${data.deviceId} and user_id = ${context.userId}`;
    return buildSnapshot(sql, context.userId);
  }));

export const endStationSession = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    await sql`delete from staff_sessions where id = ${data.sessionId} and user_id = ${context.userId}`;
    return { ok: true as const };
    });
  });

async function stationContext(sql: Sql, userId: string, sessionId: string, deviceId: string | null): Promise<StationContext> {
  const session = await requireSession(sql, userId, sessionId, deviceId);
  const shop = await requireShop(sql, userId);
  if (!shop) throw new Error("Business is not set up.");
  const [products, orders, shift, pendingOutbox] = await Promise.all([
    loadProducts(sql, userId),
    loadOrders(sql, userId),
    loadOpenShift(sql, userId),
    pendingOutboxCount(sql, userId),
  ]);
  const expectedDrawerCents = await expectedDrawer(sql, userId, shift);
  return {
    sessionId,
    staff: { id: session.staff_id, name: session.name, role: session.role, status: session.status },
    shopName: shop.name,
    branchName: shop.branch_name,
    products: session.role === "KITCHEN" ? products.map((p) => ({ ...p, priceCents: 0, stock: 0 })) : products,
    orders:
      session.role === "KITCHEN"
        ? orders
            .filter((order) => order.status === "PLACED" || order.status === "PREPARING" || order.status === "READY")
            .map((order) => ({ ...order, cashierId: null, cashierName: null, totalCents: 0, tenderedCents: null, paymentStatus: "UNPAID" as const, items: order.items.map(item => ({ ...item, priceCents: 0 })) }))
        : orders,
    shift: session.role === "KITCHEN" ? null : shift,
    pendingOutbox,
    expectedDrawerCents: session.role === "KITCHEN" ? 0 : expectedDrawerCents,
    report: session.role === "MANAGER" ? await loadReport(sql, userId) : null,
  };
}

export const getStationContext = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id }).parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    return stationContext(sql, context.userId, data.sessionId, context.deviceId);
  });

export const createOrder = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id, requestId: z.uuid(), items: z.array(z.object({ productId: id, qty: z.number().int().min(1).max(1000) })).min(1).max(100) }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    const session = await requireSession(sql, context.userId, data.sessionId, context.deviceId);
    requireRole(session.role, ["CASHIER", "MANAGER"]);
    const payload = JSON.stringify(data.items);
    const existing = await sql<{id: string; request_payload: string; cashier_id: string}>`select id, request_payload, cashier_id from orders where user_id = ${context.userId} and request_id = ${data.requestId}`;
    if (existing[0]) {
      if (existing[0].request_payload !== payload || existing[0].cashier_id !== session.staff_id) throw new Error("This request has already been used for another basket.");
      return { ...(await stationContext(sql, context.userId, data.sessionId, context.deviceId)), lastOrderId: existing[0].id };
    }
    const shift = await loadOpenShift(sql, context.userId);
    if (!shift) throw new Error("Sales are paused. Ask the manager to open the cash shift.");
    if (new Set(data.items.map(i => i.productId)).size !== data.items.length) throw new Error("Combine duplicate menu items.");
    if (data.items.length === 0) throw new Error("Add something to the basket.");
    const products = await loadProducts(sql, context.userId);
    const lines = data.items.map((item) => {
      const product = products.find((row) => row.id === item.productId && row.active);
      if (!product) throw new Error("A menu item is no longer available.");
      if (product.stock < item.qty) throw new Error(`${product.name} has insufficient stock.`);
      if (item.qty < 1) throw new Error("Quantity must be at least 1.");
      return { product, qty: item.qty };
    });
    const totalCents = lines.reduce((sum, line) => sum + line.product.priceCents * line.qty, 0);
    const countRows = await sql<{ n: string | number }>`select coalesce(max(number), 0) as n from orders where user_id = ${context.userId}`;
    const orderId = newId("ord");
    const number = asNumber(countRows[0]?.n) + 1;
    await sql`
      insert into orders (id, user_id, number, status, cashier_id, cashier_name, payment_status, total_cents, request_id, request_payload, shift_id)
      values (${orderId}, ${context.userId}, ${number}, 'PLACED', ${session.staff_id}, ${session.name}, 'UNPAID', ${totalCents}, ${data.requestId}, ${payload}, ${shift.id})
    `;
    for (const line of lines) {
      await sql`
        insert into order_items (id, order_id, user_id, product_id, name, qty, price_cents)
        values (${newId("itm")}, ${orderId}, ${context.userId}, ${line.product.id}, ${line.product.name}, ${line.qty}, ${line.product.priceCents})
      `;
      await sql`update products set stock = stock - ${line.qty} where id = ${line.product.id} and user_id = ${context.userId}`;
    }
    await ackOutbox(sql, context.userId, "order.create", { orderId });
    return { ...(await stationContext(sql, context.userId, data.sessionId, context.deviceId)), lastOrderId: orderId };
    });
  });

export const capturePayment = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id, orderId: id, tenderedCents: cents }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    const session = await requireSession(sql, context.userId, data.sessionId, context.deviceId);
    requireRole(session.role, ["CASHIER", "MANAGER"]);
    const shift = await loadOpenShift(sql, context.userId);
    if (!shift) throw new Error("Sales are paused. Ask the manager to open the cash shift.");
    const orders = await sql<{ id: string; total_cents: number; status: OrderStatus; payment_status: string; shift_id: string }>`
      select id, total_cents, status, payment_status, shift_id from orders where id = ${data.orderId} and user_id = ${context.userId} limit 1
    `;
    const order = orders[0];
    if (!order) throw new Error("Order not found.");
    if (order.status === "CANCELLED") throw new Error("A cancelled order cannot be paid.");
    if (order.payment_status === "PAID") return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    if (order.shift_id !== shift.id) throw new Error("This order belongs to another shift.");
    if (data.tenderedCents < asNumber(order.total_cents)) throw new Error("Cash tendered is short.");
    await sql`
      update orders
      set payment_status = 'PAID', paid_at = now(), tendered_cents = ${data.tenderedCents}, updated_at = now()
      where id = ${data.orderId} and user_id = ${context.userId}
    `;
    await ackOutbox(sql, context.userId, "payment.capture", { orderId: data.orderId });
    return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    });
  });

export const transitionOrder = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id, orderId: id, status: z.enum(["PLACED", "PREPARING", "READY", "COLLECTED", "CANCELLED"]) }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    const session = await requireSession(sql, context.userId, data.sessionId, context.deviceId);
    const orders = await sql<{ id: string; status: OrderStatus; payment_status: string }>`
      select id, status, payment_status from orders where id = ${data.orderId} and user_id = ${context.userId} limit 1
    `;
    const order = orders[0];
    if (!order) throw new Error("Order not found.");
    const allowed: Record<string, OrderStatus[]> = {
      KITCHEN: ["PREPARING", "READY"],
      CASHIER: ["COLLECTED", "CANCELLED"],
      MANAGER: ["PREPARING", "READY", "COLLECTED", "CANCELLED"],
    };
    requireRole(session.role, Object.keys(allowed) as StaffRole[]);
    if (!allowed[session.role]?.includes(data.status)) {
      throw new Error("That status change is not allowed for this station.");
    }
    if (order.status === data.status) return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    if (data.status === "PREPARING" && order.status !== "PLACED") throw new Error("Only waiting orders can start.");
    if (data.status === "READY" && order.status !== "PREPARING") throw new Error("Only cooking orders can be marked ready.");
    if (data.status === "COLLECTED") {
      if (order.status !== "READY") throw new Error("Hand over only when the kitchen has marked it ready.");
      if (order.payment_status !== "PAID") throw new Error("Take payment before handing over.");
    }
    if (data.status === "CANCELLED") {
      if (order.payment_status === "PAID") throw new Error("Paid orders cannot be cancelled here.");
      if (order.status !== "PLACED") throw new Error("Only unprepared unpaid orders can be cancelled.");
    }
    if (data.status === "CANCELLED") {
      const items = await sql<{product_id: string; qty: number}>`select product_id, qty from order_items where order_id = ${order.id} and user_id = ${context.userId}`;
      for (const item of items) await sql`update products set stock = stock + ${item.qty} where id = ${item.product_id} and user_id = ${context.userId}`;
    }
    await sql`update orders set status = ${data.status}, updated_at = now() where id = ${data.orderId} and user_id = ${context.userId}`;
    await ackOutbox(sql, context.userId, "order.status.transition", { orderId: data.orderId, status: data.status });
    return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    });
  });

export const openShift = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id, requestId: z.uuid(), openingFloatCents: cents }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    const session = await requireSession(sql, context.userId, data.sessionId, context.deviceId);
    requireRole(session.role, ["MANAGER"]);
    if (await replayCommand(sql, context.userId, data.requestId, JSON.stringify({kind: "openShift", staffId: session.staff_id, data}))) return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    const existing = await loadOpenShift(sql, context.userId);
    if (existing) throw new Error("A cash shift is already open.");
    await sql`
      insert into cash_shifts (id, user_id, status, opened_by, opening_float_cents)
      values (${newId("shf")}, ${context.userId}, 'OPEN', ${session.name}, ${data.openingFloatCents})
    `;
    await ackOutbox(sql, context.userId, "shift.open", { openingFloatCents: data.openingFloatCents });
    return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    });
  });

export const closeShift = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id, requestId: z.uuid(), countedCents: cents }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    const session = await requireSession(sql, context.userId, data.sessionId, context.deviceId);
    requireRole(session.role, ["MANAGER"]);
    if (await replayCommand(sql, context.userId, data.requestId, JSON.stringify({kind: "closeShift", staffId: session.staff_id, data}))) return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    const shift = await loadOpenShift(sql, context.userId);
    if (!shift) throw new Error("There is no open shift.");
    const pending = await sql<{ n: string | number }>`
      select count(*) as n from orders
      where user_id = ${context.userId}
        and status in ('PLACED', 'PREPARING', 'READY')

    `;
    if (asNumber(pending[0]?.n) > 0) throw new Error("Finish or cancel open orders before closing the shift.");
    const expected = await expectedDrawer(sql, context.userId, shift);
    await sql`
      update cash_shifts
      set status = 'CLOSED', expected_cents = ${expected}, counted_cents = ${data.countedCents}, closed_at = now()
      where id = ${shift.id} and user_id = ${context.userId}
    `;
    await ackOutbox(sql, context.userId, "shift.close", { countedCents: data.countedCents });
    return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    });
  });

export const recordInventory = createServerFn({ method: "POST" })
  .middleware([stationMiddleware])
  .validator((input: unknown) => z.object({ sessionId: id, requestId: z.uuid(), productId: id, kind: z.enum(["RECEIPT", "COUNT", "WASTE"]), qty, reason: z.string().trim().max(250).optional() }).parse(input))
  .handler(async ({ context, data }) => {
    return transaction(context.userId, async (sql) => {
    const session = await requireSession(sql, context.userId, data.sessionId, context.deviceId);
    requireRole(session.role, ["MANAGER"]);
    if (await replayCommand(sql, context.userId, data.requestId, JSON.stringify({kind: "recordInventory", staffId: session.staff_id, data}))) return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    if (data.kind !== "COUNT" && data.qty <= 0) throw new Error("Enter a positive quantity.");
    if (data.kind !== "RECEIPT" && !data.reason) throw new Error("Give a reason for count or waste.");
    if (data.qty < 0) throw new Error("Quantity cannot be negative.");
    const products = await sql<{ id: string; stock: string | number }>`select id, stock from products where id = ${data.productId} and user_id = ${context.userId} limit 1`;
    const product = products[0];
    if (!product) throw new Error("Product not found.");
    const current = asNumber(product.stock);
    if (data.kind === "WASTE" && data.qty > current) throw new Error("Waste cannot exceed available stock.");
    const next = data.kind === "COUNT" ? data.qty : data.kind === "WASTE" ? Math.max(0, current - data.qty) : current + data.qty;
    if (data.kind === "WASTE" && data.qty <= 0) throw new Error("Waste must be a positive quantity.");
    await sql`update products set stock = ${next} where id = ${data.productId} and user_id = ${context.userId}`;
    await sql`
      insert into inventory_moves (id, user_id, product_id, kind, qty, reason)
      values (${newId("inv")}, ${context.userId}, ${data.productId}, ${data.kind}, ${data.qty}, ${data.reason ?? null})
    `;
    await ackOutbox(sql, context.userId, `inventory.${data.kind.toLowerCase()}`, { productId: data.productId, qty: data.qty });
    return stationContext(sql, context.userId, data.sessionId, context.deviceId);
    });
  });

async function loadReport(sql: Sql, userId: string) {
  const daily = await sql<{day: string; sales: number; orders: number}>`select (paid_at at time zone 'Africa/Johannesburg')::date::text as day, sum(total_cents)::int as sales, count(*)::int as orders from orders where user_id = ${userId} and payment_status = 'PAID' and paid_at >= now() - interval '30 days' group by day order by day desc`;
  const topProducts = await sql<{name: string; quantity: number; sales: number}>`select i.name, sum(i.qty)::int as quantity, sum(i.qty*i.price_cents)::int as sales from order_items i join orders o on o.id = i.order_id and o.user_id = i.user_id where i.user_id = ${userId} and o.payment_status = 'PAID' and o.paid_at >= now() - interval '30 days' group by i.name order by sales desc limit 10`;
  const shifts = await sql<{id: string; status: string; opened_by: string; opening_float_cents: number; expected_cents: number | null; counted_cents: number | null; opened_at: string; closed_at: string | null}>`select id, status, opened_by, opening_float_cents, expected_cents, counted_cents, opened_at, closed_at from cash_shifts where user_id = ${userId} order by opened_at desc limit 30`;
  const inventory = await sql<{id: string; name: string; kind: string; qty: string; reason: string | null; created_at: string}>`select m.id, p.name, m.kind, m.qty, m.reason, m.created_at from inventory_moves m join products p on p.id = m.product_id and p.user_id = m.user_id where m.user_id = ${userId} order by m.created_at desc limit 100`;
  return { daily, topProducts, shifts, inventory };
}
