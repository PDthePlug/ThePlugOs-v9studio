import React, { useEffect, useState } from 'react';
import { KeyRound, MonitorSmartphone, RefreshCw, ShieldAlert, Smartphone, Trash2, Wifi } from 'lucide-react';
import { hasNativeHubHost, localHubRuntime } from '@plugos/core';
import { supabase } from '../lib/supabase';

interface NativeHubEnrollmentControlProps {
  businessId: string;
  branchId: string;
  branchName: string;
  compact?: boolean;
}

interface PairingCodeResponse {
  ok?: unknown;
  pairingCode?: unknown;
  expiresAt?: unknown;
}

interface TerminalRecord {
  deviceId: string;
  name: string;
  role: string;
  status: string;
  lastSeen?: string | null;
  revokedAt?: string | null;
  localLinkPreference?: string;
}

type PairingTarget = 'HUB' | 'TERMINAL';

/**
 * Owner-only bridge for short-lived native pairing codes. The browser may
 * issue and revoke cloud authority, but it never receives a device key,
 * admission, staff session, or local transport credential.
 */
export const NativeHubEnrollmentControl: React.FC<NativeHubEnrollmentControlProps> = ({
  businessId,
  branchId,
  branchName,
  compact = false,
}) => {
  const [target, setTarget] = useState<PairingTarget>('HUB');
  const [terminalName, setTerminalName] = useState('Branch terminal');
  const [terminalRole, setTerminalRole] = useState('CASHIER');
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingNative, setOpeningNative] = useState(false);
  const [openingLocalLink, setOpeningLocalLink] = useState(false);
  const [loadingTerminals, setLoadingTerminals] = useState(false);
  const [terminals, setTerminals] = useState<TerminalRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!code || !expiresAt) return undefined;
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
    const timeout = window.setTimeout(() => {
      setCode(null);
      setExpiresAt(null);
      setMessage('The pairing code expired and was removed from this screen. Issue a new code if needed.');
    }, delay + 50);
    return () => window.clearTimeout(timeout);
  }, [code, expiresAt]);

  // A code is scoped to one branch. Do not let a browser branch switch retain
  // a still-valid code while relabeling the pairing controls for another one.
  useEffect(() => {
    setCode(null);
    setExpiresAt(null);
    setMessage(null);
  }, [businessId, branchId]);

  const loadTerminals = async () => {
    setLoadingTerminals(true);
    try {
      const { data, error } = await supabase.functions.invoke('hub-owner-enrollment', {
        body: { action: 'list-terminals', businessId, branchId },
      });
      if (error) throw error;
      const result = data as { ok?: unknown; terminals?: unknown } | null;
      if (!result || result.ok !== true || !Array.isArray(result.terminals)) {
        throw new Error('The terminal list was invalid.');
      }
      setTerminals(result.terminals.filter((value): value is TerminalRecord => (
        Boolean(value) && typeof value === 'object' &&
        typeof (value as TerminalRecord).deviceId === 'string' &&
        typeof (value as TerminalRecord).name === 'string' &&
        typeof (value as TerminalRecord).role === 'string' &&
        typeof (value as TerminalRecord).status === 'string'
      )));
    } catch {
      setMessage('Paired terminals could not be loaded. Confirm that the cloud pairing service is deployed for this owner portal.');
    } finally {
      setLoadingTerminals(false);
    }
  };

  useEffect(() => {
    void loadTerminals();
  }, [businessId, branchId]);

  const issueCode = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const action = target === 'HUB' ? 'issue-hub-pairing-code' : 'issue-terminal-pairing-code';
      const body: Record<string, string> = { action, businessId, branchId };
      if (target === 'TERMINAL') {
        const cleanName = terminalName.trim();
        if (!cleanName || cleanName.length > 120) {
          throw new Error('A terminal name is required.');
        }
        body.terminalName = cleanName;
        body.terminalRole = terminalRole;
      }
      const { data, error } = await supabase.functions.invoke('hub-owner-enrollment', { body });
      if (error) throw error;
      const result = data as PairingCodeResponse | null;
      if (!result || result.ok !== true || typeof result.pairingCode !== 'string' || !/^[0-9]{6}$/.test(result.pairingCode) ||
          typeof result.expiresAt !== 'string' || Number.isNaN(Date.parse(result.expiresAt))) {
        throw new Error('The owner enrollment receiver returned an invalid result.');
      }
      setCode(result.pairingCode);
      setExpiresAt(result.expiresAt);
      setMessage(
        target === 'HUB'
          ? 'Enter this one-time code directly on the Android Cashier Hub for ' + branchName + '.'
          : 'Enter this one-time code directly on the Android terminal. The active Hub will receive the terminal identity only after signed cloud reconciliation.'
      );
    } catch (error) {
      setCode(null);
      setExpiresAt(null);
      setMessage(error instanceof Error && error.message === 'A terminal name is required.'
        ? error.message
        : 'A pairing code could not be issued. Confirm that the cloud pairing service is deployed for this exact portal origin.');
    } finally {
      setLoading(false);
    }
  };

  const openNativeEnrollment = async () => {
    setOpeningNative(true);
    setMessage(null);
    try {
      if (target === 'HUB') {
        await localHubRuntime.openNativeEnrollment();
      } else {
        await localHubRuntime.openNativeTerminalEnrollment();
      }
      setMessage(
        target === 'HUB'
          ? 'Native Hub enrollment opened. Enter the code on the Android screen; it is never passed through the browser bridge.'
          : 'Native terminal enrollment opened. Enter the terminal code and complete the native proximity and local-link checks there.'
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The Android enrollment screen could not be opened.');
    } finally {
      setOpeningNative(false);
    }
  };

  const openNativeTerminalLocalLink = async () => {
    setOpeningLocalLink(true);
    setMessage(null);
    try {
      await localHubRuntime.openNativeTerminalLocalLink();
      setMessage('Native terminal local-link status opened. It reports only measured admission, Bluetooth, LAN, Wi-Fi Direct, TLS, and Hub-challenge facts.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The Android terminal local-link screen could not be opened.');
    } finally {
      setOpeningLocalLink(false);
    }
  };

  const revokeTerminal = async (terminal: TerminalRecord) => {
    if (!window.confirm('Revoke ' + terminal.name + '? This immediately removes its cloud admission and the Hub will reject it after reconciliation.')) {
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('hub-owner-enrollment', {
        body: { action: 'revoke-terminal', businessId, branchId, terminalDeviceId: terminal.deviceId },
      });
      if (error) throw error;
      if (!data || (data as { ok?: unknown }).ok !== true) throw new Error('Revocation was rejected.');
      setMessage('Terminal revocation was recorded. The active Hub will remove the terminal on its next signed authority reconciliation.');
      await loadTerminals();
    } catch {
      setMessage('The terminal could not be revoked. No local device state was changed.');
    } finally {
      setLoading(false);
    }
  };

  const label = target === 'HUB' ? 'Hub' : 'terminal';
  const sectionClass = 'rounded-2xl border border-stone-200 bg-white ' + (compact ? 'p-4' : 'p-5') + ' space-y-4';

  return (
    <section className={sectionClass} aria-labelledby="device-pairing-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-700"><Wifi className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h3 id="device-pairing-title" className="text-sm font-bold text-stone-900">Device pairing</h3>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            Create a code for an Android shop device at {branchName}. Enter it in the installed ThePlugOS app, then connect the devices to the same local network.
          </p>
        </div>
      </div>

      <fieldset className="grid grid-cols-2 gap-2" aria-label="Device type to pair">
        <button type="button" onClick={() => { setTarget('HUB'); setCode(null); setExpiresAt(null); }} disabled={loading || openingNative} className={'rounded-xl border p-3 text-left text-xs transition ' + (target === 'HUB' ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-900' : 'border-stone-200 bg-stone-50 text-stone-700')}>
          <Smartphone className="mb-2 h-4 w-4" aria-hidden="true" />
          <strong className="block">Cashier Hub</strong>
          <span className="mt-1 block text-[11px] opacity-80">The main shop device that runs your branch.</span>
        </button>
        <button type="button" onClick={() => { setTarget('TERMINAL'); setCode(null); setExpiresAt(null); }} disabled={loading || openingNative} className={'rounded-xl border p-3 text-left text-xs transition ' + (target === 'TERMINAL' ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-900' : 'border-stone-200 bg-stone-50 text-stone-700')}>
          <MonitorSmartphone className="mb-2 h-4 w-4" aria-hidden="true" />
          <strong className="block">Branch terminal</strong>
          <span className="mt-1 block text-[11px] opacity-80">A cashier, kitchen or manager device linked to your Hub.</span>
        </button>
      </fieldset>

      {target === 'TERMINAL' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-stone-700">
            Terminal name
            <input value={terminalName} onChange={(event) => setTerminalName(event.target.value)} maxLength={120} className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 font-normal text-stone-900 outline-none focus:border-emerald-400" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-stone-700">
            Terminal role
            <select value={terminalRole} onChange={(event) => setTerminalRole(event.target.value)} className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 font-normal text-stone-900 outline-none focus:border-emerald-400">
              <option value="CASHIER">Cashier</option>
              <option value="KITCHEN_STAFF">Kitchen</option>
              <option value="MANAGER">Manager</option>
            </select>
          </label>
        </div>
      )}

      {code && expiresAt && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" aria-live="polite">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">One-time {label} code</span>
          <strong className="mt-1 block font-mono text-3xl tracking-[0.28em] text-amber-900">{code}</strong>
          <small className="mt-2 block text-xs text-amber-900/80">Expires {new Date(expiresAt).toLocaleTimeString()} on this device. Do not send or save this code.</small>
        </div>
      )}

      {message && <p className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-700" role="status">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void issueCode()} disabled={loading || openingNative || openingLocalLink} className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-3 py-2 text-xs font-bold text-white hover:bg-stone-700 disabled:opacity-60">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Issuing secure code…' : code ? 'Issue replacement code' : 'Issue ' + label + ' pairing code'}
        </button>
        {hasNativeHubHost() && <button type="button" onClick={() => void openNativeEnrollment()} disabled={openingNative || loading || openingLocalLink} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-900 hover:bg-stone-100 disabled:opacity-60">
          {target === 'HUB' ? <Smartphone className="h-4 w-4" aria-hidden="true" /> : <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />}
          {openingNative ? 'Opening native enrollment…' : 'Open native ' + label + ' enrollment'}
        </button>}
        {hasNativeHubHost() && target === 'TERMINAL' && <button type="button" onClick={() => void openNativeTerminalLocalLink()} disabled={openingLocalLink || loading || openingNative} className="inline-flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-500/20 disabled:opacity-60">
          <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />
          {openingLocalLink ? 'Opening local-link status…' : 'Open terminal local-link status'}
        </button>}
        {code && <button type="button" onClick={() => { setCode(null); setExpiresAt(null); setMessage('The code was removed from this browser screen.'); }} className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Discard code
        </button>}
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-stone-200 bg-white p-3 text-[11px] leading-relaxed text-stone-500">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Setup is complete when the Android app confirms pairing and a connection to the shop Hub. Creating a code alone does not connect a device.
      </p>

      <div className="border-t border-stone-200 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold text-stone-800">Paired branch terminals</h4>
            <p className="mt-1 text-[11px] text-stone-500">Registered devices for this branch. Check their live connection in the Android app.</p>
          </div>
          <button type="button" onClick={() => void loadTerminals()} disabled={loadingTerminals || loading} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60">
            <RefreshCw className={'h-3.5 w-3.5 ' + (loadingTerminals ? 'animate-spin' : '')} aria-hidden="true" /> Refresh
          </button>
        </div>
        {terminals.length === 0 ? (
          <p className="mt-3 text-xs text-stone-500">No registered branch terminals yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {terminals.map((terminal) => (
              <li key={terminal.deviceId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                <span className="min-w-0">
                  <strong className="block truncate text-xs text-stone-900">{terminal.name}</strong>
                  <small className="block text-[11px] text-stone-500">{terminal.role.replace('_', ' ')} · {terminal.status} · {terminal.localLinkPreference || 'LAN_WIFI'}</small>
                </span>
                {terminal.status === 'ACTIVE' && !terminal.revokedAt && (
                  <button type="button" onClick={() => void revokeTerminal(terminal)} disabled={loading} className="rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-500/10 disabled:opacity-60">Revoke</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
