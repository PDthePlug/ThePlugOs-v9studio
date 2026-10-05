import { createLogger } from '../observability/logger';
export * from './adapters/cloud';
export * from './adapters/indexeddb';
export * from './adapters/in-memory';

const log = createLogger('StorageEngine');

export interface IStorageAdapter {
  init(): Promise<void>;
  close(): Promise<void>;
  
  // Event Store
  appendEvent(event: any): Promise<number>;
  getEvents(afterOffset: number): Promise<any[]>;
  
  // Key-Value Store for configurations/snapshots
  get(collection: string, key: string): Promise<any | null>;
  getAll(collection: string): Promise<any[]>;
  set(collection: string, key: string, value: any): Promise<void>;
  remove(collection: string, key: string): Promise<void>;
}

export class StorageEngine {
  private adapter: IStorageAdapter | null = null;

  public async mount(adapter: IStorageAdapter): Promise<void> {
    log.info('Mounting storage adapter');
    this.adapter = adapter;
    await this.adapter.init();
    log.info('Storage adapter mounted successfully');
  }

  private ensureMounted(): IStorageAdapter {
    if (!this.adapter) {
      const err = new Error('Storage adapter not mounted');
      log.fatal(err.message);
      throw err;
    }
    return this.adapter;
  }

  public async appendEvent(event: any): Promise<number> {
    return this.ensureMounted().appendEvent(event);
  }

  public async getEvents(afterOffset: number = 0): Promise<any[]> {
    return this.ensureMounted().getEvents(afterOffset);
  }

  public async get(collection: string, key: string): Promise<any | null> {
    return this.ensureMounted().get(collection, key);
  }

  public async getAll(collection: string): Promise<any[]> {
    return this.ensureMounted().getAll(collection);
  }

  public async set(collection: string, key: string, value: any): Promise<void> {
    return this.ensureMounted().set(collection, key, value);
  }

  public async remove(collection: string, key: string): Promise<void> {
    return this.ensureMounted().remove(collection, key);
  }
}

export const storageEngine = new StorageEngine();
