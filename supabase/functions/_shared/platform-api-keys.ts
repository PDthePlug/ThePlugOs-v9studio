/**
 * Resolves the platform-provided API-key maps without ever reflecting a key in
 * an error or accepting one from a caller. This module is deliberately pure so
 * its fail-closed behaviour is testable without a Deno runtime or secrets.
 */
export type PlatformApiKeyKind = 'publishable' | 'secret';
export type EnvironmentReader = (name: string) => string | undefined;

export class PlatformApiKeyConfigurationError extends Error {
  constructor() {
    super('Supabase API-key configuration is invalid.');
  }
}

const configuration = {
  publishable: {
    modernVariable: 'SUPABASE_PUBLISHABLE_KEYS',
    legacyVariable: 'SUPABASE_ANON_KEY',
    prefix: 'sb_publishable_',
  },
  secret: {
    modernVariable: 'SUPABASE_SECRET_KEYS',
    legacyVariable: 'SUPABASE_SERVICE_ROLE_KEY',
    prefix: 'sb_secret_',
  },
} as const;

/**
 * Prefer the modern named-key map. An existing map is authoritative: malformed
 * JSON, a missing default key, or a wrong key family is a configuration error
 * rather than permission to fall back to an older credential.
 */
export function resolvePlatformApiKey(kind: PlatformApiKeyKind, readEnvironment: EnvironmentReader): string {
  const target = configuration[kind];
  const modernRaw = readEnvironment(target.modernVariable);
  if (modernRaw && modernRaw.trim()) {
    const modern = parseKeyMap(modernRaw);
    const key = modern.default;
    if (typeof key !== 'string' || !key.startsWith(target.prefix) || key.length <= target.prefix.length) {
      throw new PlatformApiKeyConfigurationError();
    }
    return key;
  }

  const legacy = readEnvironment(target.legacyVariable);
  if (!legacy || !legacy.trim()) throw new PlatformApiKeyConfigurationError();
  return legacy.trim();
}

function parseKeyMap(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PlatformApiKeyConfigurationError();
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new PlatformApiKeyConfigurationError();
  }
  return parsed as Record<string, unknown>;
}
