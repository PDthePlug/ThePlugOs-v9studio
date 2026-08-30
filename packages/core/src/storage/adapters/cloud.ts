import { IStorageAdapter } from '../index';
import { InMemoryStorageAdapter } from './in-memory';
import { createLogger } from '../../observability/logger';

const log = createLogger('CloudStorageAdapter');

export interface CloudStorageConfig {
  endpoint: string;
  apiKey?: string;
  tenantId: string;
  timeoutMs?: number;
  localFallback?: IStorageAdapter;
  fetchApi?: typeof fetch;
}

export class CloudStorageAdapter implements IStorageAdapter {
  private localAdapter: IStorageAdapter;
  private endpoint: string;
  private apiKey?: string;
  private tenantId: string;
  private timeoutMs: number;
  private fetchApi: typeof fetch;

  constructor(config: CloudStorageConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
    this.timeoutMs = config.timeoutMs || 5000;
    this.localAdapter = config.localFallback || new InMemoryStorageAdapter();
    this.fetchApi = config.fetchApi || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => {
      throw new Error('Fetch API unavailable');
    }) as any);
  }

  public async init(): Promise<void> {
    log.info(`Initializing CloudStorageAdapter for tenant: ${this.tenantId}`);
    await this.localAdapter.init();
  }

  public async close(): Promise<void> {
    log.info('Closing CloudStorageAdapter');
    await this.localAdapter.close();
  }

  public async appendEvent(event: any): Promise<number> {
    const offset = await this.localAdapter.appendEvent(event);
    // Fire-and-forget or sync attempt
    this.persistEventToCloud(event, offset).catch(err => {
      log.debug('Cloud append deferred to background sync', { error: err.message });
    });
    return offset;
  }

  public async getEvents(afterOffset: number): Promise<any[]> {
    return this.localAdapter.getEvents(afterOffset);
  }

  public async get(collection: string, key: string): Promise<any | null> {
    const localVal = await this.localAdapter.get(collection, key);
    if (localVal !== null) return localVal;

    try {
      const res = await this.request('GET', `/api/v1/storage/${this.tenantId}/${collection}/${key}`);
      if (res.ok) {
        const val = await res.json();
        await this.localAdapter.set(collection, key, val);
        return val;
      }
    } catch (err: any) {
      log.debug('Cloud fetch failed, using local fallback', { collection, key, error: err.message });
    }
    return null;
  }

  public async getAll(collection: string): Promise<any[]> {
    return this.localAdapter.getAll(collection);
  }

  public async set(collection: string, key: string, value: any): Promise<void> {
    await this.localAdapter.set(collection, key, value);
    this.persistKVToCloud(collection, key, value).catch(err => {
      log.debug('Cloud set deferred to background sync', { collection, key, error: err.message });
    });
  }

  public async remove(collection: string, key: string): Promise<void> {
    await this.localAdapter.remove(collection, key);
    this.deleteKVFromCloud(collection, key).catch(err => {
      log.debug('Cloud remove deferred to background sync', { collection, key, error: err.message });
    });
  }

  private async persistEventToCloud(event: any, offset: number): Promise<boolean> {
    try {
      const res = await this.request('POST', `/api/v1/storage/${this.tenantId}/events`, {
        event,
        offset,
        timestamp: Date.now()
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async persistKVToCloud(collection: string, key: string, value: any): Promise<boolean> {
    try {
      const res = await this.request('PUT', `/api/v1/storage/${this.tenantId}/${collection}/${key}`, value);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async deleteKVFromCloud(collection: string, key: string): Promise<boolean> {
    try {
      const res = await this.request('DELETE', `/api/v1/storage/${this.tenantId}/${collection}/${key}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async request(method: string, path: string, body?: any): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-ID': this.tenantId,
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const res = await this.fetchApi(`${this.endpoint}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}
