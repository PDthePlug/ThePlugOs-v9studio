import { KernelEvent } from '../../events';
import { createLogger } from '../../observability/logger';

const log = createLogger('HttpCloudSyncAdapter');

export interface CloudSyncConfig {
  endpoint: string;
  tenantId: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  batchSize?: number;
  fetchApi?: typeof fetch;
}

export interface SyncResult {
  success: boolean;
  ackId?: string;
  conflict?: boolean;
  error?: string;
}

export interface BatchSyncResult {
  syncedIds: string[];
  failedIds: string[];
}

export interface ICloudSyncAdapter {
  syncEvent(event: KernelEvent): Promise<SyncResult>;
  syncBatch(events: KernelEvent[]): Promise<BatchSyncResult>;
}

export class HttpCloudSyncAdapter implements ICloudSyncAdapter {
  private endpoint: string;
  private tenantId: string;
  private apiKey?: string;
  private timeoutMs: number;
  private maxRetries: number;
  private batchSize: number;
  private fetchApi: typeof fetch;

  constructor(config: CloudSyncConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.tenantId = config.tenantId;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs || 5000;
    this.maxRetries = config.maxRetries || 3;
    this.batchSize = config.batchSize || 50;
    this.fetchApi = config.fetchApi || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => {
      throw new Error('Fetch API unavailable');
    }) as any);
  }

  public async syncEvent(event: KernelEvent): Promise<SyncResult> {
    let attempt = 0;
    let delay = 100;

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Tenant-ID': this.tenantId,
          'X-Idempotency-Key': event.eventId,
          'X-Sync-Attempt': String(attempt),
        };

        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await this.fetchApi(`${this.endpoint}/api/v1/sync/events`, {
          method: 'POST',
          headers,
          body: JSON.stringify(event),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          return { success: true, ackId: body.ackId || event.eventId };
        }

        if (response.status === 409) {
          log.warn(`Conflict detected during sync for event ${event.eventId}`);
          return { success: false, conflict: true, error: 'Conflict' };
        }

        if (response.status >= 500 || response.status === 429) {
          if (attempt <= this.maxRetries) {
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
            continue;
          }
        }

        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      } catch (err: any) {
        if (attempt <= this.maxRetries) {
          await new Promise(res => setTimeout(res, delay));
          delay *= 2;
          continue;
        }
        return { success: false, error: err.message };
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  public async syncBatch(events: KernelEvent[]): Promise<BatchSyncResult> {
    const syncedIds: string[] = [];
    const failedIds: string[] = [];

    for (let i = 0; i < events.length; i += this.batchSize) {
      const chunk = events.slice(i, i + this.batchSize);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs * 2);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Tenant-ID': this.tenantId,
          'X-Batch-Size': String(chunk.length),
        };
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await this.fetchApi(`${this.endpoint}/api/v1/sync/batch`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ events: chunk }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.ok) {
          const body = await response.json().catch(() => ({ syncedIds: chunk.map(e => e.eventId) }));
          const acked = body.syncedIds || chunk.map((e: any) => e.eventId);
          syncedIds.push(...acked);
        } else {
          // Fallback to single item sync on batch error
          for (const ev of chunk) {
            const res = await this.syncEvent(ev);
            if (res.success) {
              syncedIds.push(ev.eventId);
            } else {
              failedIds.push(ev.eventId);
            }
          }
        }
      } catch {
        // Fallback to single item sync
        for (const ev of chunk) {
          const res = await this.syncEvent(ev);
          if (res.success) {
            syncedIds.push(ev.eventId);
          } else {
            failedIds.push(ev.eventId);
          }
        }
      }
    }

    return { syncedIds, failedIds };
  }
}
