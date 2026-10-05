import { createLogger } from '../observability/logger';
import { identityService, IdentityService, UserIdentity } from './identity';
import { permissionService, PermissionService, Policy } from './permissions';
import { certificateAuthority, CertificateAuthority } from './certificates';

const log = createLogger('SecurityEngine');

export class SecurityEngine {
  public identity: IdentityService = identityService;
  public permissions: PermissionService = permissionService;
  public certs: CertificateAuthority = certificateAuthority;

  public async boot(): Promise<void> {
    log.info('SecurityEngine booting...');
    await this.certs.boot();
    log.info('SecurityEngine online.');
  }

  public async enforce(action: string, resource: string): Promise<void> {
    const allowed = await this.permissions.canExecute(action, resource);
    if (!allowed) {
      throw new Error(`Security Violation: Unauthorized action '${action}' on resource '${resource}'`);
    }
  }
}

export const securityEngine = new SecurityEngine();
export * from './identity';
export * from './permissions';
export * from './certificates';
