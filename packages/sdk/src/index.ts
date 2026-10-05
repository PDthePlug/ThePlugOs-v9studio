import {
  runtime,
  RuntimeOptions,
  eventEngine,
  stateEngine,
  securityEngine,
  workflowService,
  rulesService,
  notificationService,
  syncService,
  metricsService,
  reportingService,
  healthEngine,
  localHubRuntime,
  storageEngine,
  IStorageAdapter,
  createLogger
} from '@plugos/core';

export type { IStorageAdapter };

const log = createLogger('PlugOS-SDK');

export class PlugOS {
  public async boot(options: RuntimeOptions): Promise<void> {
    log.info('Initialising PlugOS SDK...');
    await runtime.boot(options);
    await securityEngine.boot();
    await syncService.boot();
    log.info('PlugOS SDK Initialised Successfully.');
  }

  public get events() {
    return {
      publish: (arg1: string, arg2?: any, arg3?: string, arg4?: any) => {
        if (arg3 !== undefined) {
          // 4-argument signature: entityId, entityType, action, payload
          return eventEngine.publish(arg1, arg2, arg3, arg4);
        } else {
          // 2-argument signature: action, payload
          const action = arg1;
          const payload = arg2 || {};
          const entityId = payload.id || payload.staffId || payload.productId || payload.orderId || payload.deviceId || 'system';
          const entityType = payload.domain || (entityId.startsWith('usr') ? 'staff' : entityId.startsWith('ff') ? 'menu' : entityId.startsWith('ORD') ? 'order' : 'system');
          return eventEngine.publish(entityId, entityType, action, payload);
        }
      },
      subscribe: (eventType: string, handler: any) => 
        eventEngine.subscribe(eventType, handler)
    };
  }

  public get state() {
    return {
      query: (entityType: string, entityId: string) => stateEngine.query(entityType, entityId),
      registerReducer: (entityType: string, reducer: any) => stateEngine.registerReducer(entityType, reducer)
    };
  }

  public get auth() {
    return {
      authenticate: (token: string) => securityEngine.identity.authenticate(token),
      logout: () => securityEngine.identity.logout(),
      getUser: () => securityEngine.identity.getIdentity(),
      enforce: (action: string, resource: string) => securityEngine.enforce(action, resource)
    };
  }

  public get workflows() {
    return {
      transition: (entityId: string, entityType: string, action: string, payload?: any) =>
        workflowService.transition(entityId, entityType, action, payload),
      register: (workflow: any) => workflowService.registerWorkflow(workflow)
    };
  }

  public get rules() {
    return {
      evaluate: (domain: string, context: any) => rulesService.evaluate(domain, context),
      register: (domain: string, rules: any[]) => rulesService.registerRules(domain, rules)
    };
  }

  public get notifications() {
    return {
      notify: (level: any, title: string, message: string) => notificationService.notify(level, title, message),
      subscribe: (handler: any) => notificationService.subscribe(handler),
      getUnread: () => notificationService.getUnread(),
      markAsRead: (id: string) => notificationService.markAsRead(id)
    };
  }

  public get network() {
    return {
      getStatus: () => localHubRuntime.getNetworkHealth(),
      refresh: () => localHubRuntime.refresh()
    };
  }

  public get hub() {
    return {
      getDevices: () => localHubRuntime.getDevices(),
      getNetworkHealth: () => localHubRuntime.getNetworkHealth(),
      getFailures: () => localHubRuntime.getFailures(),
      getTransportMetrics: () => localHubRuntime.getTransportMetrics(),
      getOutbox: () => localHubRuntime.getOutbox(),
      getInbox: () => localHubRuntime.getInbox(),
      registerDevice: (device: any, options: { branchId: string; branchName?: string }) => localHubRuntime.registerDevice(device, options),
      revokeDevice: (id: string) => localHubRuntime.revokeDevice(id),
      discoverDevices: () => localHubRuntime.triggerSubnetScan(),
      runFailureSimulation: (id: string) => localHubRuntime.runFailureSimulation(id),
      subscribe: (listener: (state: any) => void) => localHubRuntime.subscribe(listener)
    };
  }

  public get reporting() {
    return {
      queryView: (view: string) => reportingService.queryView(view)
    };
  }

  public get storage() {
    return {
      // Browser localStorage is never an authority namespace. Native Hub
      // collections are scoped by the verified authorization bundle in
      // SQLCipher; callers that need browser cache must provide their own
      // non-operational namespace explicitly.
      get: (namespace: string, key: string) => storageEngine.get(namespace, key),
      getAll: (namespace: string) => storageEngine.getAll(namespace),
      set: (namespace: string, key: string, value: any) => storageEngine.set(namespace, key, value),
      remove: (namespace: string, key: string) => storageEngine.remove(namespace, key)
    };
  }

  public get system() {
    return {
      health: () => healthEngine.evaluateSystemHealth(),
      metrics: {
        increment: (metric: string, value?: number) => metricsService.increment(metric, value),
        setGauge: (metric: string, value: number) => metricsService.setGauge(metric, value)
      }
    };
  }
}

export const sdk = new PlugOS();
