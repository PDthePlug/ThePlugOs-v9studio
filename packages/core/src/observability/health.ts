import { createLogger } from './logger';

const log = createLogger('HealthEngine');

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface HealthCheckResult {
  component: string;
  status: HealthStatus;
  message?: string;
  timestamp: string;
}

export type HealthCheckFn = () => Promise<HealthCheckResult>;

export class HealthEngine {
  private checks: Map<string, HealthCheckFn> = new Map();

  public registerCheck(component: string, fn: HealthCheckFn) {
    this.checks.set(component, fn);
    log.debug(`Registered health check for ${component}`);
  }

  public async evaluateSystemHealth(): Promise<{ status: HealthStatus; results: HealthCheckResult[] }> {
    const results: HealthCheckResult[] = [];
    let systemStatus: HealthStatus = 'HEALTHY';

    for (const [component, fn] of this.checks.entries()) {
      try {
        const result = await fn();
        results.push(result);
        if (result.status === 'UNHEALTHY') systemStatus = 'UNHEALTHY';
        if (result.status === 'DEGRADED' && systemStatus !== 'UNHEALTHY') systemStatus = 'DEGRADED';
      } catch (err: any) {
        log.error(`Health check failed for ${component}`, { error: err.message });
        const failedResult: HealthCheckResult = {
          component,
          status: 'UNHEALTHY',
          message: err.message || 'Check threw an exception',
          timestamp: new Date().toISOString()
        };
        results.push(failedResult);
        systemStatus = 'UNHEALTHY';
      }
    }

    log.info(`System Health Evaluated: ${systemStatus}`, { checks: results.length });
    return { status: systemStatus, results };
  }
}

export const healthEngine = new HealthEngine();
