import { KernelEvent, eventEngine } from '../events';
import { storageEngine } from '../storage';
import { createLogger } from '../observability/logger';

const log = createLogger('StateEngine');

export type Reducer<T = any> = (currentState: T | null, event: KernelEvent) => T;

export class StateEngine {
  private readonly HWM_KEY = 'state_engine_hwm';
  private reducers: Map<string, Reducer> = new Map();

  constructor() {
    // We subscribe to a wildcard to catch all events and route them to appropriate reducers.
    // In a real system, we'd optimize this to only listen to mapped actions.
    eventEngine.subscribe('*', async (event: KernelEvent) => {
      await this.processEvent(event);
    });
  }

  public registerReducer(entityType: string, reducer: Reducer): void {
    if (this.reducers.has(entityType)) {
      log.warn(`Overwriting existing reducer for ${entityType}`);
    }
    this.reducers.set(entityType, reducer);
    log.info(`Registered reducer for ${entityType}`);
  }

  private async processEvent(event: KernelEvent): Promise<void> {
    const reducer = this.reducers.get(event.entityType);
    if (!reducer) return; // No projection required for this entity

    const collection = `state_${event.entityType}`;
    const currentState = await storageEngine.get(collection, event.entityId);
    
    try {
      const nextState = reducer(currentState, event);
      await storageEngine.set(collection, event.entityId, nextState);
      if (event.offset !== undefined) {
        await storageEngine.set('system', this.HWM_KEY, event.offset);
      }
      log.debug(`Projected state for ${event.entityType}#${event.entityId}`);
    } catch (err: any) {
      log.error(`Failed to project state for ${event.entityType}#${event.entityId}`, { error: err.message });
    }
  }

  public async getHighWaterMark(): Promise<number> {
    const hwm = await storageEngine.get('system', this.HWM_KEY);
    return typeof hwm === 'number' ? hwm : -1;
  }

  public async query(entityType: string, entityId: string): Promise<any | null> {
    const collection = `state_${entityType}`;
    return storageEngine.get(collection, entityId);
  }
}

export const stateEngine = new StateEngine();
