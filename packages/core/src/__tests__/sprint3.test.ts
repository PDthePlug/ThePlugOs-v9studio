import { describe, it, expect, beforeEach } from 'vitest';
import { syncService } from '../services/sync';
import { eventEngine } from '../events';
import { storageEngine } from '../storage';
import { InMemoryStorageAdapter } from '../storage/adapters/in-memory';

describe('Phase 2 Sprint 3 - Synchronization Service', () => {
  beforeEach(async () => {
    await storageEngine.mount(new InMemoryStorageAdapter());
    eventEngine['subscribers'].clear();
    // re-register sync service 
    await syncService.boot();
  });

  it('should retain events when online without a real cloud acknowledgement adapter', async () => {
    syncService.setNetworkStatus(true);
    
    // Simulate event publishing
    await eventEngine.publish('ord-1', 'order', 'CREATE', { items: [] });
    
    // A transport link is not an acknowledgement. The source must not emulate
    // delivery when no receiver has been configured.
    await new Promise(r => setTimeout(r, 50));

    const outbox = await storageEngine.getAll(syncService['OUTBOX_COLLECTION']);
    expect(outbox).toHaveLength(1);
  });

  it('should queue but not sync when offline', async () => {
    syncService.setNetworkStatus(false);
    
    await eventEngine.publish('ord-2', 'order', 'CREATE', { items: [] });
    
    await new Promise(r => setTimeout(r, 50));

    const outbox = await storageEngine.getAll(syncService['OUTBOX_COLLECTION']);
    expect(outbox).toHaveLength(1); // Still queued
  });

  it('should retain a queue upon reconnection until a real receiver acknowledges it', async () => {
    syncService.setNetworkStatus(false);
    await eventEngine.publish('ord-3', 'order', 'CREATE', { items: [] });
    
    let outbox = await storageEngine.getAll(syncService['OUTBOX_COLLECTION']);
    expect(outbox).toHaveLength(1);

    syncService.setNetworkStatus(true); // Tries the receiver path, but none exists.
    await new Promise(r => setTimeout(r, 50));

    outbox = await storageEngine.getAll(syncService['OUTBOX_COLLECTION']);
    expect(outbox).toHaveLength(1);
  });
});
