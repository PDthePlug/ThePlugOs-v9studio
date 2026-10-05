import { describe, it, expect, beforeEach } from 'vitest';
import { rulesService } from '../services/rules';
import { workflowService } from '../services/workflows';
import { stateEngine } from '../state';
import { storageEngine } from '../storage';
import { eventEngine } from '../events';
import { InMemoryStorageAdapter } from '../storage/adapters/in-memory';
import { securityEngine } from '../security';

describe('Phase 2 Sprint 2 - Rules & Workflows', () => {
  beforeEach(async () => {
    await storageEngine.mount(new InMemoryStorageAdapter());
    rulesService['rules'].clear();
    workflowService['workflows'].clear();
    stateEngine['reducers'].clear();
    
    // Setup state reducer for workflow test
    stateEngine.registerReducer('order', (state, event) => {
      const s = state || { id: event.entityId, status: 'PENDING' };
      if (event.payload && event.payload._newState) {
        s.status = event.payload._newState;
      }
      return s;
    });
    
    // Re-register wildcard
    eventEngine.subscribe('*', async (event) => {
      await stateEngine['processEvent'](event);
    });
  });

  it('RulesService should evaluate JSONLogic deterministically', () => {
    rulesService.registerRules('fastfood', [
      {
        id: 'rule-discount',
        name: 'Combo Discount',
        description: '10% off if order contains Kota and Coke',
        condition: {
          and: [
            { in: ['Base_Kota', { var: 'items' }] },
            { in: ['Drink_Coke', { var: 'items' }] }
          ]
        },
        result: {
          '*': [{ var: 'total' }, 0.9]
        }
      }
    ]);

    const contextMatch = { items: ['Base_Kota', 'Drink_Coke'], total: 100 };
    const results = rulesService.evaluate('fastfood', contextMatch);
    
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe(90);

    const contextNoMatch = { items: ['Base_Kota', 'Drink_Sprite'], total: 100 };
    const resultsNoMatch = rulesService.evaluate('fastfood', contextNoMatch);
    expect(resultsNoMatch).toHaveLength(0);
  });

  it('WorkflowService should enforce valid transitions', async () => {
    workflowService.registerWorkflow({
      id: 'wf-order',
      name: 'Order Lifecycle',
      entityType: 'order',
      initialState: 'PENDING',
      transitions: [
        { from: 'PENDING', to: 'PREPARING', action: 'START_PREP' },
        { from: 'PREPARING', to: 'READY', action: 'MARK_READY' }
      ]
    });

    // Valid transition
    await workflowService.transition('ord-1', 'order', 'START_PREP');
    
    const state = await stateEngine.query('order', 'ord-1');
    expect(state.status).toBe('PREPARING');

    // Invalid transition
    await expect(workflowService.transition('ord-1', 'order', 'START_PREP')).rejects.toThrow(/Invalid transition/);
  });
});
