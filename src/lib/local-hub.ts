/** Server-confirmed snapshots only. Browser storage is not financial authority. */
import { getStationContext } from "./hub";
import type { Order, ShopSnapshot, StationContext } from "./types";
export const mergeLocalContext = (context: StationContext) => context;
export const mergeLocalSnapshot = (snapshot: ShopSnapshot) => snapshot;
export const isQueuedLocally = (_orderId: string) => false;
export function notifyLocalHub() { if (typeof window !== "undefined") window.dispatchEvent(new Event("plugos-local")); }
export function subscribeLocalHub(callback: () => void) {
  window.addEventListener("plugos-local", callback);
  return () => window.removeEventListener("plugos-local", callback);
}
export async function flushLocalHub(sessionId: string) { return getStationContext({data: {sessionId}}); }
export function queueLocalOrder(_order: Order): never { throw new Error("Reconnect before sending an order."); }
export function updateLocalOrder(_id: string, _patch: Partial<Order>): never { throw new Error("Reconnect before updating an order."); }
