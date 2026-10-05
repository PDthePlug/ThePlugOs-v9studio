import { sdk } from '@plugos/sdk';
import type { DeviceNode } from '@plugos/core';

export interface DeviceRecord {
  device_id: string;
  business_id: string;
  branch_id: string;
  device_name: string;
  device_type: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | string;
  status: 'ACTIVE' | 'DISABLED';
  last_seen: string;
  certFingerprint?: string;
  connectionType?: string;
}

export class DeviceAuthorityUnavailableError extends Error {
  constructor(message = 'Device records are owned by the authenticated Android-native Cashier Hub.') {
    super(message);
    this.name = 'DeviceAuthorityUnavailableError';
  }
}

function mapDevice(node: DeviceNode): DeviceRecord {
  return {
    device_id: node.id,
    business_id: node.businessId || '',
    branch_id: node.branchId || '',
    device_name: node.name,
    device_type: node.role === 'KITCHEN_STAFF' ? 'KITCHEN' : node.role,
    status: node.status === 'REVOKED' ? 'DISABLED' : 'ACTIVE',
    last_seen: node.lastHeartbeat || '',
    certFingerprint: node.certFingerprint,
    connectionType: node.connectionType
  };
}

/**
 * A read-only view of the device registry reported by the native Hub.
 * Browser storage, the retired web API, and direct client table writes are
 * deliberately not device authorities.
 */
export class DeviceRepository {
  async save(_: DeviceRecord): Promise<void> {
    throw new DeviceAuthorityUnavailableError();
  }

  async getById(deviceId: string): Promise<DeviceRecord | null> {
    const device = sdk.hub.getDevices().find((candidate: DeviceNode) => candidate.id === deviceId);
    return device ? mapDevice(device) : null;
  }

  async getForBusiness(businessId: string): Promise<DeviceRecord[]> {
    return sdk.hub.getDevices()
      .filter((device: DeviceNode) => device.businessId === businessId)
      .map(mapDevice);
  }

  async updateStatus(deviceId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
    if (status !== 'DISABLED') {
      throw new DeviceAuthorityUnavailableError('Reactivation must be performed through a fresh native Hub authorization workflow.');
    }
    await sdk.hub.revokeDevice(deviceId);
  }

  async updateName(_: string, __: string): Promise<void> {
    throw new DeviceAuthorityUnavailableError('Device names are changed through the native Hub registry.');
  }

  async updateLastSeen(_: string): Promise<void> {
    throw new DeviceAuthorityUnavailableError('Heartbeat state is reported by the native Hub, not written by a browser.');
  }

  async remove(deviceId: string): Promise<void> {
    await sdk.hub.revokeDevice(deviceId);
  }

  async getAll(): Promise<DeviceRecord[]> {
    return sdk.hub.getDevices().map(mapDevice);
  }
}

export const deviceRepository = new DeviceRepository();
