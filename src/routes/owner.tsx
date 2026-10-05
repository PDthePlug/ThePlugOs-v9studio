import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Radio, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationsReport } from "@/components/operations-report";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  addStaffMember,
  getShopState,
  issuePairingCode,
  resetStaffPin,
  revokeDevice,
  setStaffStatus,
  upsertProduct,
} from "@/lib/hub";
import { mergeLocalSnapshot, subscribeLocalHub } from "@/lib/local-hub";
import { formatZar, parseZarToCents } from "@/lib/money";
import { ROLE_LABEL, type ShopSnapshot, type StaffRole } from "@/lib/types";

export const Route = createFileRoute("/owner")({ component: OwnerPage });

function formatSeen(value: string | null) {
  if (!value) return "Never seen";
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (mins < 1) return "Just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  return new Date(value).toLocaleString("en-ZA");
}

function pairingLeft(expiresAt: string, now: number) {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return "Expired — issue a new code";
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, "0")} left`;
}

function OwnerPage() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [shop, setShop] = useState<ShopSnapshot | null>(null);
  const [tab, setTab] = useState<"overview" | "team" | "devices" | "menu" | "reports">("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"default" | "alert" | "ok">("default");
  const [pairing, setPairing] = useState<{ pairingId: string; code: string; role: StaffRole; expiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("CASHIER");
  const [staffPin, setStaffPin] = useState("");
  const [pinReset, setPinReset] = useState<{ id: string; name: string; pin: string } | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productCategory, setProductCategory] = useState("Plates");

  const reportError = (err: unknown) => { setMessageTone("alert"); setMessage(err instanceof Error ? err.message : "Could not save that change."); };
  const load = useCallback(async () => {
    try {
      const next = await getShopState();
      if (!next) { void navigate({ to: "/setup" }); return; }
      setShop(mergeLocalSnapshot(next));
      setLoadError(null);
    } catch(err) { setLoadError(err instanceof Error ? err.message : "Could not load the business."); }
  }, [navigate]);

  useEffect(() => {
    if (!isPending && user) void load();
    const timer = window.setInterval(() => {
      if (!isPending && user) void load();
    }, 3000);
    const unsub = subscribeLocalHub(() => {
      if (!isPending && user) void load();
    });
    return () => {
      window.clearInterval(timer);
      unsub();
    };
  }, [isPending, user, load]);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const alerts = useMemo(() => {
    if (!shop) return [];
    const items: string[] = [];
    if (!shop.shift) items.push("Cash shift is closed. Manager must open it before cashier can sell.");
    if (shop.pendingOutbox > 0) items.push(`${shop.pendingOutbox} update${shop.pendingOutbox === 1 ? "" : "s"} waiting to sync.`);
    const unpaid = shop.orders.filter((order) => order.paymentStatus === "UNPAID" && order.status !== "CANCELLED" && order.status !== "COLLECTED");
    if (unpaid.length > 0) items.push(`${unpaid.length} unpaid ticket${unpaid.length === 1 ? "" : "s"} on the floor.`);
    const late = shop.orders.filter((order) => {
      if (order.status !== "PLACED" && order.status !== "PREPARING") return false;
      return Date.now() - Date.parse(order.createdAt) > 10 * 60 * 1000;
    });
    if (late.length > 0) items.push(`${late.length} kitchen ticket${late.length === 1 ? "" : "s"} older than 10 minutes.`);
    return items;
  }, [shop]);

  if (isPending) return <main className="grid min-h-screen place-items-center bg-canvas">Loading…</main>;
  if (!user) return <RedirectToSignIn />;
  if (!shop) return <main className="min-h-screen bg-canvas p-8"><p>Opening business…</p>{loadError ? <Notice tone="alert">{loadError}</Notice> : null}<Button onClick={() => void load()}>Retry</Button></main>;

  const issue = async (role: StaffRole) => {
    setMessage(null);
    setPairing(null);
    try {
      const result = await issuePairingCode({ data: { role } });
      setPairing(result);
      setNow(Date.now());
      setMessageTone("ok");
      setMessage(`Pairing code ready for ${ROLE_LABEL[role]}.`);
    } catch (err) {
      setMessageTone("alert");
      setMessage(err instanceof Error ? err.message : "Could not issue a pairing code.");
    }
  };

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-4 rounded-xl border border-line bg-paper p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">Owner dashboard</p>
            <h1 className="mt-1 font-display text-4xl font-medium tracking-tight">Business heartbeat</h1>
            <p className="mt-1 text-sm text-muted">
              {shop.shop.name} · {shop.shop.branchName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" type="button" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Link to="/station" className="inline-flex h-12 items-center rounded-md bg-ink px-4 text-sm font-semibold text-paper">
              Open a station
            </Link>
            <UserButton />
          </div>
        </header>

        {alerts.map((item) => (
          <Notice key={item} tone={item.includes("closed") || item.includes("older") ? "alert" : "default"}>
            {item}
          </Notice>
        ))}

        <div className="flex flex-wrap gap-2">
          {(["overview", "team", "devices", "menu", "reports"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`h-11 rounded-md px-4 text-sm font-semibold capitalize ${tab === item ? "bg-ink text-paper" : "bg-paper text-ink border border-line"}`}
            >
              {item}
            </button>
          ))}
        </div>

        {message ? <Notice tone={messageTone}>{message}</Notice> : null}

        {tab === "overview" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Sales today", formatZar(shop.salesTodayCents)],
              ["Paid orders", String(shop.ordersToday)],
              ["Open tickets", String(shop.orders.filter(o=>["PLACED","PREPARING","READY"].includes(o.status)).length)],
              ["Active devices", String(shop.devices.filter(d=>d.status === "ACTIVE").length)],
            ].map(([label, value]) => (
              <Card key={label}>
                <span className="text-xs uppercase tracking-[0.14em] text-muted">{label}</span>
                <strong className="mt-2 block font-mono text-3xl tabular-nums">{value}</strong>
              </Card>
            ))}
            <Card className="sm:col-span-2 lg:col-span-4">
              <h2 className="font-display text-2xl font-medium">Live orders</h2>
              {shop.shift ? (
                <p className="mt-2 text-sm text-muted">Shift open · {shop.shift.openedBy}</p>
              ) : (
                <p className="mt-2 text-sm text-muted">No open shift.</p>
              )}
              <div className="mt-4 space-y-2">
                {shop.orders.slice(0, 10).map((order) => (
                  <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warm px-4 py-3">
                    <div>
                      <strong className="font-mono">#{order.number}</strong>
                      <span className="ml-2 text-sm text-muted">{order.items.map((item) => `${item.qty}× ${item.name}`).join(", ")}</span>
                    </div>
                    <div className="flex gap-2">
                      <Badge tone={order.paymentStatus === "PAID" ? "live" : "signal"}>{order.paymentStatus}</Badge>
                      <Badge tone={order.status === "READY" ? "live" : "muted"}>{order.status}</Badge>
                    </div>
                  </div>
                ))}
                {shop.orders.length === 0 ? <p className="text-sm text-muted">No orders yet. Open cashier and take the first one.</p> : null}
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "team" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card className="space-y-3">
              {shop.staff.map((member) => (
                <div key={member.id} className="space-y-3 rounded-lg bg-warm px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong>{member.name}</strong>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted">
                        {ROLE_LABEL[member.role]} · {member.status}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" type="button" onClick={() => setPinReset({ id: member.id, name: member.name, pin: "" })}>
                        Reset PIN
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() =>
                          void setStaffStatus({
                            data: { staffId: member.id, status: member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" },
                          }).then((next) => next && setShop(mergeLocalSnapshot(next))).catch(reportError)
                        }
                      >
                        {member.status === "ACTIVE" ? "Suspend" : "Restore"}
                      </Button>
                    </div>
                  </div>
                  {pinReset?.id === member.id ? (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        inputMode="numeric"
                        placeholder="New PIN"
                        value={pinReset.pin}
                        onChange={(event) => setPinReset({ ...pinReset, pin: event.target.value.replace(/\D/g, "").slice(0, 8) })}
                      />
                      <Button
                        variant="ink"
                        type="button"
                        onClick={() => {
                          void resetStaffPin({ data: { staffId: member.id, pin: pinReset.pin } })
                            .then(() => {
                              setMessageTone("ok");
                              setMessage(`PIN updated for ${member.name}. Tell them once.`);
                              setPinReset(null);
                            })
                            .catch((err) => {
                              setMessageTone("alert");
                              setMessage(err instanceof Error ? err.message : "PIN reset failed.");
                            });
                        }}
                      >
                        Save PIN
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </Card>
            <Card className="space-y-3">
              <h2 className="font-display text-2xl font-medium">Add staff</h2>
              <Field label="Name">
                <Input value={staffName} onChange={(event) => setStaffName(event.target.value)} />
              </Field>
              <Field label="Role">
                <select
                  className="h-12 w-full rounded-md border border-line bg-paper px-3"
                  value={staffRole}
                  onChange={(event) => setStaffRole(event.target.value as StaffRole)}
                >
                  <option value="CASHIER">Cashier</option>
                  <option value="KITCHEN">Kitchen</option>
                  <option value="MANAGER">Manager</option>
                </select>
              </Field>
              <Field label="PIN">
                <Input inputMode="numeric" value={staffPin} onChange={(event) => setStaffPin(event.target.value.replace(/\D/g, "").slice(0, 8))} />
              </Field>
              <Button
                variant="ink"
                type="button"
                onClick={() =>
                  void addStaffMember({ data: { name: staffName, role: staffRole, pin: staffPin } })
                    .then((next) => {
                      if (next) setShop(mergeLocalSnapshot(next));
                      setStaffName("");
                      setStaffPin("");
                      setMessageTone("ok");
                      setMessage(`${staffName} is on the floor. Tell them their PIN once.`);
                    })
                    .catch((err) => {
                      setMessageTone("alert");
                      setMessage(err instanceof Error ? err.message : "Could not add staff.");
                    })
                }
              >
                Add to the floor
              </Button>
            </Card>
          </div>
        ) : null}

        {tab === "devices" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card className="space-y-3">
              {shop.devices.map((device) => (
                <div key={device.id} className="flex items-center justify-between rounded-lg bg-warm px-4 py-3">
                  <div>
                    <strong>{device.name}</strong>
                    <p className="text-xs uppercase tracking-[0.14em] text-muted">
                      {ROLE_LABEL[device.role]} · {formatSeen(device.lastSeen)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={device.status === "ACTIVE" ? "live" : "alert"}>{device.status}</Badge>{device.status === "ACTIVE" ? <Button variant="danger" onClick={() => void revokeDevice({data:{deviceId:device.id}}).then(next => next && setShop(next)).catch(reportError)}>Revoke</Button> : null}</div>
                </div>
              ))}
            </Card>
            <Card className="space-y-3">
              <h2 className="font-display text-2xl font-medium">Pair a station</h2>
              <p className="text-sm leading-6 text-muted">Copy the invitation link to the other device and share its 6-digit code. The invitation expires after 10 minutes and works once.</p>
              <div className="flex flex-wrap gap-2">
                {(["CASHIER", "KITCHEN", "MANAGER"] as StaffRole[]).map((role) => (
                  <Button key={role} variant="secondary" type="button" onClick={() => void issue(role)}>
                    <Radio className="h-4 w-4" /> {ROLE_LABEL[role]}
                  </Button>
                ))}
              </div>
              {pairing ? (
                <div className="rounded-lg bg-ink px-4 py-5 text-paper">
                  <p className="text-xs uppercase tracking-[0.16em] text-signal-soft">{ROLE_LABEL[pairing.role]} code</p>
                  <p className="mt-2 font-mono text-4xl tabular-nums tracking-[0.2em]">{pairing.code}</p>
                  <p className="mt-3 text-sm text-signal-soft">{pairingLeft(pairing.expiresAt, now)}</p>
                  <Button className="mt-3" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/station?invite=${pairing.pairingId}`).then(() => { setMessageTone("ok"); setMessage("Invitation link copied."); }).catch(reportError)}>Copy invitation link</Button>
                  <a className="mt-3 block break-all text-xs underline" href={`/station?invite=${pairing.pairingId}`}>Open invitation</a>
                </div>
              ) : null}
            </Card>
          </div>
        ) : null}

        {tab === "menu" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card className="space-y-2">
              {shop.products.map((product) => (
                <div key={product.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warm px-4 py-3">
                  <div>
                    <strong>{product.name}</strong>
                    <p className="text-xs text-muted">
                      {product.category} · stock {product.stock}
                      {product.active ? "" : " · hidden"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono tabular-nums">{formatZar(product.priceCents)}</span>
                    <Button variant="secondary" onClick={() => { setEditingProductId(product.id); setProductName(product.name); setProductCategory(product.category); setProductPrice((product.priceCents/100).toFixed(2)); }}>Edit</Button>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() =>
                        void upsertProduct({
                          data: {
                            id: product.id,
                            name: product.name,
                            category: product.category,
                            priceCents: product.priceCents,
                            stock: product.stock,
                            active: !product.active,
                          },
                        }).then((next) => next && setShop(mergeLocalSnapshot(next))).catch(reportError)
                      }
                    >
                      {product.active ? "Hide" : "Show"}
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
            <Card className="space-y-3">
              <h2 className="font-display text-2xl font-medium">{editingProductId ? "Edit item" : "Add item"}</h2>
              <Field label="Name">
                <Input value={productName} onChange={(event) => setProductName(event.target.value)} />
              </Field>
              <Field label="Category">
                <Input value={productCategory} onChange={(event) => setProductCategory(event.target.value)} />
              </Field>
              <Field label="Price (R)">
                <Input value={productPrice} onChange={(event) => setProductPrice(event.target.value)} />
              </Field>
              <Button
                variant="ink"
                type="button"
                onClick={() => {
                  try {
                    void upsertProduct({
                      data: {
                        id: editingProductId,
                        name: productName,
                        category: productCategory,
                        priceCents: parseZarToCents(productPrice),
                        stock: 0,
                        active: true,
                      },
                    }).then((next) => {
                      if (next) setShop(mergeLocalSnapshot(next));
                      setProductName("");
                      setProductPrice("");
                      setEditingProductId(undefined);
                    }).catch(reportError);
                  } catch (err) {
                    setMessageTone("alert");
                    setMessage(err instanceof Error ? err.message : "Could not add item.");
                  }
                }}
              >
                {editingProductId ? "Save item" : "Add to menu"}
              </Button>
              {editingProductId ? <Button variant="ghost" onClick={() => {setEditingProductId(undefined); setProductName(""); setProductPrice("");}}>Cancel edit</Button> : null}
              <p className="text-xs text-muted">New items start at zero stock. The manager records stock at the stock desk.</p>
            </Card>
          </div>
        ) : null}
        {tab === "reports" ? <OperationsReport report={shop.report} products={shop.products} /> : null}
        {loadError ? <Notice tone="alert">{loadError}</Notice> : null}
      </div>
    </main>
  );
}
