import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { OperationsReport } from "@/components/operations-report";
import { FirstShiftGuide } from "@/components/first-shift-guide";
import { StationShell } from "@/components/station-shell";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { closeShift, openShift, recordInventory, transitionOrder } from "@/lib/hub";
import { notifyLocalHub } from "@/lib/local-hub";
import { formatZar, parseZarToCents } from "@/lib/money";
import { isOfflineMode } from "@/lib/session-store";
import { useStationLive } from "@/lib/use-station-live";
import type { StationContext } from "@/lib/types";

export const Route = createFileRoute("/station/manager")({ component: ManagerStation });

function ManagerStation() {
  const { context, setContext, error, setError, goOnline, exit } = useStationLive("MANAGER");
  const [floatValue, setFloatValue] = useState("500");
  const [counted, setCounted] = useState("");
  const [qty, setQty] = useState("");
  const [productId, setProductId] = useState("");
  const requestRef = useRef<{payload: string; id: string} | null>(null);
  const commandId = (kind: string, payload: unknown) => {
    const value = JSON.stringify({kind, payload});
    if (requestRef.current?.payload !== value) requestRef.current = {payload: value, id: crypto.randomUUID()};
    return requestRef.current.id;
  };
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!context) return <main className="min-h-screen bg-canvas p-8"><p>Opening manager…</p>{error ? <Notice tone="alert">{error}</Notice> : null}<Button variant="secondary" onClick={() => void goOnline()}>Retry</Button><Button variant="ghost" onClick={exit}>Back to station sign-in</Button></main>;

  const selectedProduct = productId || context.products[0]?.id || "";

  const salesToday = context.report?.daily.find(d => d.day === new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg"}).format(new Date()))?.sales ?? 0;
  const openTickets = context.orders.filter((order) => order.status === "PLACED" || order.status === "PREPARING" || order.status === "READY");
  const exceptions = context.orders.filter(
    (order) => (order.status === "PLACED" || order.status === "PREPARING") && order.paymentStatus === "UNPAID",
  );

  let varianceLabel: string | null = null;
  if (counted) {
    try {
      const countedCents = parseZarToCents(counted);
      const delta = countedCents - context.expectedDrawerCents;
      if (delta === 0) varianceLabel = "Balanced with the expected drawer.";
      else if (delta > 0) varianceLabel = `Over by ${formatZar(delta)}`;
      else varianceLabel = `Short by ${formatZar(Math.abs(delta))}`;
    } catch {
      varianceLabel = "Enter a valid count.";
    }
  }

  const run = async (work: () => Promise<StationContext>) => {
    if (busy) return;
    if (isOfflineMode()) {
      setError("Reconnect before changing cash or stock.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setContext(await work());
      requestRef.current = null;
      notifyLocalHub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StationShell
      role="Manager"
      staffName={context.staff.name}
      title="Run the shift"
      subtitle="Cash control, order exceptions and stock tasks in one place."
      pendingOutbox={context.pendingOutbox}
      onGoOnline={() => void goOnline()}
      onExit={exit}
    >
      <FirstShiftGuide role="MANAGER" />
      {error ? <Notice tone="alert">{error}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <span className="text-xs uppercase tracking-[0.14em] text-muted">Sales today</span>
          <strong className="mt-2 block font-mono text-2xl tabular-nums">{formatZar(salesToday)}</strong>
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-[0.14em] text-muted">Open tickets</span>
          <strong className="mt-2 block font-mono text-2xl tabular-nums">{openTickets.length}</strong>
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-[0.14em] text-muted">Expected drawer</span>
          <strong className="mt-2 block font-mono text-2xl tabular-nums">{formatZar(context.expectedDrawerCents)}</strong>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3">
          <h2 className="font-display text-2xl font-medium">Cash control</h2>
          {context.shift ? (
            <>
              <p className="text-sm text-muted">Shift open · {context.shift.openedBy}</p>
              <p className="font-mono text-3xl tabular-nums">{formatZar(context.expectedDrawerCents)}</p>
              <Field label="Physical count">
                <Input value={counted} onChange={(event) => setCounted(event.target.value)} />
              </Field>
              {varianceLabel ? <p className="text-sm text-muted">{varianceLabel}</p> : null}
              <Button
                variant="ink"
                type="button"
                disabled={busy || !counted.trim() || openTickets.length > 0}
                onClick={() =>
                  void run(async () => closeShift({ data: { sessionId: context.sessionId, requestId: commandId("close", counted), countedCents: parseZarToCents(counted) } }))
                }
              >
                Close shift
              </Button>
            </>
          ) : (
            <>
              <Field label="Opening float">
                <Input value={floatValue} onChange={(event) => setFloatValue(event.target.value)} />
              </Field>
              <Button
                variant="ink"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => openShift({ data: { sessionId: context.sessionId, requestId: commandId("open", floatValue), openingFloatCents: parseZarToCents(floatValue) } }))
                }
              >
                Open shift
              </Button>
            </>
          )}
        </Card>
        <Card className="space-y-3">
          <h2 className="font-display text-2xl font-medium">Order exceptions</h2>
          {exceptions.map((order) => (
            <div key={order.id} className="rounded-lg bg-warm p-3">
              <div className="flex items-center justify-between">
                <strong className="font-mono">#{order.number}</strong>
                <Badge>{order.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{order.items.map((item) => `${item.qty}× ${item.name}`).join(", ")}</p>
              <p className="mt-1 font-mono text-sm tabular-nums">{formatZar(order.totalCents)}</p>
              {order.status === "PLACED" ? <Button
                className="mt-2 w-full"
                variant="danger"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => transitionOrder({ data: { sessionId: context.sessionId, orderId: order.id, status: "CANCELLED" } }))
                }
              >
                Cancel unpaid order
              </Button> : <p className="mt-2 text-xs text-muted">Preparation has started. Resolve payment at the counter.</p>}
            </div>
          ))}
          {exceptions.length === 0 ? <p className="text-sm text-muted">No unpaid tickets need a decision.</p> : null}
        </Card>
        <Card className="space-y-3">
          <h2 className="font-display text-2xl font-medium">Stock desk</h2>
          <Field label="Product">
            <select
              className="h-12 w-full rounded-md border border-line bg-paper px-3"
              value={selectedProduct}
              onChange={(event) => setProductId(event.target.value)}
            >
              <option value="">Choose item</option>
              {context.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {product.stock}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <Input value={qty} onChange={(event) => setQty(event.target.value)} />
          </Field>
          <Field label="Reason"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Required for count and waste" /></Field>
          <div className="grid grid-cols-3 gap-2">
            {(["RECEIPT", "COUNT", "WASTE"] as const).map((kind) => (
              <Button
                key={kind}
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!selectedProduct) return setError("Choose a product.");
                  const amount = Number(qty);
                  if (!qty.trim() || !Number.isFinite(amount)) return setError("Enter a quantity.");
                  void run(async () =>
                    recordInventory({
                      data: {
                        sessionId: context.sessionId,
                        requestId: commandId("inventory", {selectedProduct, kind, qty, reason}),
                        productId: selectedProduct,
                        kind,
                        qty: amount,
                        reason,
                      },
                    }),
                  );
                }}
              >
                {kind === "RECEIPT" ? "Receive" : kind === "COUNT" ? "Count" : "Waste"}
              </Button>
            ))}
          </div>
        </Card>
      </div>
      {context.report ? <OperationsReport report={context.report} products={context.products} /> : null}
    </StationShell>
  );
}
