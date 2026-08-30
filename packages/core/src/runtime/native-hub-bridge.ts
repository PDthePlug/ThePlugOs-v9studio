import type { KernelEvent } from '../events';

export type HubDeviceRole =
  | 'CASHIER'
  | 'KITCHEN_STAFF'
  | 'MANAGER'
  | 'OWNER'
  | 'ADMINISTRATOR'
  | 'PRINTER'
  | 'DISPLAY';

export interface DeviceNode {
  id: string;
  name: string;
  role: HubDeviceRole;
  ipAddress?: string;
  status: 'ACTIVE' | 'DEGRADED' | 'OFFLINE' | 'REVOKED';
  lastHeartbeat?: string;
  latencyMs?: number | null;
  certFingerprint?: string;
  queuedEvents: number;
  connectionType: 'LAN_WIFI' | 'BLE_FALLBACK' | 'MESH_P2P' | 'ETHERNET' | 'UNAVAILABLE';
  businessId?: string;
  branchId?: string;
  isHub?: boolean;
}

export type NativeHubAvailability = 'READY' | 'UNAVAILABLE' | 'ERROR';
export type CloudLinkState = 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';

export interface NetworkHealth {
  mode: 'LOCAL_HUB_PRIMARY' | 'STANDALONE_FALLBACK' | 'CLOUD_SYNCHRONIZED' | 'NATIVE_HUB_REQUIRED';
  availability: NativeHubAvailability;
  localPeerCount: number;
  packetLossRate: number | null;
  latencyMs: number | null;
  outboxDepth: number;
  inboxDepth: number;
  lastSyncTimestamp: string | null;
  cloudConnected: boolean;
  cloudStatus: CloudLinkState;
  activeTransport: 'LAN_WIFI' | 'BLE' | 'P2P_MESH' | 'ETHERNET' | 'UNAVAILABLE';
  message: string;
}

export interface FailureScenario {
  id: string;
  title: string;
  description: string;
  impact: string;
  recoveryMechanism: string;
  status: 'IDLE' | 'SIMULATING' | 'RECOVERING' | 'RESOLVED';
}

export interface SecondaryTransportMetric {
  name: string;
  type: 'LAN_WIFI' | 'BLE' | 'WIFI_DIRECT' | 'P2P_MESH' | 'USB_ETHERNET';
  bandwidthMbps: number;
  maxLatencyMs: number;
  maxDevices: number;
  batteryImpact: 'LOW' | 'MEDIUM' | 'HIGH';
  rangeMeters: number;
  townshipSuitabilityScore: number;
  status: 'PRIMARY' | 'EVALUATED_FALLBACK' | 'EXPERIMENTAL';
  recommendation: string;
}

export interface HubSnapshot {
  devices: DeviceNode[];
  networkHealth: NetworkHealth;
  failures: FailureScenario[];
  transportMetrics: SecondaryTransportMetric[];
  outbox: KernelEvent[];
  inbox: KernelEvent[];
}

export interface DeviceRegistrationRequest {
  name: string;
  role: HubDeviceRole;
  branchId: string;
  branchName?: string;
  connectionType?: DeviceNode['connectionType'];
}

/** The web layer supplies only task input. Native code supplies the device,
 * active staff session, timestamp, sequence, and Keystore signature. */
export interface NativeHubCommandRequest {
  commandId: string;
  type: 'shift.open' | 'shift.close' | 'order.create' | 'order.status.transition' | 'payment.capture' | 'inventory.receive' | 'inventory.adjust' | 'inventory.waste';
  payload: Record<string, unknown>;
}

/** Deliberately excludes staffSessionId, deviceId, sequence, signature, and
 * any other reusable authority fact. */
export interface NativeHubCommandReceipt {
  commandId: string;
  outcome: 'APPLIED' | 'DUPLICATE';
  committedAt: string;
  eventIds: string[];
  outboxIds: string[];
}

export interface NativeHubCatalogProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  stockQuantity: number;
  unit: string;
  status: 'ACTIVE';
}

/** Minimum non-financial stock facts a Manager may use to request a counted
 * inventory receipt. The Hub derives all movement and receipt authority. */
export interface NativeHubInventoryProduct {
  id: string;
  name: string;
  stockQuantity: number;
  unit: string;
}

/** Measured native cash-drawer state. This is a projection of committed Hub
 * events, not a browser-created shift or cash balance. */
export interface NativeHubCashShift {
  id: string;
  status: 'OPEN';
  openingFloat: number;
  cashSalesTotal: number;
  cashTenderedTotal: number;
  cashChangeTotal: number;
  expectedCash: number;
}

