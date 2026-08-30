export type OwnerAuthRedirectPurpose = 'SIGNUP_CONFIRMATION' | 'RECOVERY';

export type OwnerPortalConfigurationFailure =
  | 'MISSING_CONFIGURED_ORIGIN'
  | 'INVALID_CONFIGURED_ORIGIN'
  | 'MISSING_BROWSER_AUTH_CONFIGURATION'
  | 'INVALID_BROWSER_AUTH_CONFIGURATION'
  | 'UNAPPROVED_RUNTIME_ORIGIN';

export interface OwnerPortalConfiguration {
  approvedOrigin: string | null;
  isReady: boolean;
  failure: OwnerPortalConfigurationFailure | null;
}

export interface OwnerPortalConfigurationInput {
  configuredOrigin?: string | null;
  runtimeOrigin?: string | null;
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
  allowLocalDevelopment?: boolean;
}

const localDevelopmentHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

const browserOrigin = () => (typeof window === 'undefined' ? null : window.location.origin);

const normaliseConfiguredOrigin = (value: string, allowLocalDevelopment: boolean): string | null => {
  const configured = value.trim();
  if (!configured) return null;

  try {
    const parsed = new URL(configured);
    const isLocalDevelopmentOrigin = allowLocalDevelopment
      && parsed.protocol === 'http:'
      && localDevelopmentHosts.has(parsed.hostname);
    const isExactOrigin = configured === parsed.origin
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && !parsed.username
      && !parsed.password
      && !parsed.hostname.includes('*');

    if (!isExactOrigin || (parsed.protocol !== 'https:' && !isLocalDevelopmentOrigin)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

const normaliseSupabaseUrl = (value: string, allowLocalDevelopment: boolean): string | null => {
  const configured = value.trim();
  if (!configured) return null;

  try {
    const parsed = new URL(configured);
    const isLocalDevelopmentUrl = allowLocalDevelopment
      && parsed.protocol === 'http:'
      && localDevelopmentHosts.has(parsed.hostname);
    const isSafeUrl = !parsed.search
      && !parsed.hash
      && !parsed.username
      && !parsed.password;

    if (!isSafeUrl || (parsed.protocol !== 'https:' && !isLocalDevelopmentUrl)) {
      return null;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const isLegacyAnonJwt = (value: string): boolean => {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const base64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = base64Payload.padEnd(base64Payload.length + ((4 - (base64Payload.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(paddedPayload)) as { role?: unknown };
    return payload.role === 'anon';
  } catch {
    return false;
  }
};

const isBrowserPublishableKey = (value: string): boolean => {
  const key = value.trim();
  return key.startsWith('sb_publishable_') || isLegacyAnonJwt(key);
};

/**
 * Browser owner Auth is intentionally bound to one explicit, non-secret
 * public origin. This prevents preview/unknown origins from collecting owner
 * credentials or receiving password-recovery/confirmation redirects.
 */
export const resolveOwnerPortalConfiguration = (
  input: OwnerPortalConfigurationInput = {},
): OwnerPortalConfiguration => {
  const configuredOrigin = input.configuredOrigin ?? import.meta.env.VITE_OWNER_PORTAL_ORIGIN;
  const runtimeOrigin = input.runtimeOrigin ?? browserOrigin();
  const supabaseUrl = input.supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = input.supabaseAnonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  const allowLocalDevelopment = input.allowLocalDevelopment ?? import.meta.env.DEV;

  if (!configuredOrigin?.trim()) {
    return { approvedOrigin: null, isReady: false, failure: 'MISSING_CONFIGURED_ORIGIN' };
  }

  const approvedOrigin = normaliseConfiguredOrigin(configuredOrigin, allowLocalDevelopment);
  if (!approvedOrigin) {
    return { approvedOrigin: null, isReady: false, failure: 'INVALID_CONFIGURED_ORIGIN' };
  }

  if (!supabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
    return { approvedOrigin, isReady: false, failure: 'MISSING_BROWSER_AUTH_CONFIGURATION' };
  }

  if (!normaliseSupabaseUrl(supabaseUrl, allowLocalDevelopment) || !isBrowserPublishableKey(supabaseAnonKey)) {
    return { approvedOrigin, isReady: false, failure: 'INVALID_BROWSER_AUTH_CONFIGURATION' };
  }

  if (!runtimeOrigin || runtimeOrigin !== approvedOrigin) {
    return { approvedOrigin, isReady: false, failure: 'UNAPPROVED_RUNTIME_ORIGIN' };
  }

  return { approvedOrigin, isReady: true, failure: null };
};

export const ownerPortalAccessMessage = (configuration: OwnerPortalConfiguration): string => {
  if (configuration.failure === 'UNAPPROVED_RUNTIME_ORIGIN') {
    return 'Owner access is available only from the approved owner portal.';
  }
  if (configuration.failure === 'MISSING_BROWSER_AUTH_CONFIGURATION' || configuration.failure === 'INVALID_BROWSER_AUTH_CONFIGURATION') {
    return 'Owner authentication is not configured for this portal yet.';
  }
  return 'Owner access is not configured for this portal yet.';
};

/**
 * Confirmation and recovery are different security states. A confirmed owner
 * must return to the clean portal root, while only a password-reset link may
 * use the presentation-only recovery marker.
 */
export const ownerAuthRedirectUrl = (
  purpose: OwnerAuthRedirectPurpose,
  input: OwnerPortalConfigurationInput = {},
): string | null => {
  const configuration = resolveOwnerPortalConfiguration(input);
  if (!configuration.isReady || !configuration.approvedOrigin) return null;
  return purpose === 'RECOVERY'
    ? `${configuration.approvedOrigin}?auth=recovery`
    : configuration.approvedOrigin;
};
