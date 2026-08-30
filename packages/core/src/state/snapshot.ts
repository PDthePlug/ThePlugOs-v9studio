import { storageEngine } from '../storage';
import { createLogger } from '../observability/logger';

const log = createLogger('SnapshotService');

export class SnapshotService {
  private readonly SNAPSHOT_COLLECTION = 'state_snapshots';

  public async saveSnapshot(entityType: string, entityId: string, state: any, offset: number): Promise<void> {
    const snapshot = { state, offset };
    await storageEngine.set(this.SNAPSHOT_COLLECTION, `${entityType}#${entityId}`, snapshot);
    log.debug(`Saved snapshot for ${entityType}#${entityId} at offset ${offset}`);
  }

  public async getSnapshot(entityType: string, entityId: string): Promise<{ state: any; offset: number } | null> {
    const snapshot = await storageEngine.get(this.SNAPSHOT_COLLECTION, `${entityType}#${entityId}`);
    return snapshot || null;
  }
}

export const snapshotService = new SnapshotService();
