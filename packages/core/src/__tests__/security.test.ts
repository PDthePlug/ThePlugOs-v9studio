import { describe, it, expect, beforeEach } from 'vitest';
import { securityEngine } from '../security';
import { storageEngine } from '../storage';
import { InMemoryStorageAdapter } from '../storage/adapters/in-memory';

describe('Platform Core - Security Services', () => {
  beforeEach(async () => {
    await storageEngine.mount(new InMemoryStorageAdapter());
    await securityEngine.identity.logout();
    securityEngine.permissions['rolePolicies'].clear();
  });

  it('should authenticate and store identity', async () => {
    const user = await securityEngine.identity.authenticate('test-token');
    expect(user.userId).toBe('user_test-token');
    
    const fetchedUser = await securityEngine.identity.getIdentity();
    expect(fetchedUser).toBeDefined();
    expect(fetchedUser!.userId).toBe('user_test-token');
  });

  it('should enforce role-based access control', async () => {
    // Register policies
    securityEngine.permissions.registerRolePolicies('CASHIER', [
      { action: 'CREATE_ORDER', resource: 'orders', effect: 'ALLOW' },
      { action: 'REFUND_ORDER', resource: 'orders', effect: 'DENY' }
    ]);
    securityEngine.permissions.registerRolePolicies('MANAGER', [
      { action: 'REFUND_ORDER', resource: 'orders', effect: 'ALLOW' }
    ]);

    // Authenticate as Cashier
    await securityEngine.identity.authenticate('cashier-token');
    // Force role for test
    securityEngine.identity['currentIdentity']!.roles = ['CASHIER'];

    // Cashier can create order
    await expect(securityEngine.enforce('CREATE_ORDER', 'orders')).resolves.toBeUndefined();
    
    // Cashier cannot refund order
    await expect(securityEngine.enforce('REFUND_ORDER', 'orders')).rejects.toThrow('Security Violation');

    // Authenticate as Manager
    await securityEngine.identity.authenticate('manager-token');
    securityEngine.identity['currentIdentity']!.roles = ['MANAGER'];

    // Manager can refund order
    await expect(securityEngine.enforce('REFUND_ORDER', 'orders')).resolves.toBeUndefined();
  });
});
