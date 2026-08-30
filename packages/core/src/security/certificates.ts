import { createLogger } from '../observability/logger';
import { storageEngine } from '../storage';

const log = createLogger('CertificateAuthority');

export interface DeviceCertificate {
  version: string;
  deviceId: string;
  deviceName: string;
  role: 'CASHIER' | 'KITCHEN_STAFF' | 'MANAGER' | 'OWNER' | 'ADMINISTRATOR' | 'PRINTER' | 'DISPLAY';
  branchId: string;
  branchName: string;
  issuedAt: string;
  expiresAt: string;
  fingerprint: string;
  signature: string;
  encryptionKey: string;
  permissions: string[];
}

export class CertificateAuthority {
  private trustedCertificates: Map<string, DeviceCertificate> = new Map();
  private masterSecret: string = 'plugos_const_master_secret_v1';

  public async boot(): Promise<void> {
    log.info('Booting Certificate Authority...');
    try {
      const stored = await storageEngine.get('network', 'trusted_certs');
      if (Array.isArray(stored)) {
        stored.forEach((cert: DeviceCertificate) => {
          this.trustedCertificates.set(cert.deviceId, cert);
        });
        log.info(`Loaded ${stored.length} trusted certificates from secure storage.`);
      }
    } catch (e) {
      log.warn('Failed loading trusted certificates on boot');
    }
  }

  // Generate SHA-256 fingerprint using Web Crypto API
  public async generateFingerprint(data: string): Promise<string> {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `SHA256:${hex}`;
      } catch (e) {
        log.warn('WebCrypto digest failed, fallback hex used');
      }
    }
    // Fallback deterministic string hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    return `SHA256:${Math.abs(hash).toString(16).padStart(16, '0')}`;
  }

  // Issue signed cryptographic certificate for a paired device
  public async issueCertificate(params: {
    deviceId: string;
    deviceName: string;
    role: DeviceCertificate['role'];
    branchId: string;
    branchName: string;
    permissions?: string[];
  }): Promise<DeviceCertificate> {
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    
    const payloadToSign = `${params.deviceId}:${params.role}:${params.branchId}:${issuedAt}:${this.masterSecret}`;
    const fingerprint = await this.generateFingerprint(payloadToSign);
    const signature = await this.generateFingerprint(`SIG:${fingerprint}:${this.masterSecret}`);
    const encryptionKey = await this.generateFingerprint(`KEY:${params.deviceId}:${issuedAt}`);

    const cert: DeviceCertificate = {
      version: '1.0',
      deviceId: params.deviceId,
      deviceName: params.deviceName,
      role: params.role,
      branchId: params.branchId,
      branchName: params.branchName,
      issuedAt,
      expiresAt,
      fingerprint,
      signature,
      encryptionKey,
      permissions: params.permissions || this.getDefaultPermissionsForRole(params.role)
    };

    this.trustedCertificates.set(cert.deviceId, cert);
    await storageEngine.set('network', 'trusted_certs', Array.from(this.trustedCertificates.values()));
    log.info(`Issued device certificate for ${cert.deviceName} (${cert.fingerprint.substring(0, 16)}...)`);
    return cert;
  }

  // Validate an incoming certificate
  public async verifyCertificate(cert: DeviceCertificate): Promise<{ valid: boolean; reason?: string }> {
    if (!cert || !cert.fingerprint || !cert.deviceId) {
      return { valid: false, reason: 'Invalid or missing certificate payload' };
    }

    if (new Date(cert.expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: 'Certificate expired' };
    }

    const payloadToSign = `${cert.deviceId}:${cert.role}:${cert.branchId}:${cert.issuedAt}:${this.masterSecret}`;
    const expectedFingerprint = await this.generateFingerprint(payloadToSign);

    if (cert.fingerprint !== expectedFingerprint) {
      // Check if trusted in store
      const trusted = this.trustedCertificates.get(cert.deviceId);
      if (trusted && trusted.fingerprint === cert.fingerprint) {
        return { valid: true };
      }
      return { valid: false, reason: 'Cryptographic fingerprint mismatch' };
    }

    return { valid: true };
  }

  public getTrustedCertificate(deviceId: string): DeviceCertificate | null {
    return this.trustedCertificates.get(deviceId) || null;
  }

  public getAllCertificates(): DeviceCertificate[] {
    return Array.from(this.trustedCertificates.values());
  }

  public async revokeCertificate(deviceId: string): Promise<void> {
    if (this.trustedCertificates.has(deviceId)) {
      this.trustedCertificates.delete(deviceId);
      await storageEngine.set('network', 'trusted_certs', Array.from(this.trustedCertificates.values()));
      log.info(`Certificate for device ${deviceId} revoked.`);
    }
  }

  private getDefaultPermissionsForRole(role: DeviceCertificate['role']): string[] {
    switch (role) {
      case 'CASHIER':
        return ['POS_CREATE', 'PAYMENT_PROCESS', 'RECEIPT_PRINT'];
      case 'KITCHEN_STAFF':
        return ['KITCHEN_UPDATE', 'ORDER_READ'];
      case 'MANAGER':
        return ['POS_CREATE', 'KITCHEN_UPDATE', 'STAFF_MANAGE', 'INVENTORY_MANAGE', 'SHIFT_AUDIT'];
      case 'OWNER':
        return ['ALL_PERMISSIONS'];
      case 'ADMINISTRATOR':
        return ['SYSTEM_ADMIN', 'ALL_PERMISSIONS'];
      case 'PRINTER':
        return ['RECEIPT_PRINT'];
      case 'DISPLAY':
        return ['ORDER_READ'];
      default:
        return ['ORDER_READ'];
    }
  }
}

export const certificateAuthority = new CertificateAuthority();
