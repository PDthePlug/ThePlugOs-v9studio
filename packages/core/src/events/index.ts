import { ulid } from 'ulid';
import { createLogger } from '../observability/logger';
import { storageEngine } from '../storage';

const log = createLogger('EventEngine');

export interface KernelEvent<T = any> {
  eventId: string;
  timestamp: string;
  entityId: string;
  entityType: string;
  action: string;
  payload: T;
  version: number;
  offset?: number;
}

export type EventSubscriber = (event: KernelEvent) => Promise<void>;

export class EventEngine {
  private subscribers: Map<string, EventSubscriber[]> = new Map();

  public async publish<T>(
    entityId: string, 
    entityType: string, 
    action: string, 
    payload: T, 
    version: number = 1
  ): Promise<string> {
    const event: KernelEvent<T> = {
      eventId: ulid(),
      timestamp: new Date().toISOString(),
      entityId,
      entityType,
      action,
      payload,
      version
    };

    log.debug(`Publishing event ${action} for ${entityType}#${entityId}`);
    
    // Append to ledger
    event.offset = await storageEngine.appendEvent(event);

    // Notify subscribers
    await this.dispatch(event);

    return event.eventId;
  }

  public subscribe(eventType: string, subscriber: EventSubscriber): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType)!.push(subscriber);

    return () => {
      const handlers = this.subscribers.get(eventType);
      if (handlers) {
        const idx = handlers.indexOf(subscriber);
        if (idx !== -1) {
          handlers.splice(idx, 1);
        }
      }
    };
  }

  private async dispatch(event: KernelEvent): Promise<void> {
    const handlers = this.subscribers.get(event.action) || [];
    const wildcardHandlers = this.subscribers.get('*') || [];
    
    // Wildcard handlers (like StateEngine) must run first to project state
    const allHandlers = [...wildcardHandlers, ...handlers];
    
    // In a production engine, this could be queued or handled synchronously based on guarantees.
    // For local-first, synchronous dispatch is often necessary for immediate UI updates,
    // but robust error handling is required to avoid breaking the event loop.
    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (err: any) {
        log.error(`Event handler failed for ${event.action}`, { error: err.message, eventId: event.eventId });
      }
    }
  }

  public async replay(afterOffset: number = 0): Promise<void> {
    log.info(`Replaying events from offset ${afterOffset}`);
    const events = await storageEngine.getEvents(afterOffset);
    
    for (const event of events) {
      await this.dispatch(event);
    }
    log.info(`Replayed ${events.length} events successfully`);
  }
}

export const eventEngine = new EventEngine();
