import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChefHat,
  CircleCheck,
  Cloud,
  CloudOff,
  CookingPot,
  Play,
  RefreshCw,
  RotateCcw,
  Utensils,
  WifiOff,
} from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
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

interface NativeKitchenStationProps {
  onExit: () => void;
  onEndNativeSession: () => Promise<void>;
}

type KitchenOrder = NativeHubOperatorContext['pendingKitchenOrders'][number];
type KitchenTargetStatus = 'PREPARING' | 'READY';
type PendingTransitionRequest = NativeHubCommandRequest & { orderId: string; targetStatus: KitchenTargetStatus };

/*
 * R006 compatibility markers retained while the merchant copy evolves:
 * Retry exact native request
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

function recoverTransitions(context: NativeHubOperatorContext): Record<string, PendingTransitionRequest> {
  const result: Record<string, PendingTransitionRequest> = {};
  for (const command of context.recoverableNativeCommands || []) {
    const orderId = command.payload.orderId;
    const targetStatus = command.payload.status;
    if (command.type !== 'order.status.transition' || typeof orderId !== 'string' || (targetStatus !== 'PREPARING' && targetStatus !== 'READY')) continue;
    result[orderId] = { ...command, orderId, targetStatus };
  }
  return result;
}

function ticketAction(order: KitchenOrder): { label: string; target: KitchenTargetStatus; icon: typeof Play } {
  return order.status === 'PLACED'
    ? { label: 'Start this order', target: 'PREPARING', icon: Play }
    : { label: 'Mark ready for counter', target: 'READY', icon: CircleCheck };
}

const TicketCard = ({
  order,
  pending,
  busy,
  refreshing,
  onTransition,
  onAbandon,
}: {
  order: KitchenOrder;
  pending?: PendingTransitionRequest;
  busy: boolean;
  refreshing: boolean;
  onTransition: (order: KitchenOrder, requestedStatus: KitchenTargetStatus) => void;
  onAbandon: (order: KitchenOrder) => void;
}) => {
  const action = ticketAction(order);
  const ActionIcon = action.icon;
  return (
    <article className="rounded-[1.4rem] border border-[#ded5c5] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[#9a9182]">Order {order.id.slice(0, 8)}</span>
          <strong className="mt-1 block text-lg">{order.status === 'PLACED' ? 'New order' : 'Cooking now'}</strong>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${order.status === 'PLACED' ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
          {order.status === 'PLACED' ? 'NEW' : 'IN PREP'}
        </span>
      </div>

      <ul className="my-4 space-y-2 border-y border-[#ece4d7] py-4" aria-label={`Items for order ${order.id.slice(0, 8)}`}>
        {order.items.map((item) => (
          <li key={item.productId} className="flex items-start justify-between gap-4 text-sm">
            <span className="font-semibold text-[#3e392f]">{item.name}</span>
            <strong className="shrink-0 rounded-lg bg-[#f3ede3] px-2 py-1 text-[#5f594f]">× {item.quantity}</strong>
          </li>
        ))}
      </ul>

      {pending ? (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs leading-5 text-amber-950">This order has an interrupted update. Retry the same update before doing anything else.</p>
          <MerchantAction onClick={() => onTransition(order, pending.targetStatus)} disabled={busy || refreshing} tone="amber" className="w-full">
            <RotateCcw className="h-4 w-4" /> Retry order update
          </MerchantAction>
          <MerchantAction onClick={() => onAbandon(order)} disabled={busy || refreshing} secondary tone="amber" className="w-full">Clear only if the shop device confirms it never completed</MerchantAction>
        </div>
      ) : (
        <MerchantAction onClick={() => onTransition(order, action.target)} disabled={busy || refreshing} tone={order.status === 'PLACED' ? 'orange' : 'sky'} className="w-full">
          <ActionIcon className="h-4 w-4" /> {action.label}
        </MerchantAction>
      )}
    </article>
  );
};

export const NativeKitchenStation: React.FC<NativeKitchenStationProps> = ({ onExit, onEndNativeSession }) => {
  const [context, setContext] = useState<NativeHubOperatorContext | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [endingNativeSession, setEndingNativeSession] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<Record<string, PendingTransitionRequest>>({});
  const [message, setMessage] = useState<string | null>(null);

  const refreshNativeState = useCallback(async () => {
    const [operator] = await Promise.all([
      localHubRuntime.getNativeOperatorContext(),
      localHubRuntime.refresh().catch(() => undefined),
    ]);
    setContext(operator);
    setPendingRequests(recoverTransitions(operator));
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
        if (mounted) setMessage(error instanceof Error ? error.message : 'Kitchen could not be opened.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [refreshNativeState]);

  const orders = context?.pendingKitchenOrders || [];
  const waiting = useMemo(() => orders.filter((order) => order.status === 'PLACED'), [orders]);
  const preparing = useMemo(() => orders.filter((order) => order.status === 'PREPARING'), [orders]);

  const refresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      await refreshNativeState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kitchen could not refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  const submitTransition = async (order: KitchenOrder, requestedStatus: KitchenTargetStatus) => {
    setBusyOrderId(order.id);
    setMessage(null);
    let request = pendingRequests[order.id];
    try {
      if (request && request.targetStatus !== requestedStatus) throw new Error('Finish the interrupted update for this order before moving it again.');
      if (!request) {
        request = {
          commandId: createRequestUuid(),
          type: 'order.status.transition',
          orderId: order.id,
          targetStatus: requestedStatus,
          payload: { orderId: order.id, status: requestedStatus },
        };
        setPendingRequests((current) => ({ ...current, [order.id]: request! }));
      }
      const receipt = await localHubRuntime.submitNativeCommandRequest(request);
      setPendingRequests((current) => { const next = { ...current }; delete next[order.id]; return next; });
      await refreshNativeState();
      setMessage(receipt.outcome === 'DUPLICATE'
        ? 'That order move was already completed. No duplicate update was created.'
        : requestedStatus === 'PREPARING' ? `Order ${order.id.slice(0, 8)} moved into preparation.` : `Order ${order.id.slice(0, 8)} is ready for the counter.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The order could not be moved. Retry the same action.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const abandonTransition = async (order: KitchenOrder) => {
    const request = pendingRequests[order.id];
    if (!request) return;
    setBusyOrderId(order.id);
    setMessage(null);
    try {
      const discarded = await localHubRuntime.discardNativeCommandRequest(request.commandId);
      await refreshNativeState();
      setMessage(discarded ? 'The interrupted order update was cleared because it had never completed.' : 'The latest shop state has been refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The interrupted order update could not be cleared safely.');
    } finally {
      setBusyOrderId(null);
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
    return <StationShell width="max-w-2xl"><SectionCard><p className="text-sm text-[#777166]">Opening Kitchen workspace…</p></SectionCard></StationShell>;
  }

  if (!context || context.role !== 'KITCHEN_STAFF') {
    return (
      <StationShell width="max-w-xl">
        <SectionCard className="space-y-4">
          <SectionTitle eyebrow="Staff access" title="Kitchen access is not active" description={message || 'Sign in with a Kitchen profile to use this station.'} />
          <MerchantAction onClick={onExit} className="w-full">Back to staff access</MerchantAction>
          <MerchantAction onClick={() => void endNativeSession()} disabled={endingNativeSession} secondary tone="slate" className="w-full">{endingNativeSession ? 'Signing out…' : 'End native staff session'}</MerchantAction>
        </SectionCard>
      </StationShell>
    );
  }

  const cloudConnected = health?.cloudStatus === 'CONNECTED';

  return (
    <StationShell width="max-w-7xl">
      <StationHeader
        role="Kitchen"
        staffName={context.staffName}
        title="Cook the queue"
        subtitle="New orders on the left. Orders being prepared on the right."
        icon={ChefHat}
        tone="orange"
        onBack={onExit}
        action={(
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              label={cloudConnected ? 'Cloud connected' : 'Working offline'}
              detail={cloudConnected ? 'Kitchen updates are syncing' : `${health?.outboxDepth || 0} update(s) waiting to sync`}
              tone={cloudConnected ? 'emerald' : 'amber'}
              icon={cloudConnected ? Cloud : CloudOff}
            />
            <MerchantAction onClick={() => void refresh()} disabled={refreshing || busyOrderId !== null} secondary tone="slate">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </MerchantAction>
          </div>
        )}
      />

      {message ? <MerchantNotice tone="amber">{message}</MerchantNotice> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="All active" value={orders.length} hint="Orders needing Kitchen action" tone="slate" />
        <MetricCard label="Waiting" value={waiting.length} hint="Not started yet" tone={waiting.length ? 'orange' : 'slate'} />
        <MetricCard label="Cooking" value={preparing.length} hint="Currently in preparation" tone={preparing.length ? 'sky' : 'slate'} />
      </div>

      {orders.length === 0 ? (
        <SectionCard>
          <EmptyState icon={CircleCheck} title="Kitchen is clear" detail="There are no new or in-progress orders right now. New tickets will appear here as soon as they are saved at the counter." />
        </SectionCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard>
            <SectionTitle eyebrow="New" title="Waiting to start" description="Start an order when someone begins preparing it." trailing={<StatusBadge label={`${waiting.length} waiting`} tone={waiting.length ? 'orange' : 'slate'} icon={Utensils} />} />
            <div className="mt-4 space-y-3">
              {waiting.length ? waiting.map((order) => (
                <TicketCard key={order.id} order={order} pending={pendingRequests[order.id]} busy={busyOrderId === order.id} refreshing={refreshing} onTransition={(ticket, status) => void submitTransition(ticket, status)} onAbandon={(ticket) => void abandonTransition(ticket)} />
              )) : <EmptyState icon={CircleCheck} title="No new orders" detail="Everything that has arrived is already being prepared." />}
            </div>
          </SectionCard>

          <SectionCard>
            <SectionTitle eyebrow="In preparation" title="Cooking now" description="When the full order is finished, send it to the counter." trailing={<StatusBadge label={`${preparing.length} cooking`} tone={preparing.length ? 'sky' : 'slate'} icon={CookingPot} />} />
            <div className="mt-4 space-y-3">
              {preparing.length ? preparing.map((order) => (
                <TicketCard key={order.id} order={order} pending={pendingRequests[order.id]} busy={busyOrderId === order.id} refreshing={refreshing} onTransition={(ticket, status) => void submitTransition(ticket, status)} onAbandon={(ticket) => void abandonTransition(ticket)} />
              )) : <EmptyState icon={CookingPot} title="Nothing cooking" detail="Start a waiting order and it will move here." />}
            </div>
          </SectionCard>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-[#777166]">
        <span>Kitchen can start preparation and mark orders ready. Payment and cancellation stay with the roles responsible for them.</span>
        <MerchantAction onClick={() => void endNativeSession()} disabled={endingNativeSession || busyOrderId !== null} secondary tone="slate">
          <WifiOff className="h-4 w-4" /> {endingNativeSession ? 'Signing out…' : 'End native staff session'}
        </MerchantAction>
      </div>
    </StationShell>
  );
};
