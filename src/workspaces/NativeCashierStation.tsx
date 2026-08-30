import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Cloud, CloudOff, Minus, Plus, ReceiptText, RefreshCw, ShieldCheck, ShoppingBasket, WifiOff, XCircle } from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
import type { NativeHubCommandRequest, NativeHubOperatorContext, NetworkHealth } from '@plugos/core';

interface NativeCashierStationProps {
  onExit: () => void;
  onEndNativeSession: () => Promise<void>;
}

type BasketLine = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
};

type PendingRequest = NativeHubCommandRequest & { orderId: string };
type PendingPaymentRequest = NativeHubCommandRequest & { orderId: string; paymentId: string };
type PendingCollectionRequest = NativeHubCommandRequest & { orderId: string };
type PendingCancellationRequest = NativeHubCommandRequest & { orderId: string };

const money = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

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

function parseMoney(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Enter a cash amount with no more than two decimal places.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999_999.99) throw new Error('The cash amount is outside the supported local range.');
  return roundMoney(parsed);
}

function recoveredOrderRequest(context: NativeHubOperatorContext): PendingRequest | null {
  const command = (context.recoverableNativeCommands || []).find((candidate) => candidate.type === 'order.create');
  if (!command || typeof command.payload.orderId !== 'string') return null;
  return { ...command, orderId: command.payload.orderId };
}

function recoveredPaymentRequests(context: NativeHubOperatorContext): Record<string, PendingPaymentRequest> {
  return (context.recoverableNativeCommands || []).reduce<Record<string, PendingPaymentRequest>>((requests, command) => {
    if (command.type !== 'payment.capture' || typeof command.payload.orderId !== 'string' || typeof command.payload.paymentId !== 'string') {
      return requests;
    }
    requests[command.payload.orderId] = {
      ...command,
      orderId: command.payload.orderId,
      paymentId: command.payload.paymentId,
    };
    return requests;
  }, {});
}

function recoveredCollectionRequests(context: NativeHubOperatorContext): Record<string, PendingCollectionRequest> {
  return (context.recoverableNativeCommands || []).reduce<Record<string, PendingCollectionRequest>>((requests, command) => {
    const orderId = command.payload.orderId;
    if (command.type !== 'order.status.transition' || typeof orderId !== 'string' || command.payload.status !== 'COLLECTED') {
      return requests;
    }
    if (requests[orderId] && requests[orderId].commandId !== command.commandId) {
      throw new Error(`The native Hub has more than one unresolved collection request for order ${orderId.slice(0, 8)}. Reconcile the measured native state before requesting collection.`);
    }
    requests[orderId] = { ...command, orderId };
    return requests;
  }, {});
}

function recoveredCancellationRequests(context: NativeHubOperatorContext): Record<string, PendingCancellationRequest> {
  return (context.recoverableNativeCommands || []).reduce<Record<string, PendingCancellationRequest>>((requests, command) => {
    const orderId = command.payload.orderId;
    if (command.type !== 'order.status.transition' || typeof orderId !== 'string' || command.payload.status !== 'CANCELLED') {
      return requests;
    }
    if (requests[orderId] && requests[orderId].commandId !== command.commandId) {
      throw new Error(`The native Hub has more than one unresolved cancellation request for order ${orderId.slice(0, 8)}. Reconcile the measured native state before requesting cancellation.`);
    }
    requests[orderId] = { ...command, orderId };
    return requests;
  }, {});
}

/**
 * First genuine cashier slice. Every menu value comes from the signed Hub
 * snapshot and every order moves through the native command request bridge;
 * there is no direct browser Supabase mutation or local-array order authority.
 */
