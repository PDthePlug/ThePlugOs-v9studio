import { IStorageAdapter } from '../index';

export class InMemoryStorageAdapter implements IStorageAdapter {
  private events: any[] = [];
  private kvStore: Map<string, Map<string, any>> = new Map();

  public async init(): Promise<void> {
    // No-op for in-memory
  }

  public async close(): Promise<void> {
    this.events = [];
    this.kvStore.clear();
  }

  public async appendEvent(event: any): Promise<number> {
    this.events.push(event);
    return this.events.length - 1;
  }

  public async getEvents(afterOffset: number): Promise<any[]> {
    return this.events.slice(afterOffset);
  }

  private getCollection(collection: string): Map<string, any> {
    if (!this.kvStore.has(collection)) {
      this.kvStore.set(collection, new Map());
    }
    return this.kvStore.get(collection)!;
  }

  public async get(collection: string, key: string): Promise<any | null> {
    const col = this.getCollection(collection);
    return col.get(key) || null;
  }

  public async getAll(collection: string): Promise<any[]> {
    const col = this.getCollection(collection);
    return Array.from(col.values());
  }

  public async set(collection: string, key: string, value: any): Promise<void> {
    const col = this.getCollection(collection);
    col.set(key, value);
  }

  public async remove(collection: string, key: string): Promise<void> {
    const col = this.getCollection(collection);
    col.delete(key);
  }
}
