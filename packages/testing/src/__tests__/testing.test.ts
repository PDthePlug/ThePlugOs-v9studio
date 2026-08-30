import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestingEnvironment } from '../index';
import { stateEngine, eventEngine } from '@plugos/core';

describe('TestingEnvironment', () => {
  const env = createTestingEnvironment();

  beforeEach(async () => {
    eventEngine['subscribers'].clear();
    eventEngine.subscribe('*', async (event: any) => {
      await stateEngine['processEvent'](event);
    });
    
    stateEngine.registerReducer('test-entity', (state, event) => {
      const s = state || { val: 0 };
      if (event.action === 'UPDATE') s.val += event.payload.val;
      return s;
    });

    await env.setup();
  });

  afterEach(async () => {
    await env.teardown();
  });

  it('should process events and update state in memory', async () => {
    await env.publishEvent('test-1', 'test-entity', 'UPDATE', { val: 10 });
    
    const state = await env.getState<{ val: number }>('test-entity', 'test-1');
    expect(state).toBeDefined();
    expect(state?.val).toBe(10);
  });
});
