import { createLogger } from '../../observability/logger';
import { storageEngine } from '../../storage';

const log = createLogger('MetricsService');

export class MetricsService {
  private readonly METRICS_COLLECTION = 'system_metrics';

  public async increment(metricName: string, value: number = 1): Promise<void> {
    const current = (await storageEngine.get(this.METRICS_COLLECTION, metricName)) || 0;
    const nextValue = current + value;
    await storageEngine.set(this.METRICS_COLLECTION, metricName, nextValue);
    log.debug(`Metric ${metricName} incremented by ${value} (Total: ${nextValue})`);
  }

  public async setGauge(metricName: string, value: number): Promise<void> {
    await storageEngine.set(this.METRICS_COLLECTION, metricName, value);
    log.debug(`Metric gauge ${metricName} set to ${value}`);
  }

  public async getMetric(metricName: string): Promise<number> {
    return (await storageEngine.get(this.METRICS_COLLECTION, metricName)) || 0;
  }
}

export const metricsService = new MetricsService();
