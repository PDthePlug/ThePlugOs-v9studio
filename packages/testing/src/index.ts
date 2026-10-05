import { InMemoryStorageAdapter } from '@plugos/core/storage/adapters/in-memory';
import { sdk } from '@plugos/sdk';

export class TestingEnvironment {
  public storage: InMemoryStorageAdapter;

  constructor() {
    this.storage = new InMemoryStorageAdapter();
  }

  async setup() {
    await sdk.boot({ storageAdapter: this.storage });
  }

  async teardown() {
    // Reset any state if necessary
    await this.storage.close();
  }

  async publishEvent(entityId: string, entityType: string, action: string, payload: any) {
    return sdk.events.publish(entityId, entityType, action, payload);
  }

  async getState<T = any>(entityType: string, entityId: string): Promise<T | null> {
    return (await sdk.state.query(entityType, entityId)) as T | null;
  }

  async advanceTime(ms: number) {
    // Mock for time based tests, useful for rules and workflows
  }
}

export function createTestingEnvironment() {
  return new TestingEnvironment();
}
