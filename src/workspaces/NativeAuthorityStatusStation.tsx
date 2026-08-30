import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Cloud, CloudOff, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
import type { NativeHubOperatorContext, NetworkHealth } from '@plugos/core';

interface NativeAuthorityStatusStationProps {
  onExit: () => void;
  onEndNativeSession: () => Promise<void>;
}

/**
 * Owner and Administrator sessions are real signed native sessions, but this
 * release grants them no hidden operational command family.  They receive a
 * measured status surface rather than falling through to the Cashier UI and
 * being rejected after station routing.
 */
export const NativeAuthorityStatusStation: React.FC<NativeAuthorityStatusStationProps> = ({ onExit, onEndNativeSession }) => {
  const [context, setContext] = useState<NativeHubOperatorContext | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [operator] = await Promise.all([
      localHubRuntime.getNativeOperatorContext(),
      localHubRuntime.refresh().catch(() => undefined),
    ]);
    setContext(operator);
    setHealth(localHubRuntime.getNetworkHealth());
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        await refresh();
        if (!mounted) return;
        unsubscribe = localHubRuntime.subscribe((snapshot) => {
          if (mounted) setHealth(snapshot.networkHealth);
        });
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : 'The native authority status is unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [refresh]);

  const refreshStatus = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      await refresh();
      setMessage('Measured native Hub status refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub status could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const endSession = async () => {
    setEnding(true);
    setMessage(null);
    try {
      await onEndNativeSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native authority session could not be ended safely.');
    } finally {
      setEnding(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><p className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm">Opening the measured native authority status…</p></main>;
  }

  const isAuthorityRole = context?.role === 'OWNER' || context?.role === 'ADMINISTRATOR';
  if (!context || !isAuthorityRole) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <section className="mx-auto max-w-lg space-y-5 rounded-3xl border border-amber-500/30 bg-slate-900 p-6">
          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">Native role surface unavailable</span>
          <h1 className="text-xl font-bold">This active session is not an Owner or Administrator session.</h1>
          <p className="text-sm leading-relaxed text-slate-300">{message || 'Return to native sign-in. This screen never accepts a browser-selected role.'}</p>
          <button type="button" onClick={onExit} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-white">Return to native sign-in</button>
        </section>
      </main>
    );
  }

  const cloudConnected = health?.cloudStatus === 'CONNECTED';
  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6">
      <section className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onExit} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-slate-200 hover:bg-slate-800" aria-label="Return to native station access"><ArrowLeft className="h-5 w-5" /></button>
            <span className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 text-sky-200"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Native authority status</p>
              <h1 className="text-xl font-black">Hello, {context.staffName}</h1>
              <p className="mt-0.5 text-xs text-slate-400">{context.role === 'OWNER' ? 'Owner' : 'Administrator'} session verified by the Android Hub</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void refreshStatus()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={'h-4 w-4 ' + (refreshing ? 'animate-spin' : '')} /> Refresh</button>
            <button type="button" onClick={() => void endSession()} disabled={ending} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-white disabled:opacity-50">{ending ? 'Ending…' : 'End native session'}</button>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><small className="text-xs uppercase tracking-[0.12em] text-slate-500">Native authority</small><strong className="mt-2 block text-lg text-slate-100">Verified</strong><p className="mt-2 text-xs leading-relaxed text-slate-400">The role came from the signed native session, not browser state.</p></article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><small className="text-xs uppercase tracking-[0.12em] text-slate-500">Cloud link</small><strong className="mt-2 flex items-center gap-2 text-lg text-slate-100">{cloudConnected ? <Cloud className="h-4 w-4 text-emerald-300" /> : <CloudOff className="h-4 w-4 text-amber-300" />}{health?.cloudStatus || 'UNKNOWN'}</strong><p className="mt-2 text-xs leading-relaxed text-slate-400">A disconnected cloud link never implies lost local authority or acknowledgement.</p></article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><small className="text-xs uppercase tracking-[0.12em] text-slate-500">Local link</small><strong className="mt-2 flex items-center gap-2 text-lg text-slate-100"><WifiOff className="h-4 w-4 text-slate-400" />{health?.activeTransport || 'UNAVAILABLE'}</strong><p className="mt-2 text-xs leading-relaxed text-slate-400">{health?.localPeerCount || 0} authenticated peer device(s) measured by the Hub.</p></article>
        </div>

        <section className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm leading-relaxed text-amber-100">
          This release intentionally provides no Owner or Administrator operational-command family. Device pairing and branch management remain owner-authenticated cloud controls; Cashier, Kitchen, and Manager operations remain separately role-gated native workflows.
        </section>
        {message && <p className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300" role="status">{message}</p>}
      </section>
    </main>
  );
};
