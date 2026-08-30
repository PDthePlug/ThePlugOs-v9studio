import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestingEnvironment } from '@plugos/testing';
import { reducers } from '../index';
import { stateEngine } from '@plugos/core';

describe('Pharmacy Domain Simulation', () => {
  const env = createTestingEnvironment();

  beforeEach(async () => {
    stateEngine.registerReducer('prescription', reducers.prescription);
    stateEngine.registerReducer('inventory', reducers.inventory);
    await env.setup();
  });

  afterEach(async () => {
    await env.teardown();
  });

  it('should project prescription lifecycle correctly', async () => {
    await env.publishEvent('rx-1', 'prescription', 'PRESCRIPTION_RECEIVED', { medication: 'Amoxicillin', dosage: '500mg', patientId: 'p-1' });
    
    let rx = await env.getState<any>('prescription', 'rx-1');
    expect(rx.status).toBe('APPROVED');
    expect(rx.medication).toBe('Amoxicillin');

    await env.publishEvent('rx-1', 'prescription', 'MEDICATION_DISPENSED', {});
    rx = await env.getState<any>('prescription', 'rx-1');
    expect(rx.status).toBe('FULFILLED');
  });
});
