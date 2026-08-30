import { IStorageAdapter } from '../index';
import { createLogger } from '../../observability/logger';

const log = createLogger('IndexedDBStorageAdapter');

export class IndexedDBStorageAdapter implements IStorageAdapter {
  private dbName: string;
  private dbVersion: number;
  private db: IDBDatabase | null = null;
  private fallbackMemory: Map<string, Map<string, any>> = new Map();
  private fallbackEvents: any[] = [];
  private isSupported: boolean = false;

  constructor(dbName: string = 'plugos_store', dbVersion: number = 1) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
  }

  public async init(): Promise<void> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      log.warn('IndexedDB not supported in current environment. Using non-durable memory only.');
      this.isSupported = false;
      return;
    }

    return new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('events')) {
            db.createObjectStore('events', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('kv')) {
            db.createObjectStore('kv');
          }
        };

        request.onsuccess = (event: Event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          this.isSupported = true;
          log.info(`IndexedDB mounted successfully: ${this.dbName}`);
          resolve();
        };

        request.onerror = (err: Event) => {
          log.warn('IndexedDB open error, falling back to non-durable memory', { error: (err.target as any)?.error });
          this.isSupported = false;
          resolve();
        };
      } catch (err: any) {
        log.warn('IndexedDB exception, falling back to non-durable memory', { error: err.message });
        this.isSupported = false;
        resolve();
      }
    });
  }

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  public async appendEvent(event: any): Promise<number> {
    if (!this.isSupported || !this.db) {
      this.fallbackEvents.push(event);
      return this.fallbackEvents.length - 1;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db!.transaction('events', 'readwrite');
        const store = tx.objectStore('events');
        const req = store.add(event);

        req.onsuccess = () => {
          // Key returned is 1-indexed count
          const offset = (req.result as number) - 1;
          resolve(offset);
        };
        req.onerror = () => {
          // Fallback
          this.fallbackEvents.push(event);
          resolve(this.fallbackEvents.length - 1);
        };
      } catch (e) {
        this.fallbackEvents.push(event);
        resolve(this.fallbackEvents.length - 1);
      }
    });
  }

  public async getEvents(afterOffset: number = -1): Promise<any[]> {
    if (!this.isSupported || !this.db) {
      return this.fallbackEvents.slice(afterOffset + 1);
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction('events', 'readonly');
        const store = tx.objectStore('events');
        const req = store.getAll();

        req.onsuccess = () => {
          const events = req.result || [];
          resolve(events.slice(afterOffset + 1));
        };
        req.onerror = () => {
          resolve(this.fallbackEvents.slice(afterOffset + 1));
        };
      } catch {
        resolve(this.fallbackEvents.slice(afterOffset + 1));
      }
    });
  }

  public async get(collection: string, key: string): Promise<any | null> {
    const compositeKey = `${collection}:${key}`;
    if (!this.isSupported || !this.db) {
      const colMap = this.fallbackMemory.get(collection);
      return colMap ? colMap.get(key) ?? null : null;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction('kv', 'readonly');
        const store = tx.objectStore('kv');
        const req = store.get(compositeKey);

        req.onsuccess = () => {
          resolve(req.result !== undefined ? req.result : null);
        };
        req.onerror = () => {
          const colMap = this.fallbackMemory.get(collection);
          resolve(colMap ? colMap.get(key) ?? null : null);
        };
      } catch {
        const colMap = this.fallbackMemory.get(collection);
        resolve(colMap ? colMap.get(key) ?? null : null);
      }
    });
  }

  public async getAll(collection: string): Promise<any[]> {
    if (!this.isSupported || !this.db) {
      const colMap = this.fallbackMemory.get(collection);
      return colMap ? Array.from(colMap.values()) : [];
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction('kv', 'readonly');
        const store = tx.objectStore('kv');
        const req = store.openCursor();
        const results: any[] = [];

        req.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            if (typeof cursor.key === 'string' && cursor.key.startsWith(`${collection}:`)) {
              results.push(cursor.value);
            }
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        req.onerror = () => {
          const colMap = this.fallbackMemory.get(collection);
          resolve(colMap ? Array.from(colMap.values()) : []);
        };
      } catch {
        const colMap = this.fallbackMemory.get(collection);
        resolve(colMap ? Array.from(colMap.values()) : []);
      }
    });
  }

  public async set(collection: string, key: string, value: any): Promise<void> {
    const compositeKey = `${collection}:${key}`;

    if (!this.fallbackMemory.has(collection)) {
      this.fallbackMemory.set(collection, new Map());
    }
    this.fallbackMemory.get(collection)!.set(key, value);

    if (!this.isSupported || !this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        store.put(value, compositeKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async remove(collection: string, key: string): Promise<void> {
    const compositeKey = `${collection}:${key}`;

    if (this.fallbackMemory.has(collection)) {
      this.fallbackMemory.get(collection)!.delete(key);
    }

    if (!this.isSupported || !this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        store.delete(compositeKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

}
