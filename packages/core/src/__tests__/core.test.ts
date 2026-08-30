import { describe, it, expect, beforeEach } from 'vitest';
import { runtime } from '../runtime';
import { InMemoryStorageAdapter } from '../storage/adapters/in-memory';
import { eventEngine } from '../events';
import { stateEngine } from '../state';
import { healthEngine } from '../observability/health';
import { storageEngine } from '../storage';

describe('Platform Core - Kernel Verification', () => {
  beforeEach(async () => {
    // Reset engines
    await storageEngine['adapter']?.close();
    // Only clear non-wildcard subscribers, or manually re-register the wildcard for stateEngine
    eventEngine['subscribers'].clear();
    stateEngine['reducers'].clear();
    // Re-register StateEngine's subscriber
    eventEngine.subscribe('*', async (event) => {
      await stateEngine['processEvent'](event);
    });
  });

  it('should boot storage and report an unavailable native Hub truthfully in a browser runtime', async () => {
    const adapter = new InMemoryStorageAdapter();
    await runtime.boot({ storageAdapter: adapter });
    const health = await healthEngine.evaluateSystemHealth();
    expect(health.status).toBe('DEGRADED');
    expect(health.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: 'StorageEngine', status: 'HEALTHY' }),
      expect.objectContaining({ component: 'LocalHubRuntime', status: 'DEGRADED' }),
    ]));
  });

  it('should process events and project state deterministically', async () => {
    const adapter = new InMemoryStorageAdapter();
    
    // Register reducer before boot to catch replay/events
    stateEngine.registerReducer('cart', (state, event) => {
      const s = state || { id: event.entityId, items: [] };
      if (event.action === 'ITEM_ADDED') {
        s.items.push(event.payload.item);
      }
      return s;
    });

    await runtime.boot({ storageAdapter: adapter });

    // Publish events
    await eventEngine.publish('cart_999', 'cart', 'ITEM_ADDED', { item: 'Base_Kota' });
    await eventEngine.publish('cart_999', 'cart', 'ITEM_ADDED', { item: 'Drink_Coke' });

    // Query projected state
    const cartState = await stateEngine.query('cart', 'cart_999');
    
    expect(cartState).toBeDefined();
    expect(cartState.id).toBe('cart_999');
    expect(cartState.items).toEqual(['Base_Kota', 'Drink_Coke']);
  });
});
