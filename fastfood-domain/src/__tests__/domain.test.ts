import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestingEnvironment } from '@plugos/testing';
import { reducers } from '../index';
import { stateEngine } from '@plugos/core';

describe('FastFood Domain Simulation', () => {
  const env = createTestingEnvironment();

  beforeEach(async () => {
    stateEngine.registerReducer('order', reducers.order);
    stateEngine.registerReducer('inventory', reducers.inventory);
    await env.setup();
  });

  afterEach(async () => {
    await env.teardown();
  });

  it('should project order lifecycle correctly', async () => {
    await env.publishEvent('ord-1', 'order', 'ORDER_PLACED', { items: ['burger'], total: 10 });
    
    let order = await env.getState<any>('order', 'ord-1');
    expect(order.status).toBe('PENDING');

    await env.publishEvent('ord-1', 'order', 'PAYMENT_RECEIVED', {});
    order = await env.getState<any>('order', 'ord-1');
    expect(order.status).toBe('PREP');
    
    await env.publishEvent('ord-1', 'order', 'ORDER_PREPARED', {});
    order = await env.getState<any>('order', 'ord-1');
    expect(order.status).toBe('READY');
  });

  it('should deplete inventory correctly', async () => {
    await env.publishEvent('inv-1', 'inventory', 'INVENTORY_DEPLETED', { quantity: 2 });
    
    const inventory = await env.getState<any>('inventory', 'inv-1');
    expect(inventory.quantity).toBe(98);
  });
});
