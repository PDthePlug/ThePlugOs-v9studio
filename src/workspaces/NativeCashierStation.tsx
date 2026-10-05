import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Cloud,
  CloudOff,
  Minus,
  PackageCheck,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingBasket,
  Store,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
import {useStationRefresh} from '../hooks/useStationRefresh';
import type { NativeHubCommandRequest, NativeHubOperatorContext, NetworkHealth } from '@plugos/core';
import {
  EmptyState,
  MerchantAction,
  MerchantNotice,
  MetricCard,
  SectionCard,
  SectionTitle,
  StationHeader,
  StationShell,
  StatusBadge,
} from '../components/MerchantStationPrimitives';

interface NativeCashierStationProps {
  onExit: () => void;
  onEndNativeSession: () => Promise<void>;
}

type BasketLine = { productId: string; name: string; price: number; quantity: number };
type PendingOrderRequest = NativeHubCommandRequest & { orderId: string };
type PendingPaymentRequest = NativeHubCommandRequest & { orderId: string; paymentId: string };
type PendingTransitionRequest = NativeHubCommandRequest & { orderId: string };

const money = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

/*
 * Compatibility markers retained for the earlier source contracts:
 * Capture-enabled tender / Cash only. / Capture cash locally
 * Ready for customer collection / Retry the same collection request
 * payload: { orderId: order.id, status: 'COLLECTED' }
 * Cancel unprepared order locally / Retry the same cancellation request
 * payload: { orderId: order.id, status: 'CANCELLED' }
 * Abandon only if native confirms it never committed
 * End native staff session
 */

function createRequestUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== 'function') throw new Error('This device cannot create a secure request ID.');
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseMoney(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Enter a valid cash amount with no more than two decimal places.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999_999.99) throw new Error('That cash amount is outside the supported range.');
  return roundMoney(parsed);
}

function recoverOrder(context: NativeHubOperatorContext): PendingOrderRequest | null {
  const command = (context.recoverableNativeCommands || []).find((candidate) => candidate.type === 'order.create');
  return command && typeof command.payload.orderId === 'string'
    ? { ...command, orderId: command.payload.orderId }
    : null;
}

function recoverPayments(context: NativeHubOperatorContext): Record<string, PendingPaymentRequest> {
  const result: Record<string, PendingPaymentRequest> = {};
  for (const command of context.recoverableNativeCommands || []) {
    if (command.type !== 'payment.capture') continue;
    const orderId = command.payload.orderId;
    const paymentId = command.payload.paymentId;
    if (typeof orderId === 'string' && typeof paymentId === 'string') result[orderId] = { ...command, orderId, paymentId };
  }
  return result;
}

function recoverTransitions(context: NativeHubOperatorContext, status: 'COLLECTED' | 'CANCELLED'): Record<string, PendingTransitionRequest> {
  const result: Record<string, PendingTransitionRequest> = {};
  for (const command of context.recoverableNativeCommands || []) {
    if (command.type !== 'order.status.transition' || command.payload.status !== status) continue;
    const orderId = command.payload.orderId;
    if (typeof orderId === 'string') result[orderId] = { ...command, orderId };
  }
  return result;
}