export const NativeCashierStation: React.FC<NativeCashierStationProps> = ({ onExit, onEndNativeSession }) => {
  const [context, setContext] = useState<NativeHubOperatorContext | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [pendingPaymentRequests, setPendingPaymentRequests] = useState<Record<string, PendingPaymentRequest>>({});
  const [pendingCollectionRequests, setPendingCollectionRequests] = useState<Record<string, PendingCollectionRequest>>({});
  const [pendingCancellationRequests, setPendingCancellationRequests] = useState<Record<string, PendingCancellationRequest>>({});
  const [cashTenderedByOrder, setCashTenderedByOrder] = useState<Record<string, string>>({});
  const [capturingOrderId, setCapturingOrderId] = useState<string | null>(null);
  const [collectingOrderId, setCollectingOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [endingNativeSession, setEndingNativeSession] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshNativeState = useCallback(async () => {
    const [operator] = await Promise.all([
      localHubRuntime.getNativeOperatorContext(),
      localHubRuntime.refresh().catch(() => undefined),
    ]);
    setContext(operator);
    setPendingRequest(recoveredOrderRequest(operator));
    setPendingPaymentRequests(recoveredPaymentRequests(operator));
    setPendingCollectionRequests(recoveredCollectionRequests(operator));
    setPendingCancellationRequests(recoveredCancellationRequests(operator));
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
        if (mounted) setMessage(error instanceof Error ? error.message : 'The native operator station is unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [refreshNativeState]);

  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (context?.catalogProducts || []).filter((product) =>
      !term || product.name.toLowerCase().includes(term) || product.category.toLowerCase().includes(term)
    );
  }, [context?.catalogProducts, search]);
  const subtotal = basket.reduce((total, line) => total + line.price * line.quantity, 0);
  const tax = context?.vat.enabled ? subtotal * (context.vat.rate / 100) : 0;
  const total = subtotal + tax;

  const addProduct = (product: NonNullable<NativeHubOperatorContext>['catalogProducts'][number]) => {
    if (pendingRequest) {
      setMessage('Resolve the preserved native order request before changing this draft. Retry it exactly, or use the native-confirmed abandonment path.');
      return;
    }
    // This first cashier slice has whole-unit touch controls. The native Hub
    // remains authoritative and rechecks the exact signed decimal balance,
    // but the UI should not knowingly construct an impossible reservation.
    const maximumWholeUnits = Math.floor(Math.max(0, product.stockQuantity));
    setBasket((current) => {
      const found = current.find((line) => line.productId === product.id);
      if (maximumWholeUnits < 1 || (found && found.quantity >= maximumWholeUnits)) return current;
      return found
        ? current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { productId: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
  };

  const changeQuantity = (productId: string, change: number) => {
    if (pendingRequest) {
      setMessage('Resolve the preserved native order request before changing this draft. Retry it exactly, or use the native-confirmed abandonment path.');
      return;
    }
    const product = context?.catalogProducts.find((candidate) => candidate.id === productId);
    const maximumWholeUnits = product ? Math.floor(Math.max(0, product.stockQuantity)) : null;
    setBasket((current) => current.flatMap((line) => {
      if (line.productId !== productId) return [line];
      if (change > 0 && (maximumWholeUnits === null || maximumWholeUnits < line.quantity)) return [line];
      const quantity = change > 0
        ? Math.min(line.quantity + change, maximumWholeUnits ?? line.quantity)
        : line.quantity + change;
      return quantity > 0 ? [{ ...line, quantity }] : [];
    }));
  };

  const buildRequest = (): PendingRequest => {
    if (!context || basket.length === 0) throw new Error('Add at least one signed catalog item before creating an order.');
    if (!context.activeCashShift) throw new Error('A Manager must open the measured branch cash shift before a Cashier can create an order.');
    const orderId = createRequestUuid();
    return {
      commandId: createRequestUuid(),
      orderId,
      type: 'order.create',
      payload: {
        orderId,
        items: basket.map((line) => ({
          productId: line.productId,
          name: line.name,
          price: line.price,
          quantity: line.quantity,
        })),
        subtotal: roundMoney(subtotal),
        tax: roundMoney(tax),
        totalAmount: roundMoney(total),
        paymentMethod: 'CASH',
        paymentType: 'CASH',
      },
    };
  };

  const submit = async (request: PendingRequest) => {
    setSubmitting(true);
    setMessage(null);
    try {
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingRequest(null);
      setBasket([]);
      await refreshNativeState();
      setMessage(
        receipt.outcome === 'DUPLICATE'
          ? `The exact request was already committed locally at ${new Date(receipt.committedAt).toLocaleTimeString()}; no second order was created.`
          : `Order ${request.orderId.slice(0, 8)} was committed locally with its signed stock reservation. ${receipt.outboxIds.length} event(s) await cloud acknowledgement if the cloud link is unavailable.`
      );
    } catch (error) {
      setPendingRequest(request);
      setMessage(error instanceof Error ? error.message : 'The native Hub could not commit this order. The same request can be retried safely.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCurrentOrder = async () => {
    try {
      await submit(pendingRequest || buildRequest());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The order request could not be prepared.');
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

  const abandonPendingOrderRequest = async () => {
    if (!pendingRequest) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(pendingRequest.commandId);
      await refreshNativeState();
      setMessage(discarded
        ? 'The native Hub confirmed that this order request had no receipt and abandoned only its retry reservation. No order, stock reservation, event, or outbox record was removed.'
        : 'That order request no longer has an uncommitted native reservation. The measured Hub state was refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not safely abandon this order request.');
    } finally {
      setSubmitting(false);
    }
  };

  const captureCashPayment = async (order: NonNullable<NativeHubOperatorContext>['pendingCashOrders'][number]) => {
    setCapturingOrderId(order.id);
    setMessage(null);
    let request = pendingPaymentRequests[order.id];
    try {
      if (!request) {
        const cashTendered = parseMoney(cashTenderedByOrder[order.id] ?? order.totalAmount.toFixed(2));
        const paymentId = createRequestUuid();
        request = {
          commandId: createRequestUuid(),
          paymentId,
          orderId: order.id,
          type: 'payment.capture',
          payload: { paymentId, orderId: order.id, cashTendered },
        };
        setPendingPaymentRequests((current) => ({ ...current, [order.id]: request }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingPaymentRequests((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await refreshNativeState();
      setMessage(
        receipt.outcome === 'DUPLICATE'
          ? `The exact cash capture for order ${order.id.slice(0, 8)} was already committed locally; no second payment or drawer posting was created.`
          : `Cash payment for order ${order.id.slice(0, 8)} was committed locally. It is queued for cloud acknowledgement until the receiver acknowledges its exact event ID.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not capture this cash payment. The same request can be retried safely.');
    } finally {
      setCapturingOrderId(null);
    }
  };

  const abandonPendingCashCapture = async (order: NonNullable<NativeHubOperatorContext>['pendingCashOrders'][number]) => {
    const request = pendingPaymentRequests[order.id];
    if (!request) return;
    setCapturingOrderId(order.id);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(request.commandId);
      await refreshNativeState();
      setMessage(discarded
        ? `The native Hub confirmed that the cash capture for order ${order.id.slice(0, 8)} had no receipt and abandoned only its retry reservation. No payment or drawer posting was removed.`
        : `That cash-capture request no longer has an uncommitted native reservation. The measured Hub state was refreshed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not safely abandon this cash-capture request.');
    } finally {
      setCapturingOrderId(null);
    }
  };

  const collectReadyOrder = async (order: NonNullable<NativeHubOperatorContext>['readyForCollectionOrders'][number]) => {
    setCollectingOrderId(order.id);
    setMessage(null);
    let request = pendingCollectionRequests[order.id];
    try {
      if (!request) {
        request = {
          commandId: createRequestUuid(),
          orderId: order.id,
          type: 'order.status.transition',
          payload: { orderId: order.id, status: 'COLLECTED' },
        };
        setPendingCollectionRequests((current) => ({ ...current, [order.id]: request }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingCollectionRequests((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await refreshNativeState();
      setMessage(
        receipt.outcome === 'DUPLICATE'
          ? `The exact collection request for order ${order.id.slice(0, 8)} was already committed locally; no second collection transition was written.`
          : `Order ${order.id.slice(0, 8)} was marked collected locally. ${receipt.outboxIds.length} event(s) remain queued until cloud acknowledgement if the link is unavailable.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not commit this collection transition. The same request can be retried safely.');
    } finally {
      setCollectingOrderId(null);
    }
  };

  const abandonPendingCollection = async (order: NonNullable<NativeHubOperatorContext>['readyForCollectionOrders'][number]) => {
    const request = pendingCollectionRequests[order.id];
    if (!request) return;
    setCollectingOrderId(order.id);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(request.commandId);
      await refreshNativeState();
      setMessage(discarded
        ? `The native Hub confirmed that the collection request for order ${order.id.slice(0, 8)} had no receipt and abandoned only its retry reservation. No collection event, order state, audit fact, or outbox record was removed.`
        : 'That collection request no longer has an uncommitted native reservation. The measured Hub state was refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not safely abandon this collection request.');
    } finally {
      setCollectingOrderId(null);
    }
  };

  const cancelPendingOrder = async (order: NonNullable<NativeHubOperatorContext>['pendingCashOrders'][number]) => {
    setCancellingOrderId(order.id);
    setMessage(null);
    let request = pendingCancellationRequests[order.id];
    try {
      if (!request) {
        if (order.status !== 'PLACED') {
          throw new Error('A Cashier can cancel only an unprepared pending order. Ask a Manager to resolve a preparing order.');
        }
        request = {
          commandId: createRequestUuid(),
          orderId: order.id,
          type: 'order.status.transition',
          payload: { orderId: order.id, status: 'CANCELLED' },
        };
        setPendingCancellationRequests((current) => ({ ...current, [order.id]: request }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingCancellationRequests((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await refreshNativeState();
      setMessage(
        receipt.outcome === 'DUPLICATE'
          ? `The exact cancellation request for order ${order.id.slice(0, 8)} was already committed locally; no second cancellation transition was written.`
          : `Order ${order.id.slice(0, 8)} was cancelled locally. ${receipt.outboxIds.length} event(s) remain queued until cloud acknowledgement if the link is unavailable.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not cancel this order. The same request can be retried safely.');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const abandonPendingCancellation = async (order: NonNullable<NativeHubOperatorContext>['pendingCashOrders'][number]) => {
    const request = pendingCancellationRequests[order.id];
    if (!request) return;
    setCancellingOrderId(order.id);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(request.commandId);
      await refreshNativeState();
      setMessage(discarded
        ? `The native Hub confirmed that the cancellation request for order ${order.id.slice(0, 8)} had no receipt and abandoned only its retry reservation. No cancellation event, order state, stock fact, audit fact, or outbox record was removed.`
        : 'That cancellation request no longer has an uncommitted native reservation. The measured Hub state was refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native Hub could not safely abandon this cancellation request.');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const cloudState = health?.cloudStatus || 'UNKNOWN';
  const peerTransportActive = health?.activeTransport === 'LAN_WIFI';
  const cloudIcon = cloudState === 'CONNECTED' ? <Cloud className="h-4 w-4" aria-hidden="true" /> : <CloudOff className="h-4 w-4" aria-hidden="true" />;
  const activeCashShift = context?.activeCashShift || null;
  const pendingCashOrders = context?.pendingCashOrders || [];
  const readyForCollectionOrders = context?.readyForCollectionOrders || [];
  const busy = submitting || capturingOrderId !== null || collectingOrderId !== null || cancellingOrderId !== null;

  if (loading) {
    return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><p className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm">Opening the measured native Hub station…</p></main>;
  }

  if (!context || context.role !== 'CASHIER') {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <section className="mx-auto max-w-lg space-y-5 rounded-3xl border border-amber-500/30 bg-slate-900 p-6">
          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">Native role surface unavailable</span>
          <h1 className="text-xl font-bold">This active native session does not have a Cashier workspace yet.</h1>
          <p className="text-sm leading-relaxed text-slate-300">{message || 'Sign in as a Cashier on the Android Hub. Kitchen, Manager, Owner, and Administrator operational surfaces remain disabled until their own atomic command contracts are complete.'}</p>
          <button type="button" onClick={onExit} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-white">Return to native sign-in</button>
          <button type="button" onClick={() => void endNativeSession()} disabled={endingNativeSession} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">End native staff session</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onExit} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-slate-200 hover:bg-slate-800" aria-label="Return to native station access"><ArrowLeft className="h-5 w-5" /></button>
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-300"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Native Cashier Hub</p>
              <h1 className="text-xl font-black">Hello, {context.staffName}</h1>
              <p className="mt-0.5 text-xs text-slate-400">Signed catalog snapshot · local command authority</p>
            </div>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${cloudState === 'CONNECTED' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-amber-500/30 bg-amber-500/10 text-amber-100'}`}>
            {cloudIcon}
            <span><strong className="block">Cloud {cloudState.toLowerCase()}</strong><small className="block">{health?.outboxDepth || 0} locally committed event(s) awaiting acknowledgement</small><small className="block">{peerTransportActive ? 'Paired LAN transport active' : 'Paired LAN transport unavailable; this Hub remains local authority'}</small></span>
          </div>
        </header>

        {message && <p className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm leading-relaxed text-slate-300" role="status">{message}</p>}

        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100">
          <strong>Capture boundary:</strong> this station can commit a cash payment only inside a Manager-opened measured cash shift. Card and SpazaPay QR remain tender intents only; no provider adapter exists here, so this interface will not claim they are settled.
        </section>

        {activeCashShift ? (
          <section className="grid gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm sm:grid-cols-3">
            <div><span className="block text-xs text-emerald-200/70">Cash shift</span><strong className="block text-emerald-50">Open locally</strong></div>
            <div><span className="block text-xs text-emerald-200/70">Expected drawer cash</span><strong className="block text-emerald-50">{money.format(activeCashShift.expectedCash)}</strong></div>
            <div><span className="block text-xs text-emerald-200/70">Captured cash sales</span><strong className="block text-emerald-50">{money.format(activeCashShift.cashSalesTotal)}</strong></div>
          </section>
        ) : (
          <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm leading-relaxed text-rose-100">
            <strong>Cash shift required:</strong> a Manager must open the native branch cash shift before this Cashier can create an order or take cash. This station will not invent a drawer or treat browser state as a shift.
          </section>
        )}

        {pendingCashOrders.length > 0 && (
          <section className="space-y-4 rounded-3xl border border-emerald-500/30 bg-slate-900 p-5">
            <div><h2 className="text-lg font-bold">Cash capture queue</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">These are your locally committed cash orders that still need one native capture. Enter what the customer handed over; the Hub derives the captured amount and change.</p></div>
            <div className="grid gap-3 lg:grid-cols-2">
              {pendingCashOrders.map((order) => {
                const pendingCapture = pendingPaymentRequests[order.id];
                const pendingCancellation = pendingCancellationRequests[order.id];
                const isCapturing = capturingOrderId === order.id;
                const isCancelling = cancellingOrderId === order.id;
                return (
                  <article key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-start justify-between gap-3"><div><span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{order.status} · cash pending</span><strong className="mt-1 block text-sm text-slate-100">Order {order.id.slice(0, 8)}</strong></div><strong className="text-base text-emerald-300">{money.format(order.totalAmount)}</strong></div>
                    <label className="mt-4 block text-xs font-semibold text-slate-300">Cash tendered<input inputMode="decimal" value={cashTenderedByOrder[order.id] ?? order.totalAmount.toFixed(2)} disabled={busy || Boolean(pendingCapture) || Boolean(pendingCancellation)} onChange={(event) => { setCashTenderedByOrder((current) => ({ ...current, [order.id]: event.target.value })); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 disabled:opacity-50" /></label>
                    <button type="button" disabled={busy || !activeCashShift || Boolean(pendingCancellation)} onClick={() => void captureCashPayment(order)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"><ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />{isCapturing ? 'Capturing locally…' : pendingCapture ? 'Retry the same cash capture' : 'Capture cash locally'}</button>
                    {pendingCapture && <button type="button" disabled={busy} onClick={() => void abandonPendingCashCapture(order)} className="mt-2 w-full text-xs font-semibold text-amber-200 hover:text-amber-100">Abandon only if native confirms it never committed</button>}
                    {(order.status === 'PLACED' || pendingCancellation) && <div className="mt-3 border-t border-slate-800 pt-3"><p className="text-[11px] leading-relaxed text-slate-500">Only an unprepared pending order may be cancelled by this Cashier. A preparing order must be resolved by a Manager.</p><button type="button" disabled={busy} onClick={() => void cancelPendingOrder(order)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-black text-rose-100 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"><XCircle className="h-3.5 w-3.5" aria-hidden="true" />{isCancelling ? 'Cancelling locally…' : pendingCancellation ? 'Retry the same cancellation request' : 'Cancel unprepared order locally'}</button>{pendingCancellation && <button type="button" disabled={busy} onClick={() => void abandonPendingCancellation(order)} className="mt-2 w-full text-xs font-semibold text-amber-200 hover:text-amber-100">Abandon only if native confirms it never committed</button>}</div>}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {readyForCollectionOrders.length > 0 && (
          <section className="space-y-4 rounded-3xl border border-sky-500/30 bg-slate-900 p-5">
            <div><h2 className="text-lg font-bold">Ready for customer collection</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">These branch-scoped orders are locally READY and have a captured cash fact. Marking one collected records the final local order transition; it is not proof of printing, notification, cloud acknowledgement, or physical handover.</p></div>
            <div className="grid gap-3 lg:grid-cols-2">
              {readyForCollectionOrders.map((order) => {
                const pendingCollection = pendingCollectionRequests[order.id];
                const isCollecting = collectingOrderId === order.id;
                return (
                  <article key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-start justify-between gap-3"><div><span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Ready · cash captured</span><strong className="mt-1 block text-sm text-slate-100">Order {order.id.slice(0, 8)}</strong></div><span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-100">READY</span></div>
                    <button type="button" disabled={busy} onClick={() => void collectReadyOrder(order)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"><ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />{isCollecting ? 'Marking collected locally…' : pendingCollection ? 'Retry the same collection request' : 'Mark collected locally'}</button>
                    {pendingCollection && <button type="button" disabled={busy} onClick={() => void abandonPendingCollection(order)} className="mt-2 w-full text-xs font-semibold text-amber-200 hover:text-amber-100">Abandon only if native confirms it never committed</button>}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Signed menu</h2>
                <p className="text-xs text-slate-400">The Hub recalculates each price and VAT amount before committing.</p>
              </div>
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 sm:w-64" placeholder="Find menu item" aria-label="Find signed menu item" />
            </div>
            {products.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((product) => (
                  <button key={product.id} type="button" disabled={busy || Boolean(pendingRequest) || product.stockQuantity < 1} onClick={() => addProduct(product)} className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-left transition hover:border-emerald-500/50 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{product.category}</span>
                    <strong className="mt-1 block text-sm text-slate-100">{product.name}</strong>
                    <span className="mt-3 block text-base font-bold text-emerald-300">{money.format(product.price)}</span>
                    <small className="mt-1 block text-xs text-slate-500">{product.stockQuantity} {product.unit} available in the signed Hub snapshot</small>
                  </button>
                ))}
              </div>
            ) : <p className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-sm text-slate-400">No active signed catalog products match this search.</p>}
          </section>

          <aside className="h-fit rounded-3xl border border-slate-800 bg-slate-900 p-5 lg:sticky lg:top-5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2"><ShoppingBasket className="h-5 w-5 text-emerald-300" aria-hidden="true" /><h2 className="text-lg font-bold">Order draft</h2></div>
              <span className="text-xs text-slate-500">{basket.reduce((count, line) => count + line.quantity, 0)} item(s)</span>
            </div>
            <div className="max-h-72 space-y-3 overflow-auto py-4">
              {basket.length ? basket.map((line) => (
                <div key={line.productId} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex justify-between gap-3"><strong className="text-sm">{line.name}</strong><span className="text-sm font-semibold text-emerald-300">{money.format(line.price * line.quantity)}</span></div>
                  <div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-500">{money.format(line.price)} each</span><span className="inline-flex items-center gap-2"><button type="button" disabled={busy || Boolean(pendingRequest)} onClick={() => changeQuantity(line.productId, -1)} className="rounded-lg border border-slate-700 p-1 text-slate-200 hover:bg-slate-900 disabled:opacity-50" aria-label={`Remove one ${line.name}`}><Minus className="h-3.5 w-3.5" /></button><strong className="w-5 text-center text-sm">{line.quantity}</strong><button type="button" disabled={busy || Boolean(pendingRequest)} onClick={() => changeQuantity(line.productId, 1)} className="rounded-lg border border-slate-700 p-1 text-slate-200 hover:bg-slate-900 disabled:opacity-50" aria-label={`Add one ${line.name}`}><Plus className="h-3.5 w-3.5" /></button></span></div>
                </div>
              )) : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">Choose signed menu items to begin.</p>}
            </div>
            <div className="border-t border-slate-800 pt-4 text-xs font-semibold text-slate-300">Capture-enabled tender
              <p className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-100"><strong>Cash only.</strong> Card and SpazaPay QR need a verified provider adapter before this station can record a capture.</p>
            </div>
            <dl className="mt-4 space-y-2 border-t border-slate-800 pt-4 text-sm"><div className="flex justify-between text-slate-400"><dt>Subtotal</dt><dd>{money.format(subtotal)}</dd></div><div className="flex justify-between text-slate-400"><dt>VAT {context.vat.enabled ? `(${context.vat.rate}%)` : '(not enabled)'}</dt><dd>{money.format(tax)}</dd></div><div className="flex justify-between text-base font-black text-slate-100"><dt>Order total</dt><dd>{money.format(total)}</dd></div></dl>
            <button type="button" disabled={(!basket.length && !pendingRequest) || busy || !activeCashShift} onClick={() => void submitCurrentOrder()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"><ReceiptText className="h-4 w-4" aria-hidden="true" />{submitting ? 'Committing locally…' : pendingRequest ? 'Retry the preserved native request' : 'Commit order locally'}</button>
            {pendingRequest && <button type="button" disabled={busy} onClick={() => void abandonPendingOrderRequest()} className="mt-3 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50">Abandon only if native confirms it never committed</button>}
            <button type="button" onClick={() => void refreshNativeState().catch((error) => setMessage(error instanceof Error ? error.message : 'Native state could not be refreshed.'))} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-800"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Refresh measured Hub state</button>
            <button type="button" onClick={() => void endNativeSession()} disabled={endingNativeSession || busy} className="mt-3 flex w-full items-center justify-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"><WifiOff className="h-3.5 w-3.5" aria-hidden="true" />{endingNativeSession ? 'Ending native staff session…' : 'End native staff session'}</button>
          </aside>
        </div>
      </div>
    </main>
  );
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
