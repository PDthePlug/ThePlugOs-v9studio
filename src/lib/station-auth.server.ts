import { getCookie, setCookie } from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";
import { getSql } from "./db";

const COOKIE = "__Host-plugos-device";
export const deviceTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function assertOwnerBrowser() {
  if (getCookie(COOKIE)) throw new Error("Owner access is not available on a paired station.");
}
export function createDeviceToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: deviceTokenHash(token) };
}
export function setDeviceToken(token: string) {
  setCookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 180 });
}
export async function resolveStation(bearerToken?: string) {
  const token = getCookie(COOKIE);
  if (token) {
    const sql = await getSql();
    const rows = await sql<{id: string; user_id: string; role: string}>`select id, user_id, role from devices where token_hash = ${deviceTokenHash(token)} and status = 'ACTIVE'`;
    if (!rows[0]) throw new Error("This device is no longer paired. Ask the owner for a new invitation.");
    return { userId: rows[0].user_id, deviceId: rows[0].id, deviceRole: rows[0].role };
  }
  const { requireUserId } = await import("./auth/verify.server");
  return { userId: await requireUserId(bearerToken), deviceId: null, deviceRole: null };
}
