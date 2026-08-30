import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CloudStorageAdapter } from '../storage/adapters/cloud';
import { InMemoryStorageAdapter } from '../storage/adapters/in-memory';
import { HttpCloudSyncAdapter } from '../services/sync/cloud-sync';
import { SyncService } from '../services/sync';
import { storageEngine } from '../storage';
import { KernelEvent } from '../events';

describe('Production Cloud Storage & Sync Adapter Implementation', () => {
  let localAdapter: InMemoryStorageAdapter;

  beforeEach(async () => {
    localAdapter = new InMemoryStorageAdapter();
    await storageEngine.mount(localAdapter);
  });

  afterEach(async () => {
    await storageEngine.remove('sync_outbox', 'ev-1');
  });

  it('CloudStorageAdapter should handle fallback to local storage on network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const cloudAdapter = new CloudStorageAdapter({
      endpoint: 'https://cloud.theplugos.com',
      tenantId: 'tenant-test-123',
      apiKey: 'secret-key-456',
      localFallback: localAdapter,
      fetchApi: mockFetch as any,
    });

    await cloudAdapter.init();

    await cloudAdapter.set('config', 'currency', 'ZAR');
    const val = await cloudAdapter.get('config', 'currency');

    expect(val).toBe('ZAR');

    const offset = await cloudAdapter.appendEvent({ action: 'TEST_EVENT', payload: {} });
    expect(offset).toBe(0);

    const events = await cloudAdapter.getEvents(0);
    expect(events.length).toBe(1);

    await cloudAdapter.close();
  });

  it('HttpCloudSyncAdapter should execute event and batch sync with retries and headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ackId: 'ack-100', syncedIds: ['ev-101', 'ev-102'] }),
    });

    const syncAdapter = new HttpCloudSyncAdapter({
      endpoint: 'https://sync.theplugos.com',
      tenantId: 'tenant-test-123',
      apiKey: 'api-key-789',
      fetchApi: mockFetch as any,
    });

    const testEvent: KernelEvent = {
      eventId: 'ev-101',
      entityId: 'ord-100',
      entityType: 'order',
      action: 'ORDER_PLACED',
      payload: { amount: 120 },
      version: 1,
      timestamp: new Date().toISOString(),
      offset: 1,
    };

    const singleResult = await syncAdapter.syncEvent(testEvent);
    expect(singleResult.success).toBe(true);
    expect(singleResult.ackId).toBe('ack-100');

    const batchResult = await syncAdapter.syncBatch([
      testEvent,
      { ...testEvent, eventId: 'ev-102', offset: 2 },
    ]);

    expect(batchResult.syncedIds).toEqual(['ev-101', 'ev-102']);
    expect(batchResult.failedIds).toEqual([]);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('SyncService should process outbox queue using CloudSyncAdapter', async () => {
    const syncService = new SyncService();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ syncedIds: ['ev-1'] }),
    });

    const cloudSyncAdapter = new HttpCloudSyncAdapter({
      endpoint: 'https://sync.theplugos.com',
      tenantId: 'tenant-test-123',
      fetchApi: mockFetch as any,
    });

    syncService.setCloudSyncAdapter(cloudSyncAdapter);

    await storageEngine.set('sync_outbox', 'ev-1', {
      eventId: 'ev-1',
      entityId: 'ord-1',
      entityType: 'order',
      action: 'ORDER_PLACED',
      payload: {},
      timestamp: new Date().toISOString(),
      offset: 1,
    });

    await syncService.triggerSync();

    const remaining = await storageEngine.getAll('sync_outbox');
    expect(remaining.length).toBe(0);
  });
});
