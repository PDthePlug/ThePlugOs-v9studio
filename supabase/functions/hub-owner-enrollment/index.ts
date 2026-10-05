import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  HubConfigurationError,
  HubHttpError,
  object,
  platformPublishableKey,
  platformServiceKey,
  requestDigest,
  rpc,
  storageHmac,
  string,
  uuid,
} from '../_shared/hub-edge.ts';

type JsonObject = Record<string, unknown>;

const MAX_REQUEST_BYTES = 16 * 1024;

/**
 * Owner-only browser endpoint. It is deliberately separate from the native
 * proof endpoints: it requires a Supabase user JWT, pins CORS to one configured
 * portal origin, and can issue only a short-lived Hub pairing code.
 */
Deno.serve(async (request) => {
  let origin: string | null = null;
  try {
    origin = requiredOwnerOrigin(request);
    if (request.method === 'OPTIONS') return ownerPreflight(origin);
    if (request.method !== 'POST') throw new HubHttpError(405, 'Owner POST required.');

    const body = await ownerJson(request);
    const ownerUserId = await authenticatedOwnerId(request);
    const action = string(body.action, 'Action', 64);
    const businessId = uuid(body.businessId, 'Business ID');
    const branchId = uuid(body.branchId, 'Branch ID');
    const ownerHash = await storageHmac('owner-pairing', ownerUserId);
    if (action === 'issue-hub-pairing-code') {
      const digest = await requestDigest({ action, businessId, branchId, ownerUserId });
      const result = object(await rpc<unknown>(serviceClient(), 'r003_issue_hub_pairing_code', {
        p_business_id: businessId,
        p_branch_id: branchId,
        p_owner_user_id: ownerUserId,
        p_request_digest: digest,
        p_owner_hash: ownerHash,
      }), 'Owner Hub enrollment result');
      return pairingCodeResponse(result, origin);
    }
    if (action === 'issue-terminal-pairing-code') {
      const terminalName = string(body.terminalName, 'Terminal name', 120);
      const terminalRole = terminalRoleValue(body.terminalRole);
      const digest = await requestDigest({ action, businessId, branchId, ownerUserId, terminalName, terminalRole });
      const result = object(await rpc<unknown>(serviceClient(), 'r010_issue_terminal_pairing_code', {
        p_business_id: businessId,
        p_branch_id: branchId,
        p_owner_user_id: ownerUserId,
        p_terminal_name: terminalName,
        p_terminal_role: terminalRole,
        p_request_digest: digest,
        p_owner_hash: ownerHash,
      }), 'Owner terminal enrollment result');
      return pairingCodeResponse(result, origin);
    }
    if (action === 'issue-staff-credential-reset-code') {
      const staffId = uuid(body.staffId, 'Staff ID');
      const digest = await requestDigest({ action, businessId, branchId, ownerUserId, staffId });
      const result = object(await rpc<unknown>(serviceClient(), 'r012_issue_staff_credential_reset_code', {
        p_business_id: businessId,
        p_branch_id: branchId,
        p_staff_id: staffId,
        p_owner_user_id: ownerUserId,
        p_request_digest: digest,
        p_owner_hash: ownerHash,
      }), 'Owner credential-reset result');
      return credentialResetCodeResponse(result, origin);
    }
    if (action === 'list-terminals') {
      const result = object(await rpc<unknown>(serviceClient(), 'r010_list_branch_terminals', {
        p_business_id: businessId,
        p_branch_id: branchId,
        p_owner_user_id: ownerUserId,
      }), 'Owner terminal list result');
      if (result.ok !== true || !Array.isArray(result.terminals)) return ownerFailure(origin, 401);
      return ownerJsonResponse({ ok: true, terminals: result.terminals }, 200, origin);
    }
    if (action === 'revoke-terminal') {
      const terminalDeviceId = string(body.terminalDeviceId, 'Terminal device ID', 200);
      const digest = await requestDigest({ action, businessId, branchId, ownerUserId, terminalDeviceId });
      const result = object(await rpc<unknown>(serviceClient(), 'r010_revoke_terminal', {
        p_business_id: businessId,
        p_branch_id: branchId,
        p_owner_user_id: ownerUserId,
        p_terminal_device_id: terminalDeviceId,
        p_request_digest: digest,
      }), 'Owner terminal revocation result');
      if (result.ok !== true) return ownerFailure(origin, 401);
      return ownerJsonResponse({ ok: true }, 200, origin);
    }
    throw new HubHttpError(400, 'Action is invalid.');
  } catch (error) {
    const status = error instanceof HubConfigurationError
      ? 503
      : error instanceof HubHttpError
        ? (error.status === 405 ? 405 : error.status === 413 ? 413 : error.status === 401 ? 401 : 400)
        : 401;
    // No raw error, request fields, identity, or code is reflected to the
    // caller. A valid configured origin still receives CORS so the owner UI can
    // render a safe generic failure.
    return ownerFailure(origin, status);
  }
});

