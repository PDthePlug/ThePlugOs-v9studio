/**
 * @deprecated Legacy browser pairing store is quarantined.
 * The authoritative pairing registry is implemented by the Android-native Hub
 * and its staged cloud API; neither browser storage nor raw tables may stand in.
 */
export interface PairingCodeRecord {
  id?: string;
  pairing_code: string;
  code?: string;
  business_id: string;
  branch_id: string;
  created_by: string;
  created_at?: string;
  expires_at: string;
  used_at?: string | null;
  status: 'WAITING' | 'USED' | 'EXPIRED' | 'REVOKED';
}

export class LegacyPairingStoreRetiredError extends Error {
  constructor() {
    super('Legacy pairing storage is retired. Use the authenticated Android-native Cashier Hub.');
    this.name = 'LegacyPairingStoreRetiredError';
  }
}

export class PairingRepository {
  async save(_: PairingCodeRecord): Promise<void> {
    throw new LegacyPairingStoreRetiredError();
  }

  async getByCode(_: string): Promise<PairingCodeRecord | null> {
    return null;
  }

  async getActiveByBranch(_: string): Promise<PairingCodeRecord | null> {
    return null;
  }

  async cancelBranchCodes(_: string): Promise<void> {
    throw new LegacyPairingStoreRetiredError();
  }

  async updateStatus(_: string, __: PairingCodeRecord['status'], ___?: string): Promise<void> {
    throw new LegacyPairingStoreRetiredError();
  }
}

export const pairingRepository = new PairingRepository();
