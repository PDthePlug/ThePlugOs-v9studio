import { describe, it, expect, beforeEach } from 'vitest';
import { sdk, IStorageAdapter } from '../index';
import { InMemoryStorageAdapter } from '@plugos/core/storage/adapters/in-memory';

describe('Phase 3 Sprint 1 - Platform SDK', () => {
  beforeEach(async () => {
    // We mock the Boot options
    await sdk.boot({
      storageAdapter: new InMemoryStorageAdapter()
    });
  });

  it('should initialize and proxy events correctly', async () => {
    let received = false;
    sdk.events.subscribe('SDK_TEST_EVENT', async (evt) => {
      expect(evt.payload.hello).toBe('world');
      received = true;
    });

    await sdk.events.publish('test-1', 'sdk', 'SDK_TEST_EVENT', { hello: 'world' });
    expect(received).toBe(true);
  });

  it('should proxy auth correctly', async () => {
    await sdk.auth.authenticate('test-token');
    const user = await sdk.auth.getUser();
    expect(user).toBeDefined();
    expect(user!.userId).toBe('user_test-token');
  });

  it('should expose system metrics without claiming a browser has native Hub authority', async () => {
    await sdk.system.metrics.increment('test_metric', 5);
    const health = await sdk.system.health();
    // Storage is mounted by sdk.boot, while a browser must report the missing
    // Android Hub capability as degraded instead of fabricating local authority.
    expect(health.status).toBe('DEGRADED');
    expect(health.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: 'StorageEngine', status: 'HEALTHY' }),
      expect.objectContaining({ component: 'LocalHubRuntime', status: 'DEGRADED' }),
    ]));
  });
});
