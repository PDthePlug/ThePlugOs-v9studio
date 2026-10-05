const SESSION_KEY = "plugos.stationSession";
const DEVICE_KEY = "plugos.deviceId";
const DEVICE_ROLE_KEY = "plugos.deviceRole";

export type StoredSession = {
  sessionId: string;
  staffId: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "KITCHEN";
  name: string;
};

export function readStationSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function writeStationSession(session: StoredSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStationSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function readDeviceId() {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(DEVICE_KEY) || undefined;
}

export function readDeviceRole() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(DEVICE_ROLE_KEY);
}

export function writeDeviceId(id: string, role?: string) {
  localStorage.setItem(DEVICE_KEY, id);
  if (role) localStorage.setItem(DEVICE_ROLE_KEY, role);
}

export function isOfflineMode() {
  if (typeof window === "undefined") return false;
  return !navigator.onLine;
}