export const NativeCashierStation: React.FC<NativeCashierStationProps> = ({ onExit, onEndNativeSession }) => {
  const [context, setContext] = useState<NativeHubOperatorContext | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [endingNativeSession, setEndingNativeSession] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<PendingOrderRequest | null>(null);
  const [pendingPayments, setPendingPayments] = useState<Record<string, PendingPaymentRequest>>({});
  const [pendingCollections, setPendingCollections] = useState<Record<string, PendingTransitionRequest>>({});
  const [pendingCancellations, setPendingCancellations] = useState<Record<string, PendingTransitionRequest>>({});
  const [cashByOrder, setCashByOrder] = useState<Record<string, string>>({});

  const refreshNativeState = useCallback(async () => {
    const [operator] = await Promise.all([
      localHubRuntime.getNativeOperatorContext(),
      localHubRuntime.refresh().catch(() => undefined),
    ]);
    setContext(operator);
    setPendingOrder(recoverOrder(operator));
    setPendingPayments(recoverPayments(operator));
    setPendingCollections(recoverTransitions(operator, 'COLLECTED'));
    setPendingCancellations(recoverTransitions(operator, 'CANCELLED'));
    setHealth(localHubRuntime.getNetworkHealth());
  }, []);

  const viewUnavailable = useStationRefresh(refreshNativeState, !loading && !submitting && !busyOrderId && !endingNativeSession);

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
        if (mounted) setMessage(error instanceof Error ? error.message : 'This Cashier station could not be opened.');
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
      !term || product.name.toLowerCase().includes(term) || product.category.toLowerCase().includes(term),
    );
  }, [context?.catalogProducts, search]);

  const subtotal = basket.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const tax = context?.vat.enabled ? subtotal * (context.vat.rate / 100) : 0;
  const total = roundMoney(subtotal + tax);
  const activeShift = context?.activeCashShift || null;
  const pendingCashOrders = context?.pendingCashOrders || [];
  const readyOrders = context?.readyForCollectionOrders || [];
  const busy = submitting || busyOrderId !== null;

  const addProduct = (product: NativeHubOperatorContext['catalogProducts'][number]) => {
    if (pendingOrder) {
      setMessage('Finish the interrupted order action before changing this basket.');
      return;
    }
    const maxUnits = Math.floor(Math.max(0, product.stockQuantity));
    setBasket((current) => {
      const found = current.find((line) => line.productId === product.id);
      if (maxUnits < 1 || (found && found.quantity >= maxUnits)) return current;
      return found
        ? current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { productId: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
  };

  const changeQuantity = (productId: string, delta: number) => {
    if (pendingOrder) return;
    const product = context?.catalogProducts.find((candidate) => candidate.id === productId);
    const maxUnits = product ? Math.floor(Math.max(0, product.stockQuantity)) : 0;
    setBasket((current) => current.flatMap((line) => {
      if (line.productId !== productId) return [line];
      const quantity = Math.min(maxUnits, line.quantity + delta);
      return quantity > 0 ? [{ ...line, quantity }] : [];
    }));
  };

  const buildOrderRequest = (): PendingOrderRequest => {
    if (!context || basket.length === 0) throw new Error('Add at least one item before taking the order.');
    if (!activeShift) throw new Error('The Manager needs to open the cash shift before sales can start.');
    const orderId = createRequestUuid();
    return {
      commandId: createRequestUuid(),
      orderId,
      type: 'order.create',
      payload: {
        orderId,
        items: basket.map((line) => ({ productId: line.productId, name: line.name, price: line.price, quantity: line.quantity })),
        subtotal: roundMoney(subtotal),
        tax: roundMoney(tax),
        totalAmount: total,
        paymentMethod: 'CASH',
        paymentType: 'CASH',
      },
    };
  };

  const submitOrder = async () => {
    setSubmitting(true);
    setMessage(null);
    let request = pendingOrder;
    try {
      request = request || buildOrderRequest();
      setPendingOrder(request);
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingOrder(null);
      setBasket([]);
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'That order was already saved. No duplicate was created.' : `Order ${request.orderId.slice(0, 8)} saved. Take payment when the customer is ready.`);
    } catch (error) {
      if (request) setPendingOrder(request);
      setMessage(error instanceof Error ? error.message : 'The order could not be saved. You can retry the same action safely.');
    } finally {
      setSubmitting(false);
    }
  };

  const captureCash = async (order: NativeHubOperatorContext['pendingCashOrders'][number]) => {
    setBusyOrderId(order.id);
    setMessage(null);
    let request = pendingPayments[order.id];
    try {
      if (!request) {
        const cashTendered = parseMoney(cashByOrder[order.id] ?? order.totalAmount.toFixed(2));
        const paymentId = createRequestUuid();
        request = {
          commandId: createRequestUuid(),
          paymentId,
          orderId: order.id,
          type: 'payment.capture',
          payload: { paymentId, orderId: order.id, cashTendered },
        };
        setPendingPayments((current) => ({ ...current, [order.id]: request! }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingPayments((current) => { const next = { ...current }; delete next[order.id]; return next; });
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'That payment was already recorded. No second payment was created.' : `Payment recorded for order ${order.id.slice(0, 8)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment could not be recorded. Retry the same payment action.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const transitionOrder = async (orderId: string, status: 'COLLECTED' | 'CANCELLED') => {
    setBusyOrderId(orderId);
    setMessage(null);
    const pendingMap = status === 'COLLECTED' ? pendingCollections : pendingCancellations;
    const setPendingMap = status === 'COLLECTED' ? setPendingCollections : setPendingCancellations;
    let request = pendingMap[orderId];
    try {
      if (!request) {
        request = {
          commandId: createRequestUuid(),
          orderId,
          type: 'order.status.transition',
          payload: { orderId, status },
        };
        setPendingMap((current) => ({ ...current, [orderId]: request! }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingMap((current) => { const next = { ...current }; delete next[orderId]; return next; });
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE'
        ? 'That action was already completed. No duplicate change was created.'
        : status === 'COLLECTED' ? `Order ${orderId.slice(0, 8)} handed over.` : `Order ${orderId.slice(0, 8)} cancelled.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The action could not be completed. Retry the same action safely.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const abandon = async (commandId: string) => {
    setSubmitting(true);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(commandId);
      await refreshNativeState();
      setMessage(discarded ? 'The interrupted action was cleared because the shop device confirmed it had never completed.' : 'The latest shop state has been refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The interrupted action could not be cleared safely.');
    } finally {
      setSubmitting(false);
    }
  };

  const endNativeSession = async () => {
    setEndingNativeSession(true);
    try {
      await onEndNativeSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-out could not be completed safely.');
    } finally {
      setEndingNativeSession(false);
    }
  };

  if (loading) {
    return <StationShell width="max-w-2xl"><SectionCard><p className="text-sm text-[#777166]">Opening Cashier workspace…</p></SectionCard></StationShell>;
  }

  if (!context || context.role !== 'CASHIER') {
    return (
      <StationShell width="max-w-xl">
        <SectionCard className="space-y-4">
          <SectionTitle eyebrow="Staff access" title="Cashier access is not active" description={message || 'Sign in with a Cashier profile to use this station.'} />
          <MerchantAction onClick={onExit} className="w-full">Back to staff access</MerchantAction>
          <MerchantAction onClick={() => void endNativeSession()} disabled={endingNativeSession} secondary tone="slate" className="w-full">{endingNativeSession ? 'Signing out…' : 'Sign out'}</MerchantAction>
        </SectionCard>
      </StationShell>
    );
  }

  const cloudConnected = health?.cloudStatus === 'CONNECTED';
  const itemCount = basket.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <StationShell>
        {viewUnavailable && <MerchantNotice tone="amber">This view could not be refreshed. Confirm the station connection before continuing.</MerchantNotice>}
      <StationHeader
        role="Cashier"
        staffName={context.staffName}
        title="Sell, take payment, hand over"
        subtitle="Everything you need for the counter, in the order you use it."
        icon={Store}
        tone="amber"
        onBack={onExit}
        action={(
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              label={cloudConnected ? 'Cloud connected' : 'Working offline'}
              detail={cloudConnected ? 'Sales are syncing' : `${health?.outboxDepth || 0} update(s) waiting to sync`}
              tone={cloudConnected ? 'emerald' : 'amber'}
              icon={cloudConnected ? Cloud : CloudOff}
            />
            <MerchantAction onClick={() => void refreshNativeState().catch(() => setMessage('The shop state could not be refreshed.'))} secondary tone="slate">
              <RefreshCw className="h-4 w-4" /> Refresh
            </MerchantAction>
          </div>
        )}
      />

      {message ? <MerchantNotice tone="amber">{message}</MerchantNotice> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Cash shift" value={activeShift ? 'Open' : 'Closed'} hint={activeShift ? 'Ready to sell' : 'Manager action needed'} tone={activeShift ? 'emerald' : 'rose'} />
        <MetricCard label="Drawer expected" value={activeShift ? money.format(activeShift.expectedCash) : '—'} hint="Current shop count" tone="emerald" />
        <MetricCard label="Payments waiting" value={pendingCashOrders.length} hint="Cash orders to settle" tone={pendingCashOrders.length ? 'amber' : 'slate'} />
        <MetricCard label="Ready to hand over" value={readyOrders.length} hint="Paid orders ready" tone={readyOrders.length ? 'sky' : 'slate'} />
      </div>

      {!activeShift ? (
        <MerchantNotice tone="rose"><strong>Sales are paused.</strong> Ask the Manager to open the cash shift before taking orders.</MerchantNotice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <SectionCard>
          <SectionTitle
            eyebrow="1 · Build order"
            title="What is the customer buying?"
            description="Tap products to add them to the basket."
            trailing={(
              <label className="relative block w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a9182]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search products"
                  className="w-full rounded-2xl border border-[#d8cebd] bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-amber-400"
                />
              </label>
            )}
          />

          <div className="mt-4">
            {products.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    disabled={busy || Boolean(pendingOrder) || !activeShift || product.stockQuantity < 1}
                    onClick={() => addProduct(product)}
                    className="min-h-32 rounded-2xl border border-[#ded5c5] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="text-[11px] font-black uppercase tracking-[0.13em] text-[#9a9182]">{product.category}</span>
                    <strong className="mt-1 block text-base leading-5">{product.name}</strong>
                    <span className="mt-4 block text-lg font-black text-[#a26c0f]">{money.format(product.price)}</span>
                    <small className="mt-1 block text-xs text-[#777166]">{product.stockQuantity} {product.unit} available</small>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={ShoppingBasket} title="No products found" detail="Try another search, or ask the Manager to check the active product list." />
            )}
          </div>
        </SectionCard>

        <SectionCard className="lg:sticky lg:top-4">
          <SectionTitle eyebrow="Basket" title={itemCount ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'New order'} description="Cash is the only settlement method enabled in this release." />
          <div className="mt-4 max-h-80 space-y-2 overflow-auto">
            {basket.length ? basket.map((line) => (
              <div key={line.productId} className="rounded-2xl border border-[#e2d9ca] bg-[#fbf7ef] p-3">
                <div className="flex items-start justify-between gap-3">
                  <strong className="text-sm">{line.name}</strong>
                  <strong className="text-sm text-[#a26c0f]">{money.format(line.price * line.quantity)}</strong>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-[#777166]">{money.format(line.price)} each</span>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={busy || Boolean(pendingOrder)} onClick={() => changeQuantity(line.productId, -1)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d8cebd] bg-white" aria-label={`Remove one ${line.name}`}><Minus className="h-4 w-4" /></button>
                    <strong className="w-6 text-center">{line.quantity}</strong>
                    <button type="button" disabled={busy || Boolean(pendingOrder)} onClick={() => changeQuantity(line.productId, 1)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d8cebd] bg-white" aria-label={`Add one ${line.name}`}><Plus className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>
            )) : <EmptyState icon={ShoppingBasket} title="Basket is empty" detail="Tap a product to start the order." />}
          </div>
          <dl className="mt-4 space-y-2 border-t border-[#e2d9ca] pt-4 text-sm">
            <div className="flex justify-between text-[#777166]"><dt>Subtotal</dt><dd>{money.format(subtotal)}</dd></div>
            <div className="flex justify-between text-[#777166]"><dt>VAT {context.vat.enabled ? `${context.vat.rate}%` : 'off'}</dt><dd>{money.format(tax)}</dd></div>
            <div className="flex justify-between text-lg font-black"><dt>Total</dt><dd>{money.format(total)}</dd></div>
          </dl>
          <MerchantAction onClick={() => void submitOrder()} disabled={busy || (!basket.length && !pendingOrder) || !activeShift} className="mt-4 w-full">
            <ReceiptText className="h-4 w-4" /> {submitting ? 'Saving order…' : pendingOrder ? 'Retry interrupted order' : `Save order · ${money.format(total)}`}
          </MerchantAction>
          {pendingOrder ? (
            <MerchantAction onClick={() => void abandon(pendingOrder.commandId)} disabled={busy} secondary tone="amber" className="mt-2 w-full">Clear interrupted order only if it never completed</MerchantAction>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard>
        <SectionTitle eyebrow="2 · Take payment" title="Cash payments waiting" description="Enter what the customer hands you. The system calculates the recorded payment and change." trailing={<StatusBadge label={`${pendingCashOrders.length} waiting`} tone={pendingCashOrders.length ? 'amber' : 'slate'} icon={Banknote} />} />
        <div className="mt-4">
          {pendingCashOrders.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {pendingCashOrders.map((order) => {
                const payment = pendingPayments[order.id];
                const cancellation = pendingCancellations[order.id];
                const orderBusy = busyOrderId === order.id;
                return (
                  <article key={order.id} className="rounded-2xl border border-[#ded5c5] bg-[#fbf7ef] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><span className="text-[11px] font-black uppercase tracking-[0.13em] text-[#9a9182]">Order {order.id.slice(0, 8)}</span><strong className="mt-1 block text-sm">{order.status === 'PLACED' ? 'Waiting for payment' : 'In progress · payment still due'}</strong></div>
                      <strong className="text-lg text-[#a26c0f]">{money.format(order.totalAmount)}</strong>
                    </div>
                    <label className="mt-4 block text-xs font-bold text-[#5f594f]">Cash received
                      <input
                        inputMode="decimal"
                        value={cashByOrder[order.id] ?? order.totalAmount.toFixed(2)}
                        disabled={busy || Boolean(payment) || Boolean(cancellation)}
                        onChange={(event) => setCashByOrder((current) => ({ ...current, [order.id]: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-base outline-none focus:border-amber-400"
                      />
                    </label>
                    <MerchantAction onClick={() => void captureCash(order)} disabled={busy || !activeShift || Boolean(cancellation)} tone="emerald" className="mt-3 w-full">
                      <Banknote className="h-4 w-4" /> {orderBusy ? 'Recording payment…' : payment ? 'Retry same payment' : 'Record cash payment'}
                    </MerchantAction>
                    {payment ? <MerchantAction onClick={() => void abandon(payment.commandId)} disabled={busy} secondary tone="amber" className="mt-2 w-full">Clear interrupted payment only if it never completed</MerchantAction> : null}
                    {(order.status === 'PLACED' || cancellation) ? (
                      <MerchantAction onClick={() => void transitionOrder(order.id, 'CANCELLED')} disabled={busy || Boolean(payment)} secondary tone="rose" className="mt-2 w-full">
                        <XCircle className="h-4 w-4" /> {cancellation ? 'Retry same cancellation' : 'Cancel unprepared order'}
                      </MerchantAction>
                    ) : null}
                    {cancellation ? <MerchantAction onClick={() => void abandon(cancellation.commandId)} disabled={busy} secondary tone="amber" className="mt-2 w-full">Clear interrupted cancellation only if it never completed</MerchantAction> : null}
                  </article>
                );
              })}
            </div>
          ) : <EmptyState icon={Banknote} title="No payments waiting" detail="New cash orders will appear here after they are saved." />}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionTitle eyebrow="3 · Hand over" title="Ready for customer collection" description="These orders are paid and ready. Mark them handed over only when the customer receives the order." trailing={<StatusBadge label={`${readyOrders.length} ready`} tone={readyOrders.length ? 'sky' : 'slate'} icon={PackageCheck} />} />
        <div className="mt-4">
          {readyOrders.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {readyOrders.map((order) => {
                const pending = pendingCollections[order.id];
                const orderBusy = busyOrderId === order.id;
                return (
                  <article key={order.id} className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                    <span className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-700">Ready</span>
                    <strong className="mt-1 block">Order {order.id.slice(0, 8)}</strong>
                    <MerchantAction onClick={() => void transitionOrder(order.id, 'COLLECTED')} disabled={busy} tone="sky" className="mt-4 w-full">
                      <PackageCheck className="h-4 w-4" /> {orderBusy ? 'Marking handed over…' : pending ? 'Retry same handover' : 'Hand over order'}
                    </MerchantAction>
                    {pending ? <MerchantAction onClick={() => void abandon(pending.commandId)} disabled={busy} secondary tone="amber" className="mt-2 w-full">Clear interrupted handover only if it never completed</MerchantAction> : null}
                  </article>
                );
              })}
            </div>
          ) : <EmptyState icon={PackageCheck} title="Nothing waiting for handover" detail="Kitchen-ready, paid orders will appear here." />}
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-[#777166]">
        <span>ThePlugOS keeps selling available even when the internet drops; queued updates sync when the connection returns.</span>
        <MerchantAction onClick={() => void endNativeSession()} disabled={endingNativeSession || busy} secondary tone="slate">
          <WifiOff className="h-4 w-4" /> {endingNativeSession ? 'Signing out…' : 'End native staff session'}
        </MerchantAction>
      </div>
    </StationShell>
  );
};
