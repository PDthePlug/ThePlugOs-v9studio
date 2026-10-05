import { createLogger } from '../observability/logger';
import { storageEngine } from '../storage';

const log = createLogger('IdentityService');

export interface UserIdentity {
  userId: string;
  roles: string[];
  metadata: Record<string, any>;
}

export class IdentityService {
  private currentIdentity: UserIdentity | null = null;

  public async authenticate(token: string): Promise<UserIdentity> {
    log.info('Authenticating token...');
    // In a real system, this would verify a JWT or session token.
    // For this local-first system, we'll simulate token resolution.
    
    // Simulate a decoded payload
    const simulatedPayload: UserIdentity = {
      userId: 'user_' + token,
      roles: ['CASHIER'], // Default for testing
      metadata: {}
    };

    this.currentIdentity = simulatedPayload;
    
    // Save to secure local storage conceptually
    await storageEngine.set('secure_session', 'current_user', simulatedPayload);
    
    log.info(`Authenticated user: ${this.currentIdentity.userId}`);
    return this.currentIdentity;
  }

  public async getIdentity(): Promise<UserIdentity | null> {
    if (this.currentIdentity) return this.currentIdentity;

    const stored = await storageEngine.get('secure_session', 'current_user');
    if (stored) {
      this.currentIdentity = stored;
      return stored;
    }

    return null;
  }

  public async logout(): Promise<void> {
    log.info('Logging out user');
    this.currentIdentity = null;
    await storageEngine.remove('secure_session', 'current_user');
  }
}

export const identityService = new IdentityService();