/** A Cashier's own local cash orders which still require a cash capture. */
export interface NativeHubPendingCashOrder {
  id: string;
  status: 'PLACED' | 'PREPARING' | 'READY';
  totalAmount: number;
  paymentMethod: 'CASH';
}

/** A non-financial Cashier handover task. Native code has already verified
 * `READY` and `CAPTURED`; React may only request the final transition. */
export interface NativeHubReadyForCollectionOrder {
  id: string;
  status: 'READY';
}

/** A bounded, non-financial Manager task for the already-authorized pending
 * order cancellation transitions. */
export interface NativeHubCancellableOrder {
  id: string;
  status: 'PLACED' | 'PREPARING';
}

/** Bounded, non-financial local ticket data for an authenticated native
 * Kitchen session. It is a rendered projection, never command authority. */
export interface NativeHubKitchenOrderLine {
  productId: string;
  name: string;
  quantity: number;
}

export interface NativeHubKitchenOrder {
  id: string;
  status: 'PLACED' | 'PREPARING';
  items: NativeHubKitchenOrderLine[];
}

/** A non-secret native task request which was reserved before signing but has
 * no receipt yet. It may only be retried or explicitly abandoned by the
 * current native staff session. */
export interface NativeHubRecoverableCommand extends NativeHubCommandRequest {}

/** Non-secret signed configuration data for a native station UI. */
export interface NativeHubOperatorContext {
  staffName: string;
  role: 'CASHIER' | 'KITCHEN_STAFF' | 'MANAGER' | 'OWNER' | 'ADMINISTRATOR';
  vat: { enabled: boolean; rate: number };
  catalogProducts: NativeHubCatalogProduct[];
  inventoryProducts: NativeHubInventoryProduct[];
  activeCashShift: NativeHubCashShift | null;
  pendingCashOrders: NativeHubPendingCashOrder[];
  readyForCollectionOrders: NativeHubReadyForCollectionOrder[];
  cancellableOrders: NativeHubCancellableOrder[];
  pendingKitchenOrders: NativeHubKitchenOrder[];
  recoverableNativeCommands: NativeHubRecoverableCommand[];
}

export class NativeHubCapabilityError extends Error {
  public readonly code = 'NATIVE_HUB_REQUIRED';

  constructor(message = 'This operation requires the authenticated Android-native Cashier Hub.') {
    super(message);
    this.name = 'NativeHubCapabilityError';
  }
}

export interface NativeHubBridge {
  getSnapshot(): Promise<HubSnapshot>;
  refresh(): Promise<HubSnapshot>;
  discoverDevices(): Promise<DeviceNode[]>;
  registerDevice(request: DeviceRegistrationRequest): Promise<DeviceNode>;
  revokeDevice(deviceId: string): Promise<void>;
  openNativeEnrollment(): Promise<void>;
  openNativeTerminalEnrollment(): Promise<void>;
  openNativeTerminalLocalLink(): Promise<void>;
  openNativeStaffSignIn(): Promise<void>;
  openNativeStaffCredentialReset(): Promise<void>;
  endNativeStaffSession(): Promise<boolean>;
  getNativeOperatorContext(): Promise<NativeHubOperatorContext>;
  submitNativeCommandRequest(request: NativeHubCommandRequest): Promise<NativeHubCommandReceipt>;
  discardNativeCommandRequest(commandId: string): Promise<boolean>;
  subscribe(listener: (snapshot: HubSnapshot) => void): Promise<() => void | Promise<void>>;
}

export const unavailableHubSnapshot = (message: string): HubSnapshot => ({
  devices: [],
  networkHealth: {
    mode: 'NATIVE_HUB_REQUIRED',
    availability: 'UNAVAILABLE',
    localPeerCount: 0,
    packetLossRate: null,
    latencyMs: null,
    outboxDepth: 0,
    inboxDepth: 0,
    lastSyncTimestamp: null,
    cloudConnected: false,
    cloudStatus: 'UNKNOWN',
    activeTransport: 'UNAVAILABLE',
    message
  },
  failures: [],
  transportMetrics: [],
  outbox: [],
  inbox: []
});

type CapacitorListenerHandle = { remove: () => void | Promise<void> };

