import { storageEngine } from '../storage';
import { createLogger } from '../observability/logger';

const log = createLogger('ConfigurationService');

export class ConfigurationService {
  private configCache: Map<string, any> = new Map();
  private readonly CONFIG_COLLECTION = 'system_config';

  public async load(): Promise<void> {
    log.info('Loading configuration from storage...');
    // In a real implementation, we'd iterate the collection. 
    // Since our simple memory adapter doesn't expose iteration yet, 
    // we assume caching handles runtime, and this would fetch the full tree.
  }

  public async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    if (this.configCache.has(key)) {
      return this.configCache.get(key) as T;
    }

    const value = await storageEngine.get(this.CONFIG_COLLECTION, key);
    if (value !== null && value !== undefined) {
      this.configCache.set(key, value);
      return value as T;
    }

    return defaultValue;
  }

  public async set<T>(key: string, value: T): Promise<void> {
    await storageEngine.set(this.CONFIG_COLLECTION, key, value);
    this.configCache.set(key, value);
    log.debug(`Configuration updated: ${key}`);
  }
}

export const configService = new ConfigurationService();
