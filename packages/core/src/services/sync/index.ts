import { createLogger } from '../../observability/logger';
import { storageEngine } from '../../storage';
import { KernelEvent, eventEngine } from '../../events';
import { ICloudSyncAdapter } from './cloud-sync';

export * from './cloud-sync';

const log = createLogger('SyncService');

export class SyncService {
  private readonly OUTBOX_COLLECTION = 'sync_outbox';
  private isSyncing = false;
  private isOnline = true; // Assume online until told otherwise
  private cloudAdapter: ICloudSyncAdapter | null = null;

  public setCloudSyncAdapter(adapter: ICloudSyncAdapter | null) {
    this.cloudAdapter = adapter;
    log.info(adapter ? 'CloudSyncAdapter registered' : 'CloudSyncAdapter removed');
  }

  public async boot(): Promise<void> {
    log.info('SyncService booting. Subscribing to Event Engine.');
    
    // Subscribe to all events to populate the Outbox
    eventEngine.subscribe('*', async (event: KernelEvent) => {
      await this.addToOutbox(event);
    });

    // Start background sync loop
    this.triggerSync();
  }

  public setNetworkStatus(online: boolean) {
    if (this.isOnline !== online) {
      this.isOnline = online;
      log.info(`Network status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
      if (online) {
        this.triggerSync();
      }
    }
  }

  private async addToOutbox(event: KernelEvent): Promise<void> {
    // Only queue events that need cloud sync. 
    // In a real system, ephemeral events might be skipped.
    if (event.action.startsWith('LOCAL_')) return;

    await storageEngine.set(this.OUTBOX_COLLECTION, event.eventId, event);
    log.debug(`Event ${event.eventId} added to outbox`);
    
    this.triggerSync();
  }

  public async triggerSync(): Promise<void> {
    if (!this.isOnline || this.isSyncing) return;

    this.isSyncing = true;
    try {
      await this.processOutbox();
    } catch (err: any) {
      log.error('Sync failure', { error: err.message });
    } finally {
      this.isSyncing = false;
    }
  }

  private async processOutbox(): Promise<void> {
    log.debug('Processing outbox queue...');
    
    const events = await storageEngine.getAll(this.OUTBOX_COLLECTION);
    if (events.length === 0) return;
    
    // Sort by offset/timestamp to ensure topological ordering
    const sortedEvents = events.sort((a, b) => (a.offset || 0) - (b.offset || 0));

    if (this.cloudAdapter) {
      log.info(`Processing outbox using CloudSyncAdapter (${sortedEvents.length} events)`);
      const batchResult = await this.cloudAdapter.syncBatch(sortedEvents);
      for (const syncedId of batchResult.syncedIds) {
        await storageEngine.remove(this.OUTBOX_COLLECTION, syncedId);
        log.debug(`Event ${syncedId} synced and removed from outbox.`);
      }
      return;
    }

    // DIRECTIVE R001: QUARANTINE FAKE INFRASTRUCTURE
    // If there is no cloud adapter, do NOT simulate success and do NOT remove from outbox.
    log.error('No CloudSyncAdapter configured. Events will remain in the outbox until a real adapter is provided.');
    return;
  }
}

export const syncService = new SyncService();
