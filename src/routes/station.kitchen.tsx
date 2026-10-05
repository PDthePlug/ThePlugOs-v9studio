import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FirstShiftGuide } from "@/components/first-shift-guide";
import { StationShell } from "@/components/station-shell";
import { Button, Card, Notice } from "@/components/ui";
import { transitionOrder } from "@/lib/hub";
import { mergeLocalContext, notifyLocalHub } from "@/lib/local-hub";
import { useStationLive } from "@/lib/use-station-live";
import type { Order } from "@/lib/types";

export const Route = createFileRoute("/station/kitchen")({ component: KitchenStation });

function elapsedLabel(createdAt: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (mins < 1) return "Just in";
  if (mins === 1) return "1 min";
  return `${mins} min`;
}

function slaTone(createdAt: string) {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 5) return "text-live";
  if (mins < 10) return "text-signal";
  return "text-alert";
}

function Ticket({
  order,
  action,
  busy,
  onAction,
}: {
  order: Order;
  action?: { label: string; status: "PREPARING" | "READY" };
  busy: boolean;
  onAction?: () => void;
}) {
  return (
    <article className={`rounded-lg border border-line bg-warm p-4 ${order.status === "READY" ? "ticket-ready border-live/40" : ""}`}>
      <div className="flex items-center justify-between">
        <strong className="font-mono text-2xl">#{order.number}</strong>
        <span className={`font-mono text-xs tabular-nums ${slaTone(order.createdAt)}`}>{elapsedLabel(order.createdAt)}</span>
      </div>
      <ul className="mt-3 space-y-2 border-y border-line py-3 text-sm">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3">
            <span>{item.name}</span>
            <strong className="rounded-md bg-paper px-2 py-1 font-mono text-xs tabular-nums">× {item.qty}</strong>
          </li>
        ))}
      </ul>
      {action && onAction ? (
        <Button className="mt-3 w-full" variant={order.status === "PLACED" ? "ink" : "primary"} disabled={busy} type="button" onClick={onAction}>
          {action.label}
        </Button>
      ) : (
        <p className="mt-3 text-sm text-muted">Waiting for the counter to hand this over.</p>
      )}
    </article>
  );
}

function KitchenStation() {
  const { context, setContext, error, setError, goOnline, exit } = useStationLive("KITCHEN", 1500);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!context) return <main className="min-h-screen bg-canvas p-8"><p>Opening kitchen…</p>{error ? <Notice tone="alert">{error}</Notice> : null}<Button variant="secondary" onClick={() => void goOnline()}>Retry</Button><Button variant="ghost" onClick={exit}>Back to station sign-in</Button></main>;

  const waiting = context.orders.filter((order) => order.status === "PLACED").sort((a,b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const cooking = context.orders.filter((order) => order.status === "PREPARING");
  const ready = context.orders.filter((order) => order.status === "READY");

  const move = async (orderId: string, status: "PREPARING" | "READY") => {
    setError(null);
    setBusyId(orderId);
    try {
      setContext(mergeLocalContext(await transitionOrder({ data: { sessionId: context.sessionId, orderId, status } })));
      notifyLocalHub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that ticket.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <StationShell
      role="Kitchen"
      staffName={context.staff.name}
      title="Cook the queue"
      subtitle="Waiting · cooking · ready for the counter. No money on this screen."
      pendingOutbox={context.pendingOutbox}
      onGoOnline={() => void goOnline()}
      onExit={exit}
    >
      <FirstShiftGuide role="KITCHEN" />
      {error ? <Notice tone="alert">{error}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="font-display text-2xl font-medium">Waiting</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">{waiting.length} tickets</p>
          <div className="mt-4 space-y-3">
            {waiting.map((order) => (
              <Ticket
                key={order.id}
                order={order}
                busy={busyId === order.id}
                action={{ label: "Start cooking", status: "PREPARING" }}
                onAction={() => void move(order.id, "PREPARING")}
              />
            ))}
            {waiting.length === 0 ? <p className="text-sm text-muted">Queue is clear.</p> : null}
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-2xl font-medium">Cooking now</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">{cooking.length} tickets</p>
          <div className="mt-4 space-y-3">
            {cooking.map((order) => (
              <Ticket
                key={order.id}
                order={order}
                busy={busyId === order.id}
                action={{ label: "Mark ready for counter", status: "READY" }}
                onAction={() => void move(order.id, "READY")}
              />
            ))}
            {cooking.length === 0 ? <p className="text-sm text-muted">Nothing on the grill.</p> : null}
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-2xl font-medium">Ready for counter</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">{ready.length} tickets</p>
          <div className="mt-4 space-y-3">
            {ready.map((order) => (
              <Ticket key={order.id} order={order} busy={false} />
            ))}
            {ready.length === 0 ? <p className="text-sm text-muted">Nothing waiting at the pass.</p> : null}
          </div>
        </Card>
      </div>
    </StationShell>
  );
}