async function ownerJson(request: Request): Promise<JsonObject> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) {
    throw new HubHttpError(413, 'Request is too large.');
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new HubHttpError(413, 'Request is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HubHttpError(400, 'Request must be JSON.');
  }
  return object(parsed, 'Request');
}

function requiredOwnerOrigin(request: Request): string {
  const configured = Deno.env.get('HUB_OWNER_PORTAL_ORIGIN');
  if (!configured) throw new HubConfigurationError('Owner portal origin is not configured.');
  let expected: string;
  try {
    expected = new URL(configured).origin;
  } catch {
    throw new HubConfigurationError('Owner portal origin is invalid.');
  }
  if (expected !== configured.replace(/\/$/, '')) {
    throw new HubConfigurationError('Owner portal origin must not include a path.');
  }
  const origin = request.headers.get('origin');
  if (!origin || origin !== expected) throw new HubHttpError(401, 'Owner origin is not allowed.');
  return origin;
}

async function authenticatedOwnerId(request: Request): Promise<string> {
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    throw new HubHttpError(401, 'Owner authorization is required.');
  }
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = platformPublishableKey();
  if (!url || !anonKey) throw new HubConfigurationError('Supabase owner authentication is not configured.');
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HubHttpError(401, 'Owner authorization is invalid.');
  return uuid(data.user.id, 'Owner user ID');
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = platformServiceKey();
  if (!url || !key) throw new HubConfigurationError('Supabase service configuration is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function pairingCodeResponse(result: JsonObject, origin: string): Response {
  if (result.ok !== true) return ownerFailure(origin, 401);
  const pairingCode = string(result.pairingCode, 'Pairing code', 6);
  const expiresAt = string(result.expiresAt, 'Pairing code expiry', 24);
  if (!/^\d{6}$/.test(pairingCode) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)) {
    throw new HubConfigurationError('Owner enrollment result is invalid.');
  }
  return ownerJsonResponse({ ok: true, pairingCode, expiresAt }, 200, origin);
}

/** Browser-visible authority only: a one-time code, never a PIN or verifier. */
function credentialResetCodeResponse(result: JsonObject, origin: string): Response {
  if (result.ok !== true) return ownerFailure(origin, 401);
  const resetCode = string(result.resetCode, 'Credential-reset code', 12);
  const expiresAt = string(result.expiresAt, 'Credential-reset expiry', 24);
  if (!/^[A-Za-z0-9_-]{12}$/.test(resetCode)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)) {
    throw new HubConfigurationError('Owner credential-reset result is invalid.');
  }
  return ownerJsonResponse({ ok: true, resetCode, expiresAt }, 200, origin);
}

function terminalRoleValue(value: unknown): string {
  const role = string(value, 'Terminal role', 32);
  if (!['CASHIER', 'KITCHEN_STAFF', 'MANAGER'].includes(role)) {
    throw new HubHttpError(400, 'Terminal role is invalid.');
  }
  return role;
}

function ownerPreflight(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...ownerCorsHeaders(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
    },
  });
}

function ownerFailure(origin: string | null, status: number): Response {
  const headers = origin ? ownerCorsHeaders(origin) : {};
  return new Response(JSON.stringify({ ok: false, error: 'The owner enrollment request could not be accepted.' }), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function ownerJsonResponse(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ownerCorsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function ownerCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
  };
}
