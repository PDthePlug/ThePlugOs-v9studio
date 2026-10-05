import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
const auth = vi.hoisted(() => ({ userId: "", deviceId: null as string | null, deviceRole: null as string | null }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator = (input: unknown) => input;
  const chain = { middleware: () => chain, validator: (v: typeof validator) => {validator = v; return chain;}, handler: (handler: (arg: unknown) => unknown) => async (arg?: {data: unknown}) => handler({context: {...auth}, data: validator(arg?.data)}) };
  return chain;
} }));
vi.mock("@/lib/auth/middleware", () => ({authMiddleware: {}}));
vi.mock("@/lib/station-auth", () => ({stationMiddleware: {}, pairingMiddleware: {}}));
vi.mock("@/lib/station-auth.server", () => ({createDeviceToken: () => ({token: randomUUID(), hash: randomUUID()}), setDeviceToken: () => {}}));
import * as hub from "@/lib/hub";
import { getSql } from "@/lib/db";

async function fixture() {
  auth.userId = randomUUID(); auth.deviceId = null; auth.deviceRole = null;
  await hub.completeOnboarding({data:{businessName:"QA Takeaway",branchName:"Johannesburg",team:[{name:"Thandi",role:"CASHIER",pin:"1234"},{name:"Sipho",role:"KITCHEN",pin:"2345"},{name:"Lebo",role:"MANAGER",pin:"3456"}]}});
  const shop = (await hub.getShopState())!;
  const station = async (role: string, pin: string) => (await hub.signInStation({data:{staffId:shop.staff.find(s=>s.role===role)!.id,pin}})).sessionId;
  const manager = await station("MANAGER","3456"); const cashier = await station("CASHIER","1234"); const kitchen = await station("KITCHEN","2345");
  const product = shop.products[0];
  const open = () => hub.openShift({data:{sessionId:manager,requestId:randomUUID(),openingFloatCents:50000}});
  const stock = (qty=10) => hub.recordInventory({data:{sessionId:manager,requestId:randomUUID(),productId:product.id,kind:"RECEIPT",qty}});
  const order = (requestId=randomUUID(),qty=1) => hub.createOrder({data:{sessionId:cashier,requestId,items:[{productId:product.id,qty}]}});
  return {shop,manager,cashier,kitchen,product,open,stock,order};
}
describe("authoritative shop operations (transport mocked; real SQL and migrations)", () => {
  it("creates zero stock and requires manager authority and an open shift",async()=>{
    const f=await fixture();expect(f.shop.products.every(p=>p.stock===0)).toBe(true);expect(f.shop.devices).toHaveLength(0);
    await expect(f.order()).rejects.toThrow("Sales are paused");
    await expect(hub.openShift({data:{sessionId:f.cashier,requestId:randomUUID(),openingFloatCents:0}})).rejects.toThrow("role");
    await f.open();await expect(f.order()).rejects.toThrow("stock");
  });
  it("reserves stock atomically and replays matching requests without duplicate sales",async()=>{
    const f=await fixture();await f.open();await f.stock(2);const request=randomUUID();const first=await f.order(request,2);const replay=await f.order(request,2);expect(replay.lastOrderId).toBe(first.lastOrderId);expect(replay.orders).toHaveLength(1);expect(replay.products.find(p=>p.id===f.product.id)!.stock).toBe(0);
    await expect(f.order(request,1)).rejects.toThrow("request");await expect(f.order()).rejects.toThrow("stock");
    await expect(hub.createOrder({data:{sessionId:f.cashier,requestId:randomUUID(),items:[{productId:f.product.id,qty:NaN}]}})).rejects.toThrow();
  });
  it("takes cash, moves kitchen states, collects, and closes with exact cash-up totals",async()=>{
    const f=await fixture();await f.open();await f.stock();const o=await f.order();const id=o.lastOrderId!;
    await expect(hub.closeShift({data:{sessionId:f.manager,requestId:randomUUID(),countedCents:50000}})).rejects.toThrow("open orders");
    const payment={sessionId:f.cashier,orderId:id,tenderedCents:f.product.priceCents+1000};await hub.capturePayment({data:payment});await hub.capturePayment({data:payment});
    await hub.transitionOrder({data:{sessionId:f.kitchen,orderId:id,status:"PREPARING"}});await hub.transitionOrder({data:{sessionId:f.kitchen,orderId:id,status:"READY"}});await hub.transitionOrder({data:{sessionId:f.cashier,orderId:id,status:"COLLECTED"}});
    const expected=50000+f.product.priceCents;const result=await hub.closeShift({data:{sessionId:f.manager,requestId:randomUUID(),countedCents:expected}});expect(result.shift).toBeNull();expect(result.report!.shifts[0].expected_cents).toBe(expected);expect(result.report!.daily[0].sales).toBe(f.product.priceCents);
  });
  it("restores cancellation stock exactly once and forbids cancellation during preparation",async()=>{
    const f=await fixture();await f.open();await f.stock(2);const o=await f.order();const data={sessionId:f.cashier,orderId:o.lastOrderId!,status:"CANCELLED" as const};await hub.transitionOrder({data});const result=await hub.transitionOrder({data});expect(result.products.find(p=>p.id===f.product.id)!.stock).toBe(2);
    const next=await f.order();await hub.transitionOrder({data:{sessionId:f.kitchen,orderId:next.lastOrderId!,status:"PREPARING"}});await expect(hub.transitionOrder({data:{...data,orderId:next.lastOrderId!}})).rejects.toThrow("unprepared");
  });
  it("strips all kitchen money, rejects cross-tenant sessions and binds devices",async()=>{
    const f=await fixture();await f.open();await f.stock();await f.order();const kitchen=await hub.getStationContext({data:{sessionId:f.kitchen}});expect(kitchen.expectedDrawerCents).toBe(0);expect(kitchen.shift).toBeNull();expect(kitchen.report).toBeNull();expect(kitchen.orders[0].items.every(i=>i.priceCents===0)).toBe(true);expect(kitchen.orders[0].cashierName).toBeNull();
    auth.deviceId="other";await expect(hub.getStationContext({data:{sessionId:f.cashier}})).rejects.toThrow("device");auth.deviceId=null;auth.userId=randomUUID();await expect(hub.getStationContext({data:{sessionId:f.cashier}})).rejects.toThrow("Sign in");
  });
  it("persists PIN lockout and revokes sessions on reset",async()=>{
    const f=await fixture();const id=f.shop.staff.find(s=>s.role==="CASHIER")!.id;for(let i=0;i<5;i++)await expect(hub.signInStation({data:{staffId:id,pin:"9999"}})).rejects.toThrow("incorrect");await expect(hub.signInStation({data:{staffId:id,pin:"1234"}})).rejects.toThrow("locked");await hub.resetStaffPin({data:{staffId:id,pin:"8765"}});await expect(hub.getStationContext({data:{sessionId:f.cashier}})).rejects.toThrow("Sign in");await hub.signInStation({data:{staffId:id,pin:"8765"}});
  });
  it("replays inventory commands and rolls back invalid waste with no stray command record",async()=>{
    const f=await fixture();const data={sessionId:f.manager,requestId:randomUUID(),productId:f.product.id,kind:"RECEIPT" as const,qty:2};await hub.recordInventory({data});const repeated=await hub.recordInventory({data});expect(repeated.products.find(p=>p.id===f.product.id)!.stock).toBe(2);expect(repeated.report!.inventory).toHaveLength(1);
    const requestId=randomUUID();await expect(hub.recordInventory({data:{...data,requestId,kind:"WASTE",qty:3,reason:"Spoiled"}})).rejects.toThrow("exceed");const sql=await getSql();expect(await sql`select * from business_commands where request_id = ${requestId}`).toHaveLength(0);
  });
});
