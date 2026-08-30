import { createLogger } from '../../observability/logger';
import { storageEngine } from '../../storage';

const log = createLogger('ReportingService');

export class ReportingService {
  // Query materialised views managed by the StateEngine
  public async queryView(viewCollection: string): Promise<any[]> {
    log.debug(`Querying materialised view: ${viewCollection}`);
    return storageEngine.getAll(viewCollection);
  }

  public async getEntityState(entityType: string, entityId: string): Promise<any | null> {
    const collection = `state_${entityType}`;
    return storageEngine.get(collection, entityId);
  }
}

export const reportingService = new ReportingService();