interface CapacitorLocalHubPlugin {
  getSnapshot: () => Promise<HubSnapshot>;
  refresh?: () => Promise<HubSnapshot>;
  discoverDevices: () => Promise<{ devices: DeviceNode[] }>;
  registerDevice: (request: DeviceRegistrationRequest) => Promise<{ device: DeviceNode }>;
  revokeDevice: (request: { deviceId: string }) => Promise<void>;
  openNativeEnrollment?: () => Promise<{ opened: boolean }>;
  openNativeTerminalEnrollment?: () => Promise<{ opened: boolean }>;
  openNativeTerminalLocalLink?: () => Promise<{ opened: boolean }>;
  openNativeStaffSignIn?: () => Promise<{ opened: boolean }>;
  openNativeStaffCredentialReset?: () => Promise<{ opened: boolean }>;
  endNativeStaffSession?: () => Promise<{ ended: boolean }>;
  getNativeOperatorContext?: () => Promise<NativeHubOperatorContext>;
  submitNativeCommandRequest?: (request: NativeHubCommandRequest) => Promise<NativeHubCommandReceipt>;
  discardNativeCommandRequest?: (request: { commandId: string }) => Promise<{ discarded: boolean }>;
  addListener?: (eventName: 'hubStateChanged', listener: (snapshot: HubSnapshot) => void) => Promise<CapacitorListenerHandle> | CapacitorListenerHandle;
}

function getCapacitorPlugin(): CapacitorLocalHubPlugin | null {
  const runtime = globalThis as typeof globalThis & {
    Capacitor?: { Plugins?: Record<string, unknown> };
  };
  const candidate = runtime.Capacitor?.Plugins?.ThePlugOSLocalHub as Partial<CapacitorLocalHubPlugin> | undefined;

  if (!candidate || typeof candidate.getSnapshot !== 'function' || typeof candidate.discoverDevices !== 'function' ||
    typeof candidate.registerDevice !== 'function' || typeof candidate.revokeDevice !== 'function') {
    return null;
  }

  return candidate as CapacitorLocalHubPlugin;
}

/** True only when the installed Capacitor local-Hub capability is present.
 * This is a host capability check, not a browser-provided authority signal. */
export function hasNativeHubHost(): boolean {
  return getCapacitorPlugin() !== null;
}

class UnavailableNativeHubBridge implements NativeHubBridge {
  private readonly snapshot: HubSnapshot;

  constructor() {
    this.snapshot = unavailableHubSnapshot(
      'No authenticated Android-native Cashier Hub is attached to this application build. Browser tabs cannot act as a local operational hub.'
    );
  }

  async getSnapshot(): Promise<HubSnapshot> {
    return this.snapshot;
  }

  async refresh(): Promise<HubSnapshot> {
    return this.snapshot;
  }

  async discoverDevices(): Promise<DeviceNode[]> {
    throw new NativeHubCapabilityError();
  }

  async registerDevice(_: DeviceRegistrationRequest): Promise<DeviceNode> {
    throw new NativeHubCapabilityError();
  }

  async revokeDevice(_: string): Promise<void> {
    throw new NativeHubCapabilityError();
  }

  async openNativeEnrollment(): Promise<void> {
    throw new NativeHubCapabilityError('Native Cashier Hub enrollment is unavailable in this browser build.');
  }

  async openNativeTerminalEnrollment(): Promise<void> {
    throw new NativeHubCapabilityError('Native branch-terminal enrollment is unavailable in this browser build.');
  }

  async openNativeTerminalLocalLink(): Promise<void> {
    throw new NativeHubCapabilityError('Native terminal local-link status is unavailable in this browser build.');
  }

  async openNativeStaffSignIn(): Promise<void> {
    throw new NativeHubCapabilityError('Native staff sign-in is unavailable in this browser build.');
  }

  async openNativeStaffCredentialReset(): Promise<void> {
    throw new NativeHubCapabilityError('Native staff credential reset is unavailable in this browser build.');
  }

  async endNativeStaffSession(): Promise<boolean> {
    throw new NativeHubCapabilityError('Native staff-session end is unavailable in this browser build.');
  }

  async getNativeOperatorContext(): Promise<NativeHubOperatorContext> {
    throw new NativeHubCapabilityError('Native operator context is unavailable in this browser build.');
  }

  async submitNativeCommandRequest(_: NativeHubCommandRequest): Promise<NativeHubCommandReceipt> {
    throw new NativeHubCapabilityError('Native operational command submission is unavailable in this browser build.');
  }

  async discardNativeCommandRequest(_: string): Promise<boolean> {
    throw new NativeHubCapabilityError('Native operational command recovery is unavailable in this browser build.');
  }

  async subscribe(_: (snapshot: HubSnapshot) => void): Promise<() => void | Promise<void>> {
    return () => undefined;
  }
}

class CapacitorNativeHubBridge implements NativeHubBridge {
  private readonly plugin: CapacitorLocalHubPlugin;

  constructor(plugin: CapacitorLocalHubPlugin) {
    this.plugin = plugin;
  }

  async getSnapshot(): Promise<HubSnapshot> {
    return this.plugin.getSnapshot();
  }

  async refresh(): Promise<HubSnapshot> {
    return this.plugin.refresh ? this.plugin.refresh() : this.plugin.getSnapshot();
  }

