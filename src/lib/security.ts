/**
 * Compatibility surface for retired browser security calls.
 *
 * R002 RPCs were never deployed and a browser owner JWT is not an operational
 * staff/device authority. The authenticated native enrollment/session flow and
 * staged cloud receiver replace these functions; every legacy call fails
 * closed without sending PINs, codes, or device assertions to Supabase.
 */

const retiredMessage = 'Browser security operations are retired. Use the authenticated Android Cashier Hub after the staged enrollment and staff-session services are released.';

export interface VerifyPinResult {
  authenticated: boolean;
  locked?: boolean;
  error?: string;
  staff?: {
    id: string;
    business_id: string;
    branch_id: string;
    name: string;
    role: string;
    status: string;
  };
  sessionToken?: string;
}

export interface PairDeviceResult {
  success: boolean;
  error?: string;
  deviceId?: string;
  businessId?: string;
  branchId?: string;
}

export interface DeviceStatusResult {
  active: boolean;
  status?: string;
  device?: {
    id?: string;
    device_id: string;
    business_id: string;
    branch_id: string;
    name: string;
    type: string;
    status: string;
  };
}

export interface CreatePairingCodeResult {
  success: boolean;
  code?: string;
  pairing_code?: string;
  expiresAt?: string;
  expires_at?: string;
  error?: string;
}

export interface DeviceBootstrapResult {
  success: boolean;
  error?: string;
  status?: string;
  business?: {
    id: string;
    name: string;
    onboarding_status: string;
    owner_id?: string;
  };
  branch?: {
    id: string;
    name: string;
    business_id: string;
  };
  staff?: unknown[];
  products?: unknown[];
}

export async function setStaffPin(
  _: string,
  __: string,
  ___: string,
  ____: string,
  _____?: string
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: retiredMessage };
}

export async function verifyStaffPin(_: string, __: string, ___: string, ____: string): Promise<VerifyPinResult> {
  return { authenticated: false, error: retiredMessage };
}

export async function createDevicePairingCode(_: string, __: string, ___?: string): Promise<CreatePairingCodeResult> {
  return { success: false, error: retiredMessage };
}

export async function pairDeviceWithCode(_: string, __: string, ___: string, ____: string): Promise<PairDeviceResult> {
  return { success: false, error: retiredMessage };
}

export async function verifyDeviceStatus(_: string): Promise<DeviceStatusResult> {
  return { active: false, status: 'NATIVE_HUB_REQUIRED' };
}

export async function revokeDevice(_: string, __: string, ___?: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: retiredMessage };
}

export async function getDeviceBootstrap(_: string): Promise<DeviceBootstrapResult> {
  return { success: false, error: retiredMessage, status: 'NATIVE_HUB_REQUIRED' };
}
