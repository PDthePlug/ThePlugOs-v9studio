import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChefHat, CircleCheck, Cloud, CloudOff, Play, RefreshCw, RotateCcw, ShieldCheck, WifiOff } from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
import type { NativeHubCommandRequest, NativeHubOperatorContext, NetworkHealth } from '@plugos/core';

interface NativeKitchenStationProps {
  onExit: () => void;
  onEndNativeSession: () => Promise<void>;
}

type KitchenOrder = NonNullable<NativeHubOperatorContext>['pendingKitchenOrders'][number];
type KitchenTargetStatus = 'PREPARING' | 'READY';
type PendingTransitionRequest = NativeHubCommandRequest & {
  orderId: string;
  targetStatus: KitchenTargetStatus;
};

function createRequestUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('This Android web runtime cannot create the required UUID request identifiers.');
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function recoveredTransitionRequests(context: NativeHubOperatorContext): Record<string, PendingTransitionRequest> {
  return (context.recoverableNativeCommands || []).reduce<Record<string, PendingTransitionRequest>>((requests, command) => {
    const orderId = command.payload.orderId;
    const targetStatus = command.payload.status;
    if (
      command.type !== 'order.status.transition' ||
      typeof orderId !== 'string' ||
      (targetStatus !== 'PREPARING' && targetStatus !== 'READY')
    ) {
      return requests;
    }
    if (requests[orderId] && requests[orderId].commandId !== command.commandId) {
      throw new Error(`The native Hub has more than one unresolved transition request for order ${orderId.slice(0, 8)}. Reconcile the measured native state before requesting another transition.`);
    }
    requests[orderId] = { ...command, orderId, targetStatus };
    return requests;
  }, {});
}

function actionFor(order: KitchenOrder): { label: string; status: KitchenTargetStatus; icon: typeof Play } {
  return order.status === 'PLACED'
    ? { label: 'Start preparation locally', status: 'PREPARING', icon: Play }
    : { label: 'Mark ready locally', status: 'READY', icon: CircleCheck };
}

/**
 * Native Kitchen task surface. It renders only measured local Hub projections
 * and makes exactly the transition request the Hub already authorizes. No
 * React state is used as an order queue, permission, delivery, or sync fact.
 */