  async discoverDevices(): Promise<DeviceNode[]> {
    const response = await this.plugin.discoverDevices();
    return response.devices;
  }

  async registerDevice(request: DeviceRegistrationRequest): Promise<DeviceNode> {
    const response = await this.plugin.registerDevice(request);
    return response.device;
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.plugin.revokeDevice({ deviceId });
  }

  async openNativeEnrollment(): Promise<void> {
    if (!this.plugin.openNativeEnrollment) {
      throw new NativeHubCapabilityError('This Android build does not include native Cashier Hub enrollment.');
    }
    const response = await this.plugin.openNativeEnrollment();
    if (!response?.opened) throw new NativeHubCapabilityError('The native Cashier Hub enrollment screen could not be opened.');
  }

  async openNativeTerminalEnrollment(): Promise<void> {
    if (!this.plugin.openNativeTerminalEnrollment) {
      throw new NativeHubCapabilityError('This Android build does not include native branch-terminal enrollment.');
    }
    const response = await this.plugin.openNativeTerminalEnrollment();
    if (!response?.opened) throw new NativeHubCapabilityError('The native branch-terminal enrollment screen could not be opened.');
  }

  async openNativeTerminalLocalLink(): Promise<void> {
    if (!this.plugin.openNativeTerminalLocalLink) {
      throw new NativeHubCapabilityError('This Android build does not include terminal local-link status.');
    }
    const response = await this.plugin.openNativeTerminalLocalLink();
    if (!response?.opened) throw new NativeHubCapabilityError('The native terminal local-link screen could not be opened.');
  }

  async openNativeStaffSignIn(): Promise<void> {
    if (!this.plugin.openNativeStaffSignIn) {
      throw new NativeHubCapabilityError('This Android build does not include native staff sign-in.');
    }
    const response = await this.plugin.openNativeStaffSignIn();
    if (!response?.opened) throw new NativeHubCapabilityError('The native staff sign-in screen could not be opened.');
  }

  async openNativeStaffCredentialReset(): Promise<void> {
    if (!this.plugin.openNativeStaffCredentialReset) {
      throw new NativeHubCapabilityError('This Android build does not include native staff credential reset.');
    }
    const response = await this.plugin.openNativeStaffCredentialReset();
    if (!response?.opened) throw new NativeHubCapabilityError('The native staff credential-reset screen could not be opened.');
  }

  async endNativeStaffSession(): Promise<boolean> {
    if (!this.plugin.endNativeStaffSession) {
      throw new NativeHubCapabilityError('This Android build does not include native staff-session end.');
    }
    const response = await this.plugin.endNativeStaffSession();
    if (typeof response?.ended !== 'boolean') {
      throw new NativeHubCapabilityError('The native Hub returned an invalid staff-session end response.');
    }
    return response.ended;
  }

  async getNativeOperatorContext(): Promise<NativeHubOperatorContext> {
    if (!this.plugin.getNativeOperatorContext) {
      throw new NativeHubCapabilityError('This Android build does not include a native operator context bridge.');
    }
    return this.plugin.getNativeOperatorContext();
  }

  async submitNativeCommandRequest(request: NativeHubCommandRequest): Promise<NativeHubCommandReceipt> {
    if (!this.plugin.submitNativeCommandRequest) {
      throw new NativeHubCapabilityError('This Android build does not include native operational command submission.');
    }
    return this.plugin.submitNativeCommandRequest(request);
  }

  async discardNativeCommandRequest(commandId: string): Promise<boolean> {
    if (!this.plugin.discardNativeCommandRequest) {
      throw new NativeHubCapabilityError('This Android build does not include native operational command recovery.');
    }
    const response = await this.plugin.discardNativeCommandRequest({ commandId });
    if (typeof response?.discarded !== 'boolean') {
      throw new NativeHubCapabilityError('The native Hub returned an invalid command-recovery response.');
    }
    return response.discarded;
  }

  async subscribe(listener: (snapshot: HubSnapshot) => void): Promise<() => void | Promise<void>> {
    if (!this.plugin.addListener) return () => undefined;
    const handle = await this.plugin.addListener('hubStateChanged', listener);
    return () => handle.remove();
  }
}

/**
 * Resolves the sole supported local-operation transport. This is intentionally
 * capability-based: a normal browser build receives an explicit unavailable
 * result rather than a simulated mesh, certificate authority, or cloud queue.
 */
export function resolveNativeHubBridge(): NativeHubBridge {
  const plugin = getCapacitorPlugin();
  return plugin ? new CapacitorNativeHubBridge(plugin) : new UnavailableNativeHubBridge();
}
