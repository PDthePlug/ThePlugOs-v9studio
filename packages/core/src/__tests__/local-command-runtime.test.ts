import { describe, expect, it } from 'vitest';
import {
  AuthorizedHubCommandContext,
  CommandAuthorizer,
  CommandEventFactory,
  CommandProjector,
  HubCommand,
  HubCommandRejectedError,
  HubIdFactory,
  InMemoryTransactionalHubStore,
  LocalCommandRuntime
} from '../operations';

const context: AuthorizedHubCommandContext = {
  businessId: 'business-a',
  branchId: 'branch-a',
  deviceId: 'terminal-a',
  staffId: 'staff-a',
  staffSessionId: 'session-a',
  role: 'CASHIER',
  authorizationBundleId: 'bundle-a',
  revocationVersion: 7
};

const command = (payload: unknown = { orderId: 'order-a' }): HubCommand => ({
  commandId: 'command-a',
  type: 'order.create',
  issuedAt: '2026-08-15T10:00:00.000Z',
  deviceId: 'terminal-a',
  staffSessionId: 'session-a',
  sequence: 1,
  payload,
  signature: 'verified-by-native-adapter'
});

class StableIds implements HubIdFactory {
  private index = 0;

  create(prefix: string): string {
    this.index += 1;
    return `${prefix}-${this.index}`;
  }
}

function runtime(store = new InMemoryTransactionalHubStore(), authorizer?: CommandAuthorizer, projector?: CommandProjector) {
  const eventFactory: CommandEventFactory = {
    async createEvents(submitted) {
      return [{
        entityId: (submitted.payload as { orderId: string }).orderId,
        entityType: 'order',
        action: 'ORDER_PLACED',
        payload: submitted.payload
      }];
    }
  };
  return {
    store,
    runtime: new LocalCommandRuntime(
      store,
      authorizer || { async authorize() { return context; } },
      eventFactory,
      projector || { async project() { return []; } },
      new StableIds(),
      { now: () => '2026-08-15T10:00:01.000Z' }
    )
  };
}

describe('LocalCommandRuntime', () => {
  it('commits one business effect and returns the original receipt on a valid retry', async () => {
    const { runtime: local, store } = runtime();

    const applied = await local.execute(command());
    const retried = await local.execute(command());
    const state = store.inspect();

    expect(applied.outcome).toBe('APPLIED');
    expect(retried.outcome).toBe('DUPLICATE');
    expect(retried.eventIds).toEqual(applied.eventIds);
    expect(state.receipts).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.outbox).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
  });

  it('rejects a reused command ID whose signed business input differs', async () => {
    const { runtime: local, store } = runtime();
    await local.execute(command());

    await expect(local.execute(command({ orderId: 'order-b' }))).rejects.toBeInstanceOf(HubCommandRejectedError);
    expect(store.inspect().events).toHaveLength(1);
  });

  it('does not expose a committed receipt to an unauthorized caller', async () => {
    const store = new InMemoryTransactionalHubStore();
    const { runtime: accepted } = runtime(store);
    await accepted.execute(command());

    const { runtime: denied } = runtime(store, {
      async authorize() {
        throw new HubCommandRejectedError('The session has been revoked.');
      }
    });

    await expect(denied.execute(command())).rejects.toThrow('revoked');
  });

  it('rolls back event, projection, audit, outbox, and receipt writes when projection fails', async () => {
    const store = new InMemoryTransactionalHubStore();
    const { runtime: local } = runtime(store, undefined, {
      async project() {
        throw new HubCommandRejectedError('Projection invariant failed.');
      }
    });

    await expect(local.execute(command())).rejects.toThrow('Projection invariant failed');
    const state = store.inspect();
    expect(state.receipts).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
  });
});