export const NativeKitchenStation: React.FC<NativeKitchenStationProps> = ({ onExit, onEndNativeSession }) => {
  const [context, setContext] = useState<NativeHubOperatorContext | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [endingNativeSession, setEndingNativeSession] = useState(false);
  const [pendingTransitionRequests, setPendingTransitionRequests] = useState<Record<string, PendingTransitionRequest>>({});
  const [message, setMessage] = useState<string | null>(null);

  const refreshNativeState = useCallback(async () => {
    const [operator] = await Promise.all([
      localHubRuntime.getNativeOperatorContext(),
      localHubRuntime.refresh().catch(() => undefined),
    ]);
    setContext(operator);
    setPendingTransitionRequests(recoveredTransitionRequests(operator));
    setHealth(localHubRuntime.getNetworkHealth());
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        await refreshNativeState();
        if (!mounted) return;
        unsubscribe = localHubRuntime.subscribe((snapshot) => {
          if (mounted) setHealth(snapshot.networkHealth);
        });
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : 'The native Kitchen workspace is unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [refreshNativeState]);

  const refresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      await refreshNativeState();
      setMessage('The measured local Kitchen queue was refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Kitchen queue could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const kitchenOrders = context?.pendingKitchenOrders || [];

  const submitTransition = async (order: KitchenOrder, requestedStatus: KitchenTargetStatus) => {
    setBusyOrderId(order.id);
    setMessage(null);
    let request = pendingTransitionRequests[order.id];
    try {
      if (request && request.targetStatus !== requestedStatus) {
        throw new Error('Resolve the preserved native transition request before requesting another status for this order.');
      }
      if (!request) {
        request = {
          commandId: createRequestUuid(),
          type: 'order.status.transition',
          orderId: order.id,
          targetStatus: requestedStatus,
          payload: { orderId: order.id, status: requestedStatus },
        };
        setPendingTransitionRequests((current) => ({ ...current, [order.id]: request }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingTransitionRequests((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await refreshNativeState();
      const label = requestedStatus === 'PREPARING' ? 'Preparation started' : 'Order marked ready';
      setMessage(
        receipt.outcome === 'DUPLICATE'
          ? `The exact ${label.toLowerCase()} request was already committed locally; no second status transition was written.`
          : `${label} locally for order ${order.id.slice(0, 8)}. ${receipt.outboxIds.length} event(s) remain queued until cloud acknowledgement if the link is unavailable.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not commit this Kitchen transition. The same request can be retried safely.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const abandonTransition = async (order: KitchenOrder) => {
    const request = pendingTransitionRequests[order.id];
    if (!request) return;
    setBusyOrderId(order.id);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(request.commandId);
      await refreshNativeState();
      setMessage(discarded
        ? `The native Hub confirmed that the transition request for order ${order.id.slice(0, 8)} had no receipt and abandoned only its retry reservation. No order state, event, audit fact, or outbox record was removed.`
        : 'That transition request no longer has an uncommitted native reservation. The measured Hub state was refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not safely abandon this Kitchen transition request.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const endNativeSession = async () => {
    setEndingNativeSession(true);
    setMessage(null);
    try {
      await onEndNativeSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native staff session could not be ended safely.');
    } finally {
      setEndingNativeSession(false);
    }
  };

  const cloudState = health?.cloudStatus || 'UNKNOWN';
  const cloudIcon = cloudState === 'CONNECTED' ? <Cloud className="h-4 w-4" aria-hidden="true" /> : <CloudOff className="h-4 w-4" aria-hidden="true" />;

  if (loading) {
    return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><p className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm">Opening the measured native Kitchen workspace…</p></main>;
  }

  if (!context || context.role !== 'KITCHEN_STAFF') {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <section className="mx-auto max-w-lg space-y-5 rounded-3xl border border-amber-500/30 bg-slate-900 p-6">
          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">Native role surface unavailable</span>
          <h1 className="text-xl font-bold">This active native session does not have a Kitchen workspace.</h1>
          <p className="text-sm leading-relaxed text-slate-300">{message || 'Sign in as Kitchen Staff on the Android Hub. This workspace never accepts a browser-selected role.'}</p>
          <button type="button" onClick={onExit} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-white">Return to native sign-in</button>
          <button type="button" onClick={() => void endNativeSession()} disabled={endingNativeSession} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">End native staff session</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onExit} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-slate-200 hover:bg-slate-800" aria-label="Return to native station access"><ArrowLeft className="h-5 w-5" /></button>
            <span className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-2.5 text-orange-200"><ChefHat className="h-6 w-6" aria-hidden="true" /></span>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Native Kitchen Hub</p>
              <h1 className="text-xl font-black">Hello, {context.staffName}</h1>
              <p className="mt-0.5 text-xs text-slate-400">Branch-scoped local preparation queue</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void refresh()} disabled={refreshing || busyOrderId !== null} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh local queue
            </button>
            <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${cloudState === 'CONNECTED' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-amber-500/30 bg-amber-500/10 text-amber-100'}`}>
              {cloudIcon}
              <span><strong className="block">Cloud {cloudState.toLowerCase()}</strong><small className="block">{health?.outboxDepth || 0} local event(s) awaiting acknowledgement</small></span>
            </div>
          </div>
        </header>

        {message ? <p className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm leading-relaxed text-slate-300" role="status">{message}</p> : null}

        <section className="flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p><strong>Local task boundary:</strong> these tickets are committed local Hub facts. A status change is not proof that a printer, remote Kitchen display, customer, or cloud receiver has received it.</p>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-200"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <h2 className="font-bold">Measured local queue</h2>
              <p className="text-xs text-slate-400">Only PLACED and PREPARING orders from this Hub’s active branch are shown.</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-sm font-bold text-slate-100">{kitchenOrders.length} active</span>
        </section>

        {kitchenOrders.length === 0 ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
            <CircleCheck className="mx-auto h-9 w-9 text-emerald-300" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold">No active local Kitchen tickets</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-400">No branch-scoped `PLACED` or `PREPARING` order is currently committed on this Hub. Refresh only reads the measured local state; it does not fetch or invent a remote queue.</p>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2" aria-label="Active local Kitchen tickets">
            {kitchenOrders.map((order) => {
              const action = actionFor(order);
              const ActionIcon = action.icon;
              const pendingRequest = pendingTransitionRequests[order.id];
              const isBusy = busyOrderId === order.id;
              return (
                <article key={order.id} className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Local order {order.id.slice(0, 8)}</p>
                      <h3 className="mt-1 text-lg font-black text-slate-50">{order.status === 'PLACED' ? 'Waiting to prepare' : 'Preparing locally'}</h3>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${order.status === 'PLACED' ? 'border-orange-500/30 bg-orange-500/10 text-orange-100' : 'border-sky-500/30 bg-sky-500/10 text-sky-100'}`}>{order.status}</span>
                  </div>

                  <ul className="mt-4 space-y-2 border-y border-slate-800 py-4" aria-label={`Items for order ${order.id.slice(0, 8)}`}>
                    {order.items.map((item) => (
                      <li key={item.productId} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-slate-200">{item.name}</span>
                        <strong className="shrink-0 text-slate-50">× {item.quantity}</strong>
                      </li>
                    ))}
                  </ul>

                  {pendingRequest ? (
                    <div className="mt-4 space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                      <p className="text-xs leading-relaxed text-amber-100">An exact native {pendingRequest.targetStatus} request was reserved before signing and has no receipt yet. Do not create a replacement transition.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void submitTransition(order, pendingRequest.targetStatus)} disabled={isBusy || refreshing} className="inline-flex items-center gap-2 rounded-xl bg-amber-300 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50">
                          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry exact native request
                        </button>
                        <button type="button" onClick={() => void abandonTransition(order)} disabled={isBusy || refreshing} className="rounded-xl border border-amber-300/50 px-3 py-2 text-xs font-bold text-amber-50 hover:bg-amber-100/10 disabled:cursor-not-allowed disabled:opacity-50">Abandon only if native confirms it never committed</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => void submitTransition(order, action.status)} disabled={isBusy || refreshing} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50">
                      <ActionIcon className="h-4 w-4" aria-hidden="true" /> {action.label}
                    </button>
                  )}
                </article>
              );
            })}
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-slate-500">
          <span>Kitchen authority is limited to preparation and ready-state transitions.</span>
          <button type="button" onClick={() => void endNativeSession()} disabled={endingNativeSession || busyOrderId !== null} className="font-semibold text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">{endingNativeSession ? 'Ending native staff session…' : 'End native staff session'}</button>
        </footer>
      </div>
    </main>
  );
};
