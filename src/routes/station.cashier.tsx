import { createFileRoute } from "@tanstack/react-router";
import { Minus, Plus, ShoppingBasket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OrderHistory } from "@/components/order-history";
import { FirstShiftGuide } from "@/components/first-shift-guide";
import { StationShell } from "@/components/station-shell";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { capturePayment, createOrder, transitionOrder } from "@/lib/hub";
import { mergeLocalContext, notifyLocalHub } from "@/lib/local-hub";
import { formatZar, parseZarToCents } from "@/lib/money";
import { useStationLive } from "@/lib/use-station-live";

export const Route = createFileRoute("/station/cashier")({ component: CashierStation });

function CashierStation() {
  const { context, setContext, error, setError, goOnline, exit } = useStationLive("CASHIER");
  const [basket, setBasket] = useState<{ productId: string; name: string; priceCents: number; qty: number }[]>([]);
  const [tendered, setTendered] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const requestRef = useRef<{payload: string; id: string} | null>(null);
  const placingRef = useRef(false);
  const [placing, setPlacing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const draftLoaded = useRef(false);
  useEffect(() => {
    if (!context || draftLoaded.current) return;
    try { const raw = sessionStorage.getItem(`plugos.basket.${context.sessionId}`); if (raw) setBasket(JSON.parse(raw)); } catch { /* corrupt draft can be discarded */ }
    draftLoaded.current = true;
  }, [context]);
  useEffect(() => {
    if (context && draftLoaded.current) sessionStorage.setItem(`plugos.basket.${context.sessionId}`, JSON.stringify(basket));
  }, [basket, context]);
  const products = useMemo(() => {
    const list = context?.products.filter((product) => product.active) ?? [];
    const searched = query.trim()
      ? list.filter((product) => product.name.toLowerCase().includes(query.toLowerCase()))
      : list;
    if (category === "All") return searched;
    return searched.filter((product) => product.category === category);
  }, [category, context, query]);

  const categories = useMemo(() => {
    const values = context?.products.filter((product) => product.active).map((product) => product.category) ?? [];
    return ["All", ...Array.from(new Set(values))];
  }, [context]);

  if (!context) return <main className="min-h-screen bg-canvas p-8"><p>Opening cashier…</p>{error ? <Notice tone="alert">{error}</Notice> : null}<Button variant="secondary" onClick={() => void goOnline()}>Retry</Button><Button variant="ghost" onClick={exit}>Back to station sign-in</Button></main>;

  const total = basket.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
  const add = (productId: string, name: string, priceCents: number) => {
    setBasket((current) => {
      const available = context.products.find(p => p.id === productId)?.stock ?? 0;
      const existing = current.find((line) => line.productId === productId);
      if ((existing?.qty ?? 0) >= available) return current;
      if (existing) return current.map((line) => (line.productId === productId ? { ...line, qty: line.qty + 1 } : line));
      return [...current, { productId, name, priceCents, qty: 1 }];
    });
  };

  const place = async () => {
    if (placingRef.current) return;
    placingRef.current = true; setPlacing(true);
    setError(null);
    try {
      const payload = JSON.stringify(basket.map(line => ({productId: line.productId, qty: line.qty})));
      if (requestRef.current?.payload !== payload) requestRef.current = { payload, id: crypto.randomUUID() };
      const next = await createOrder({
        data: { sessionId: context.sessionId, requestId: requestRef.current.id, items: basket.map((line) => ({ productId: line.productId, qty: line.qty })) },
      });
      setContext(mergeLocalContext(next));
      notifyLocalHub();
      setBasket([]);
      requestRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order could not be created.");
    } finally { placingRef.current = false; setPlacing(false); }
  };

  const pay = async (orderId: string, fallbackCents: number) => {
    setError(null);
    setBusyId(orderId);
    try {
      const typed = tendered[orderId];
      const amount = typed ? parseZarToCents(typed) : fallbackCents;
      const next = await capturePayment({ data: { sessionId: context.sessionId, orderId, tenderedCents: amount } });
      setContext(mergeLocalContext(next));
      notifyLocalHub();
      setTendered((current) => ({ ...current, [orderId]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setBusyId(null);
    }
  };

  const handOver = async (orderId: string) => {
    setError(null);
    setBusyId(orderId);
    try {
      setContext(mergeLocalContext(await transitionOrder({ data: { sessionId: context.sessionId, orderId, status: "COLLECTED" } })));
      notifyLocalHub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handover failed.");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (orderId: string) => {
    setError(null);
    try {
      setContext(mergeLocalContext(await transitionOrder({ data: { sessionId: context.sessionId, orderId, status: "CANCELLED" } })));
      notifyLocalHub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed.");
    }
  };

  const collectQueue = context.orders.filter((order) => order.status === "READY");
  const payQueue = context.orders.filter(
    (order) => order.paymentStatus !== "PAID" && order.status !== "COLLECTED" && order.status !== "CANCELLED",
  );
  const kitchenQueue = context.orders.filter(
    (order) => (order.status === "PLACED" || order.status === "PREPARING") && order.paymentStatus === "PAID",
  );

  return (
    <StationShell
      role="Cashier"
      staffName={context.staff.name}
      title="Sell, take payment, hand over"
      subtitle={`${context.shopName} · ${context.branchName}`}
      pendingOutbox={context.pendingOutbox}
      onGoOnline={() => void goOnline()}
      onExit={exit}
    >
      <FirstShiftGuide role="CASHIER" />
      {!context.shift ? <Notice>Sales are paused. Ask the manager to open the cash shift.</Notice> : null}
      {error ? <Notice tone="alert">{error}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <Field label="Search menu">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kota, chips, coke" />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={`h-10 rounded-md px-3 text-sm font-semibold ${category === item ? "bg-ink text-paper" : "border border-line bg-warm"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                disabled={product.stock <= 0}
                onClick={() => add(product.id, product.name, product.priceCents)}
                className="min-h-20 rounded-lg border border-line bg-warm p-3 text-left hover:border-signal disabled:opacity-40"
              >
                <strong className="block text-sm">{product.name}</strong>
                <span className="font-mono text-xs tabular-nums text-muted">{formatZar(product.priceCents)}</span>
                {product.stock <= 0 ? (
                  <span className="mt-1 block text-xs text-alert">Out</span>
                ) : product.stock <= 5 ? (
                  <span className="mt-1 block text-xs text-signal">Low · {product.stock}</span>
                ) : null}
              </button>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="flex items-center gap-2 font-display text-2xl font-medium">
              <ShoppingBasket className="h-5 w-5" /> Basket
            </h2>
            <div className="mt-4 space-y-2">
              {basket.map((line) => (
                <div key={line.productId} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{line.name}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="grid h-10 w-10 place-items-center rounded-md border border-line"
                      onClick={() =>
                        setBasket((current) =>
                          current
                            .map((row) => (row.productId === line.productId ? { ...row, qty: row.qty - 1 } : row))
                            .filter((row) => row.qty > 0),
                        )
                      }
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-6 text-center font-mono tabular-nums">{line.qty}</span>
                    <button
                      type="button"
                      className="grid h-10 w-10 place-items-center rounded-md border border-line"
                      onClick={() => add(line.productId, line.name, line.priceCents)}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {basket.length === 0 ? <p className="text-sm text-muted">Tap a menu item to start the order.</p> : null}
            </div>
            <div className="mt-4 flex items-center justify-between font-mono text-lg tabular-nums">
              <span>Total</span>
              <strong>{formatZar(total)}</strong>
            </div>
            <Button variant="ink" className="mt-4 w-full" disabled={placing || basket.length === 0 || !context.shift} onClick={() => void place()}>
              {placing ? "Sending…" : "Send to kitchen"}
            </Button>
          </Card>

          {collectQueue.length > 0 ? (
            <Card className="space-y-3">
              <h2 className="font-display text-2xl font-medium">Hand over</h2>
              {collectQueue.map((order) => (
                <div key={order.id} className="ticket-ready rounded-lg border border-live/30 bg-live/10 p-3">
                  <div className="flex items-center justify-between">
                    <strong className="font-mono text-xl">#{order.number}</strong>
                    <Badge tone={order.paymentStatus === "PAID" ? "live" : "signal"}>{order.paymentStatus}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{order.items.map((item) => `${item.qty}× ${item.name}`).join(", ")}</p>
                  {order.paymentStatus === "PAID" ? (
                    <Button className="mt-3 w-full" disabled={busyId === order.id} type="button" onClick={() => void handOver(order.id)}>
                      Hand over
                    </Button>
                  ) : (
                    <p className="mt-2 text-sm">Kitchen is ready. Take payment first.</p>
                  )}
                </div>
              ))}
            </Card>
          ) : null}

          <Card className="space-y-3">
            <h2 className="font-display text-2xl font-medium">Take payment</h2>
            {payQueue.map((order) => {
              const typed = tendered[order.id];
              let changeLabel = "Exact cash is fine";
              if (typed) {
                try {
                  const amount = parseZarToCents(typed);
                  const change = amount - order.totalCents;
                  changeLabel = change >= 0 ? `Change ${formatZar(change)}` : "Still short";
                } catch {
                  changeLabel = "Enter a valid amount";
                }
              }
              return (
                <div key={order.id} className="rounded-lg bg-warm p-3">
                  <div className="flex items-center justify-between">
                    <strong className="font-mono">#{order.number}</strong>
                    <Badge tone="signal">{order.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{order.items.map((item) => `${item.qty}× ${item.name}`).join(", ")}</p>
                  <p className="mt-1 font-mono text-sm tabular-nums">{formatZar(order.totalCents)}</p>
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="Cash tendered"
                      value={typed ?? ""}
                      onChange={(event) => setTendered((current) => ({ ...current, [order.id]: event.target.value }))}
                    />
                    <Button variant="secondary" type="button" disabled={busyId === order.id} onClick={() => void pay(order.id, order.totalCents)}>
                      Cash
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted">{changeLabel}</p>
                  {order.status === "PLACED" ? (
                    <button type="button" className="mt-2 text-xs font-semibold text-alert" onClick={() => void cancel(order.id)}>
                      Cancel unpaid order
                    </button>
                  ) : null}
                </div>
              );
            })}
            {payQueue.length === 0 ? <p className="text-sm text-muted">No unpaid tickets.</p> : null}
            {kitchenQueue.length > 0 ? (
              <p className="text-xs text-muted">
                {kitchenQueue.length} paid ticket{kitchenQueue.length === 1 ? "" : "s"} still in kitchen.
              </p>
            ) : null}
          </Card>
        </div>
      </div>
      <OrderHistory orders={context.orders} shopName={context.shopName} branchName={context.branchName} />
    </StationShell>
  );
}
