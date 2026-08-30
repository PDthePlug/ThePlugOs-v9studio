import { runtime } from './runtime';
import { InMemoryStorageAdapter } from './storage/adapters/in-memory';
import { eventEngine } from './events';
import { stateEngine } from './state';
import { healthEngine } from './observability/health';

async function run() {
  const adapter = new InMemoryStorageAdapter();
  
  // Register a simple state reducer before boot so it processes replay
  stateEngine.registerReducer('cart', (state, event) => {
    const s = state || { id: event.entityId, items: [] };
    if (event.action === 'ITEM_ADDED') {
      s.items.push(event.payload.item);
    }
    return s;
  });

  await runtime.boot({ storageAdapter: adapter });

  console.log('\n--- Simulating Domain Activity ---');
  await eventEngine.publish('cart_123', 'cart', 'ITEM_ADDED', { item: 'Base_Kota' });
  await eventEngine.publish('cart_123', 'cart', 'ITEM_ADDED', { item: 'Drink_Coke' });

  const cartState = await stateEngine.query('cart', 'cart_123');
  console.log('\nProjected State for cart_123:', JSON.stringify(cartState, null, 2));

  console.log('\n--- Checking System Health ---');
  const health = await healthEngine.evaluateSystemHealth();
  console.log('Health:', JSON.stringify(health, null, 2));
}

run().catch(console.error);
