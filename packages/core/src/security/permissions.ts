import { createLogger } from '../observability/logger';
import { identityService } from './identity';

const log = createLogger('PermissionService');

export interface Policy {
  action: string;
  resource: string;
  effect: 'ALLOW' | 'DENY';
}

export class PermissionService {
  private rolePolicies: Map<string, Policy[]> = new Map();

  public registerRolePolicies(role: string, policies: Policy[]) {
    this.rolePolicies.set(role, policies);
    log.debug(`Registered policies for role: ${role}`);
  }

  public async canExecute(action: string, resource: string): Promise<boolean> {
    const identity = await identityService.getIdentity();
    
    if (!identity) {
      log.warn(`Permission denied: No active identity for action ${action} on ${resource}`);
      return false;
    }

    // Default to DENY unless explicitly ALLOWED
    let allowed = false;

    for (const role of identity.roles) {
      const policies = this.rolePolicies.get(role) || [];
      for (const policy of policies) {
        if (this.matchAction(policy.action, action) && this.matchResource(policy.resource, resource)) {
          if (policy.effect === 'DENY') {
            log.info(`Permission explicitly denied by role ${role} for ${action} on ${resource}`);
            return false; // Explicit deny overrides all
          }
          if (policy.effect === 'ALLOW') {
            allowed = true;
          }
        }
      }
    }

    if (!allowed) {
      log.warn(`Permission denied: No matching ALLOW policy for ${action} on ${resource}`);
    }

    return allowed;
  }

  private matchAction(policyAction: string, requestedAction: string): boolean {
    if (policyAction === '*') return true;
    return policyAction === requestedAction;
  }

  private matchResource(policyResource: string, requestedResource: string): boolean {
    if (policyResource === '*') return true;
    return policyResource === requestedResource;
  }
}

export const permissionService = new PermissionService();
