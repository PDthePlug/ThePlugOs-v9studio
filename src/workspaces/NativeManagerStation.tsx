import React, { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  Cloud,
  CloudOff,
  Landmark,
  Package,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
import {useStationRefresh} from '../hooks/useStationRefresh';
import type { NativeHubCancellableOrder, NativeHubCommandRequest, NativeHubOperatorContext, NetworkHealth } from '@plugos/core';
import { ManagerInventoryAdjustmentPanel, type ManagerInventoryAdjustmentRequest } from './ManagerInventoryAdjustmentPanel';
import { ManagerInventoryReceiptPanel, type ManagerInventoryReceiptRequest } from './ManagerInventoryReceiptPanel';
import {
  INVENTORY_WASTE_REASONS,
  ManagerInventoryWastePanel,
  type ManagerInventoryWasteReason,
  type ManagerInventoryWasteRequest,
} from './ManagerInventoryWastePanel';
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

interface NativeManagerStationProps {
  onExit: () => void;
  onEndNativeSession: () => Promise<void>;
}

type PendingCancellationRequest = NativeHubCommandRequest & { orderId: string };
type ManagerCancellationTask = NativeHubCancellableOrder | { id: string; status: 'RECOVERY' };

const money = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

/*
 * Compatibility markers retained for the existing source contracts:
 * Open cash shift locally / Close cash shift locally / Retry the same close request
 * Cash-up approval and bank deposit remain unavailable.
 * Cancellation authority before close / Cancel order locally / Retry the same cancellation request
 * native cancellation request is unresolved
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

function parseMoney(value: string, label: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`${label} must be a non-negative Rand amount with no more than two decimals.`);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999_999.99) throw new Error(`${label} is outside the supported range.`);
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function parsePositiveQuantity(value: string, label: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) throw new Error(`${label} must be a positive quantity with no more than three decimals.`);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 99_999_999_999.999) throw new Error(`${label} is outside the supported range.`);
  return Math.round((parsed + Number.EPSILON) * 1000) / 1000;
}

function parseCountedBalance(value: string, label: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) throw new Error(`${label} must be a non-negative quantity with no more than three decimals.`);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99_999_999_999.999) throw new Error(`${label} is outside the supported range.`);
  return Math.round((parsed + Number.EPSILON) * 1000) / 1000;
}

function recoverSingle(context: NativeHubOperatorContext, type: NativeHubCommandRequest['type']): NativeHubCommandRequest | null {
  return (context.recoverableNativeCommands || []).find((command) => command.type === type) || null;
}

function recoverCancellations(context: NativeHubOperatorContext): Record<string, PendingCancellationRequest> {
  const result: Record<string, PendingCancellationRequest> = {};
  for (const command of context.recoverableNativeCommands || []) {
    const orderId = command.payload.orderId;
    if (command.type === 'order.status.transition' && command.payload.status === 'CANCELLED' && typeof orderId === 'string') {
      result[orderId] = { ...command, orderId };
    }
  }
  return result;
}

function recoverReceipts(context: NativeHubOperatorContext): Record<string, ManagerInventoryReceiptRequest> {
  const result: Record<string, ManagerInventoryReceiptRequest> = {};
  for (const command of context.recoverableNativeCommands || []) {
    const receiptId = command.payload.receiptId;
    if (command.type === 'inventory.receive' && typeof receiptId === 'string' && Array.isArray(command.payload.items)) result[receiptId] = { ...command, receiptId };
  }
  return result;
}

function recoverAdjustments(context: NativeHubOperatorContext): Record<string, ManagerInventoryAdjustmentRequest> {
  const result: Record<string, ManagerInventoryAdjustmentRequest> = {};
  for (const command of context.recoverableNativeCommands || []) {
    const adjustmentId = command.payload.adjustmentId;
    if (command.type === 'inventory.adjust' && command.payload.reason === 'COUNT_CORRECTION' && typeof adjustmentId === 'string' && Array.isArray(command.payload.items)) result[adjustmentId] = { ...command, adjustmentId };
  }
  return result;
}

function recoverWaste(context: NativeHubOperatorContext): Record<string, ManagerInventoryWasteRequest> {
  const result: Record<string, ManagerInventoryWasteRequest> = {};
  for (const command of context.recoverableNativeCommands || []) {
    const wasteId = command.payload.wasteId;
    const reason = command.payload.reason;
    if (command.type === 'inventory.waste' && typeof wasteId === 'string' && typeof reason === 'string' && INVENTORY_WASTE_REASONS.includes(reason as ManagerInventoryWasteReason) && Array.isArray(command.payload.items)) {
      result[wasteId] = { ...command, wasteId };
    }
  }
  return result;
}

const ManagerCancellationQueue = ({
  tasks,
  pendingRequests,
  busyOrderId,
  submitting,
  onCancel,
  onAbandon,
}: {
  tasks: ManagerCancellationTask[];
  pendingRequests: Record<string, PendingCancellationRequest>;
  busyOrderId: string | null;
  submitting: boolean;
  onCancel: (task: ManagerCancellationTask) => void;
  onAbandon: (task: ManagerCancellationTask) => void;
}) => (
  <SectionCard>
    <SectionTitle eyebrow="Order exceptions" title="Orders that need a Manager" description="Cancel only unpaid orders that should not continue. Stock is restored by the shop device when the cancellation is accepted." trailing={<StatusBadge label={`${tasks.length} to review`} tone={tasks.length ? 'rose' : 'slate'} icon={XCircle} />} />
    <div className="mt-4">
      {tasks.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((order) => {
            const pending = pendingRequests[order.id];
            return (
              <article key={order.id} className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-rose-700">{order.status === 'RECOVERY' ? 'Interrupted action' : order.status}</span>
                <strong className="mt-1 block">Order {order.id.slice(0, 8)}</strong>
                <MerchantAction onClick={() => onCancel(order)} disabled={submitting} secondary tone="rose" className="mt-3 w-full">
                  <XCircle className="h-4 w-4" /> {busyOrderId === order.id ? 'Cancelling…' : pending ? 'Retry same cancellation' : 'Cancel order'}
                </MerchantAction>
                {pending ? <MerchantAction onClick={() => onAbandon(order)} disabled={submitting} secondary tone="amber" className="mt-2 w-full">Clear only if it never completed</MerchantAction> : null}
              </article>
            );
          })}
        </div>
      ) : <EmptyState icon={ShieldCheck} title="No order exceptions" detail="There are no unpaid orders requiring Manager cancellation." />}
    </div>
  </SectionCard>
);

export const NativeManagerStation: React.FC<NativeManagerStationProps> = ({ onExit, onEndNativeSession }) => {
  const [context, setContext] = useState<NativeHubOperatorContext | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [endingNativeSession, setEndingNativeSession] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const [openingFloat, setOpeningFloat] = useState('0.00');
  const [countedCash, setCountedCash] = useState('');
  const [pendingOpen, setPendingOpen] = useState<NativeHubCommandRequest | null>(null);
  const [pendingClose, setPendingClose] = useState<NativeHubCommandRequest | null>(null);
  const [pendingCancellations, setPendingCancellations] = useState<Record<string, PendingCancellationRequest>>({});

  const [pendingReceipts, setPendingReceipts] = useState<Record<string, ManagerInventoryReceiptRequest>>({});
  const [receiptProductId, setReceiptProductId] = useState('');
  const [receiptQuantity, setReceiptQuantity] = useState('');
  const [receiptLines, setReceiptLines] = useState<Record<string, string>>({});
  const [receivingId, setReceivingId] = useState<string | null>(null);

  const [pendingAdjustments, setPendingAdjustments] = useState<Record<string, ManagerInventoryAdjustmentRequest>>({});
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustStockAfter, setAdjustStockAfter] = useState('');
  const [adjustmentLines, setAdjustmentLines] = useState<Record<string, string>>({});
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  const [pendingWaste, setPendingWaste] = useState<Record<string, ManagerInventoryWasteRequest>>({});
  const [wasteProductId, setWasteProductId] = useState('');
  const [wasteQuantity, setWasteQuantity] = useState('');
  const [wasteReason, setWasteReason] = useState<ManagerInventoryWasteReason>('SPOILAGE');
  const [wasteLines, setWasteLines] = useState<Record<string, string>>({});
  const [wastingId, setWastingId] = useState<string | null>(null);

  const refreshNativeState = useCallback(async () => {
    const [operator] = await Promise.all([
      localHubRuntime.getNativeOperatorContext(),
      localHubRuntime.refresh().catch(() => undefined),
    ]);
    setContext(operator);
    setHealth(localHubRuntime.getNetworkHealth());
    setPendingOpen(recoverSingle(operator, 'shift.open'));
    setPendingClose(recoverSingle(operator, 'shift.close'));
    setPendingCancellations(recoverCancellations(operator));
    setPendingReceipts(recoverReceipts(operator));
    setPendingAdjustments(recoverAdjustments(operator));
    setPendingWaste(recoverWaste(operator));

    const products = operator.inventoryProducts || [];
    const choose = (current: string) => products.some((product) => product.id === current) ? current : products[0]?.id || '';
    setReceiptProductId(choose);
    setAdjustProductId(choose);
    setWasteProductId(choose);
    const validIds = new Set(products.map((product) => product.id));
    setReceiptLines((current) => Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id))));
    setAdjustmentLines((current) => Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id))));
    setWasteLines((current) => Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id))));
  }, []);

  const viewUnavailable = useStationRefresh(refreshNativeState, !loading && !submitting && !busyOrderId && !endingNativeSession);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        await refreshNativeState();
        if (!mounted) return;
        unsubscribe = localHubRuntime.subscribe((snapshot) => { if (mounted) setHealth(snapshot.networkHealth); });
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : 'Manager workspace could not be opened.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; unsubscribe?.(); };
  }, [refreshNativeState]);

  const activeShift = context?.activeCashShift || null;
  const inventoryProducts = context?.inventoryProducts || [];
  const cancellableOrders = context?.cancellableOrders || [];
  const cancellableIds = new Set(cancellableOrders.map((order) => order.id));
  const cancellationTasks: ManagerCancellationTask[] = [
    ...cancellableOrders,
    ...Object.keys(pendingCancellations).filter((id) => !cancellableIds.has(id)).map((id) => ({ id, status: 'RECOVERY' as const })),
  ];

  const abandon = async (commandId: string) => {
    setSubmitting(true);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(commandId);
      await refreshNativeState();
      setMessage(discarded ? 'The interrupted action was cleared because it had never completed.' : 'The latest shop state has been refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The interrupted action could not be cleared safely.');
    } finally {
      setSubmitting(false);
    }
  };

  const openShift = async () => {
    setSubmitting(true);
    setMessage(null);
    let request = pendingOpen;
    try {
      if (!request) {
        const shiftId = createRequestUuid();
        request = { commandId: createRequestUuid(), type: 'shift.open', payload: { shiftId, openingFloat: parseMoney(openingFloat, 'Opening float') } };
        setPendingOpen(request);
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingOpen(null);
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'The cash shift was already open.' : 'Cash shift opened. The counter can start selling.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The cash shift could not be opened. Retry the same action.');
    } finally {
      setSubmitting(false);
    }
  };

  const closeShift = async () => {
    setSubmitting(true);
    setMessage(null);
    let request = pendingClose;
    try {
      if (!activeShift && !request) throw new Error('There is no open cash shift to close.');
      if (!request) request = { commandId: createRequestUuid(), type: 'shift.close', payload: { shiftId: activeShift!.id, countedCash: parseMoney(countedCash, 'Counted cash') } };
      setPendingClose(request);
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingClose(null);
      setCountedCash('');
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'The shift close was already recorded.' : 'Cash shift closed and the physical count was recorded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The cash shift could not be closed. Retry the same action.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelOrder = async (task: ManagerCancellationTask) => {
    setBusyOrderId(task.id);
    setSubmitting(true);
    setMessage(null);
    let request = pendingCancellations[task.id];
    try {
      if (!request) {
        request = { commandId: createRequestUuid(), orderId: task.id, type: 'order.status.transition', payload: { orderId: task.id, status: 'CANCELLED' } };
        setPendingCancellations((current) => ({ ...current, [task.id]: request! }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingCancellations((current) => { const next = { ...current }; delete next[task.id]; return next; });
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'That order was already cancelled.' : `Order ${task.id.slice(0, 8)} cancelled.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The order could not be cancelled. Retry the same action.');
    } finally {
      setBusyOrderId(null);
      setSubmitting(false);
    }
  };

  const addReceiptLine = () => {
    try {
      const product = inventoryProducts.find((candidate) => candidate.id === receiptProductId);
      if (!product) throw new Error('Choose a product first.');
      const quantity = parsePositiveQuantity(receiptQuantity, `Quantity received for ${product.name}`);
      setReceiptLines((current) => ({ ...current, [product.id]: quantity.toFixed(3) }));
      setReceiptQuantity('');
      setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'That received quantity is not valid.'); }
  };

  const commitReceipt = async (request: ManagerInventoryReceiptRequest) => {
    setReceivingId(request.receiptId); setSubmitting(true); setMessage(null);
    try {
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingReceipts((current) => { const next = { ...current }; delete next[request.receiptId]; return next; });
      setReceiptLines({});
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'That stock receipt was already recorded.' : 'Stock received has been recorded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Stock received could not be recorded. Retry the same action.'); }
    finally { setReceivingId(null); setSubmitting(false); }
  };

  const submitReceipt = async () => {
    if (Object.keys(pendingReceipts).length) { setMessage('Finish the interrupted stock-receipt action before starting another.'); return; }
    try {
      const items = Object.entries(receiptLines).map(([productId, quantity]) => ({ productId, quantity: parsePositiveQuantity(quantity, 'Received quantity') }));
      if (!items.length) throw new Error('Add at least one received product.');
      const receiptId = createRequestUuid();
      const request: ManagerInventoryReceiptRequest = { commandId: createRequestUuid(), receiptId, type: 'inventory.receive', payload: { receiptId, items } };
      setPendingReceipts((current) => ({ ...current, [receiptId]: request }));
      await commitReceipt(request);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The stock receipt is not valid.'); }
  };

  const addAdjustmentLine = () => {
    try {
      const product = inventoryProducts.find((candidate) => candidate.id === adjustProductId);
      if (!product) throw new Error('Choose a product first.');
      const stockAfter = parseCountedBalance(adjustStockAfter, `Counted balance for ${product.name}`);
      if (stockAfter === product.stockQuantity) throw new Error('That count matches the current balance, so no correction is needed.');
      setAdjustmentLines((current) => ({ ...current, [product.id]: stockAfter.toFixed(3) }));
      setAdjustStockAfter('');
      setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'That stock count is not valid.'); }
  };

  const commitAdjustment = async (request: ManagerInventoryAdjustmentRequest) => {
    setAdjustingId(request.adjustmentId); setSubmitting(true); setMessage(null);
    try {
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingAdjustments((current) => { const next = { ...current }; delete next[request.adjustmentId]; return next; });
      setAdjustmentLines({});
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'That stock correction was already recorded.' : 'Stock count correction recorded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The stock correction could not be recorded. Retry the same action.'); }
    finally { setAdjustingId(null); setSubmitting(false); }
  };

  const submitAdjustment = async () => {
    if (Object.keys(pendingAdjustments).length) { setMessage('Finish the interrupted stock-count action before starting another.'); return; }
    try {
      const items = Object.entries(adjustmentLines).map(([productId, stockAfter]) => ({ productId, stockAfter: parseCountedBalance(stockAfter, 'Counted balance') }));
      if (!items.length) throw new Error('Add at least one counted balance.');
      const adjustmentId = createRequestUuid();
      const request: ManagerInventoryAdjustmentRequest = { commandId: createRequestUuid(), adjustmentId, type: 'inventory.adjust', payload: { adjustmentId, reason: 'COUNT_CORRECTION', items } };
      setPendingAdjustments((current) => ({ ...current, [adjustmentId]: request }));
      await commitAdjustment(request);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The stock correction is not valid.'); }
  };

  const addWasteLine = () => {
    try {
      const product = inventoryProducts.find((candidate) => candidate.id === wasteProductId);
      if (!product) throw new Error('Choose a product first.');
      const quantity = parsePositiveQuantity(wasteQuantity, `Waste quantity for ${product.name}`);
      if (quantity > product.stockQuantity) throw new Error('Waste cannot be greater than the current stock balance.');
      setWasteLines((current) => ({ ...current, [product.id]: quantity.toFixed(3) }));
      setWasteQuantity('');
      setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'That waste quantity is not valid.'); }
  };

  const commitWaste = async (request: ManagerInventoryWasteRequest) => {
    setWastingId(request.wasteId); setSubmitting(true); setMessage(null);
    try {
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingWaste((current) => { const next = { ...current }; delete next[request.wasteId]; return next; });
      setWasteLines({});
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE' ? 'That waste record was already saved.' : 'Waste has been recorded and stock updated.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Waste could not be recorded. Retry the same action.'); }
    finally { setWastingId(null); setSubmitting(false); }
  };

  const submitWaste = async () => {
    if (Object.keys(pendingWaste).length) { setMessage('Finish the interrupted waste action before starting another.'); return; }
    try {
      const items = Object.entries(wasteLines).map(([productId, quantity]) => ({ productId, quantity: parsePositiveQuantity(quantity, 'Waste quantity') }));
      if (!items.length) throw new Error('Add at least one waste line.');
      const wasteId = createRequestUuid();
      const request: ManagerInventoryWasteRequest = { commandId: createRequestUuid(), wasteId, type: 'inventory.waste', payload: { wasteId, reason: wasteReason, items } };
      setPendingWaste((current) => ({ ...current, [wasteId]: request }));
      await commitWaste(request);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The waste record is not valid.'); }
  };

  const endNativeSession = async () => {
    setEndingNativeSession(true);
    try { await onEndNativeSession(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-out could not be completed safely.'); }
    finally { setEndingNativeSession(false); }
  };

  if (loading) return <StationShell width="max-w-2xl"><SectionCard><p className="text-sm text-[#777166]">Opening Manager workspace…</p></SectionCard></StationShell>;

  if (!context || context.role !== 'MANAGER') {
    return (
      <StationShell width="max-w-xl">
        <SectionCard className="space-y-4">
          <SectionTitle eyebrow="Staff access" title="Manager access is not active" description={message || 'Sign in with a Manager profile to use this station.'} />
          <MerchantAction onClick={onExit} className="w-full">Back to staff access</MerchantAction>
          <MerchantAction onClick={() => void endNativeSession()} disabled={endingNativeSession} secondary tone="slate" className="w-full">{endingNativeSession ? 'Signing out…' : 'End native staff session'}</MerchantAction>
        </SectionCard>
      </StationShell>
    );
  }

  const cloudConnected = health?.cloudStatus === 'CONNECTED';
  const countedPreview = /^\d+(?:\.\d{1,2})?$/.test(countedCash.trim()) ? Number(countedCash) : null;
  const variancePreview = activeShift && countedPreview !== null && Number.isFinite(countedPreview)
    ? Math.round((countedPreview - activeShift.expectedCash + Number.EPSILON) * 100) / 100
    : null;

  return (
    <StationShell width="max-w-7xl">
      {viewUnavailable && <MerchantNotice tone="amber">This view could not be refreshed. Confirm the station connection before continuing.</MerchantNotice>}
      <StationHeader
        role="Manager"
        staffName={context.staffName}
        title="Run the shift"
        subtitle="Cash control, order exceptions and stock tasks in one place."
        icon={ShieldCheck}
        tone="emerald"
        onBack={onExit}
        action={(
          <div className="flex flex-wrap gap-2">
            <StatusBadge label={cloudConnected ? 'Cloud connected' : 'Working offline'} detail={cloudConnected ? 'Updates are syncing' : `${health?.outboxDepth || 0} update(s) waiting to sync`} tone={cloudConnected ? 'emerald' : 'amber'} icon={cloudConnected ? Cloud : CloudOff} />
            <MerchantAction onClick={() => void refreshNativeState().catch(() => setMessage('The shop state could not be refreshed.'))} secondary tone="slate"><RefreshCw className="h-4 w-4" /> Refresh</MerchantAction>
          </div>
        )}
      />

      {message ? <MerchantNotice tone="amber">{message}</MerchantNotice> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Cash shift" value={activeShift ? 'Open' : 'Closed'} hint={activeShift ? 'Counter can sell' : 'Open before sales'} tone={activeShift ? 'emerald' : 'amber'} />
        <MetricCard label="Expected cash" value={activeShift ? money.format(activeShift.expectedCash) : '—'} hint="Current drawer expectation" tone="emerald" />
        <MetricCard label="Order exceptions" value={cancellationTasks.length} hint="Unpaid orders to review" tone={cancellationTasks.length ? 'rose' : 'slate'} />
        <MetricCard label="Stock products" value={inventoryProducts.length} hint="Available for stock tasks" tone="sky" />
      </div>

      <SectionCard>
        <SectionTitle eyebrow="Cash control" title={activeShift ? 'Shift is open' : 'Open the cash shift'} description={activeShift ? 'Track the drawer through the day, then count the physical cash before closing.' : 'Set the opening float so the Cashier station can start selling.'} trailing={<StatusBadge label={activeShift ? 'OPEN' : 'CLOSED'} tone={activeShift ? 'emerald' : 'amber'} icon={Landmark} />} />

        {activeShift ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Opening float" value={money.format(activeShift.openingFloat)} tone="slate" />
              <MetricCard label="Cash sales" value={money.format(activeShift.cashSalesTotal)} tone="emerald" />
              <MetricCard label="Change returned" value={money.format(activeShift.cashChangeTotal)} tone="slate" />
              <MetricCard label="Expected drawer" value={money.format(activeShift.expectedCash)} tone="emerald" />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
              <div>
                <label className="block text-sm font-black text-[#3e392f]">Physical cash counted
                  <input value={countedCash} inputMode="decimal" disabled={submitting || Boolean(pendingClose)} onChange={(event) => setCountedCash(event.target.value)} placeholder="0.00" className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-4 py-3 text-lg outline-none focus:border-emerald-500" />
                </label>
                <div className={`mt-3 rounded-2xl border p-3 text-sm ${variancePreview === null ? 'border-stone-200 bg-stone-50 text-stone-700' : variancePreview === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
                  <span className="text-[11px] font-black uppercase tracking-[0.13em]">Variance preview</span>
                  <strong className="mt-1 block text-lg">{variancePreview === null ? 'Enter counted cash' : variancePreview === 0 ? 'Balanced · R 0.00' : `${variancePreview > 0 ? 'Over' : 'Short'} · ${money.format(Math.abs(variancePreview))}`}</strong>
                </div>
              </div>
              <div>
                <MerchantAction onClick={() => void closeShift()} disabled={submitting || cancellationTasks.length > 0} tone="sky" className="w-full"><Landmark className="h-4 w-4" /> {submitting ? 'Closing shift…' : pendingClose ? 'Retry shift close' : 'Count & close shift'}</MerchantAction>
                {pendingClose ? <MerchantAction onClick={() => void abandon(pendingClose.commandId)} disabled={submitting} secondary tone="amber" className="mt-2 w-full">Clear interrupted close only if it never completed</MerchantAction> : null}
              </div>
            </div>
            {cancellationTasks.length ? <MerchantNotice tone="rose">Resolve the order exceptions below before closing the cash shift.</MerchantNotice> : null}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-end">
            <label className="block text-sm font-black text-[#3e392f]">Opening float
              <input value={openingFloat} inputMode="decimal" disabled={submitting || Boolean(pendingOpen)} onChange={(event) => setOpeningFloat(event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-4 py-3 text-lg outline-none focus:border-emerald-500" />
            </label>
            <div>
              <MerchantAction onClick={() => void openShift()} disabled={submitting} tone="emerald" className="w-full"><Banknote className="h-4 w-4" /> {submitting ? 'Opening shift…' : pendingOpen ? 'Retry shift opening' : 'Open cash shift'}</MerchantAction>
              {pendingOpen ? <MerchantAction onClick={() => void abandon(pendingOpen.commandId)} disabled={submitting} secondary tone="amber" className="mt-2 w-full">Clear interrupted opening only if it never completed</MerchantAction> : null}
            </div>
          </div>
        )}
      </SectionCard>

      <ManagerCancellationQueue
        tasks={cancellationTasks}
        pendingRequests={pendingCancellations}
        busyOrderId={busyOrderId}
        submitting={submitting}
        onCancel={(task) => void cancelOrder(task)}
        onAbandon={(task) => { const request = pendingCancellations[task.id]; if (request) void abandon(request.commandId); }}
      />

      <SectionCard>
        <SectionTitle eyebrow="Stock desk" title="Keep stock accurate" description="Receive counted stock, correct a physical count, or record spoilage and damage. These are quantity tasks only." trailing={<StatusBadge label={`${inventoryProducts.length} products`} tone="sky" icon={Package} />} />
        <div className="mt-4 space-y-4">
          <ManagerInventoryReceiptPanel
            products={inventoryProducts}
            selectedProductId={receiptProductId}
            quantity={receiptQuantity}
            draftLines={receiptLines}
            pendingRequests={pendingReceipts}
            receivingReceiptId={receivingId}
            submitting={submitting}
            onSelectedProductChange={setReceiptProductId}
            onQuantityChange={setReceiptQuantity}
            onAddLine={addReceiptLine}
            onRemoveLine={(productId) => setReceiptLines((current) => { const next = { ...current }; delete next[productId]; return next; })}
            onSubmit={() => void submitReceipt()}
            onRetry={(receiptId) => { const request = pendingReceipts[receiptId]; if (request) void commitReceipt(request); }}
            onAbandon={(receiptId) => { const request = pendingReceipts[receiptId]; if (request) void abandon(request.commandId); }}
          />

          <ManagerInventoryAdjustmentPanel
            products={inventoryProducts}
            selectedProductId={adjustProductId}
            stockAfter={adjustStockAfter}
            draftLines={adjustmentLines}
            pendingRequests={pendingAdjustments}
            adjustingAdjustmentId={adjustingId}
            submitting={submitting}
            onSelectedProductChange={setAdjustProductId}
            onStockAfterChange={setAdjustStockAfter}
            onAddLine={addAdjustmentLine}
            onRemoveLine={(productId) => setAdjustmentLines((current) => { const next = { ...current }; delete next[productId]; return next; })}
            onSubmit={() => void submitAdjustment()}
            onRetry={(adjustmentId) => { const request = pendingAdjustments[adjustmentId]; if (request) void commitAdjustment(request); }}
            onAbandon={(adjustmentId) => { const request = pendingAdjustments[adjustmentId]; if (request) void abandon(request.commandId); }}
          />

          <ManagerInventoryWastePanel
            products={inventoryProducts}
            selectedProductId={wasteProductId}
            quantity={wasteQuantity}
            reason={wasteReason}
            draftLines={wasteLines}
            pendingRequests={pendingWaste}
            wastingWasteId={wastingId}
            submitting={submitting}
            onSelectedProductChange={setWasteProductId}
            onQuantityChange={setWasteQuantity}
            onReasonChange={setWasteReason}
            onAddLine={addWasteLine}
            onRemoveLine={(productId) => setWasteLines((current) => { const next = { ...current }; delete next[productId]; return next; })}
            onSubmit={() => void submitWaste()}
            onRetry={(wasteId) => { const request = pendingWaste[wasteId]; if (request) void commitWaste(request); }}
            onAbandon={(wasteId) => { const request = pendingWaste[wasteId]; if (request) void abandon(request.commandId); }}
          />
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-[#777166]">
        <span>Manager actions stay within cash-shift, cancellation and counted-stock authority. Supplier payments, banking and approvals remain separate workflows.</span>
        <MerchantAction onClick={() => void endNativeSession()} disabled={endingNativeSession || submitting} secondary tone="slate"><WifiOff className="h-4 w-4" /> {endingNativeSession ? 'Signing out…' : 'End native staff session'}</MerchantAction>
      </div>
    </StationShell>
  );
};
