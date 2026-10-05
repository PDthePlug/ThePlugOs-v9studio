import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Delete } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { claimPairingCode, getStationGate, signInStation } from "@/lib/hub";
import { ROLE_LABEL, type StaffRole } from "@/lib/types";
import { writeDeviceId, writeStationSession } from "@/lib/session-store";

export const Route = createFileRoute("/station/")({ component: StationGate });

function StationGate() {
  const navigate = useNavigate();
  const [shop, setShop] = useState<Awaited<ReturnType<typeof getStationGate>> | null>(null);
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("Counter tablet");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pairedRole = shop?.pairedRole;
  const [pairingId, setPairingId] = useState("");
  useEffect(() => { setPairingId(new URLSearchParams(window.location.search).get("invite") ?? ""); }, []);

  useEffect(() => {
    void getStationGate().then(setShop).catch(() => undefined);
  }, []);

  const floorStaff = useMemo(() => {
    const active = shop?.staff.filter((row) => row.status === "ACTIVE" && row.role !== "OWNER") ?? [];
    if (pairedRole === "CASHIER" || pairedRole === "KITCHEN" || pairedRole === "MANAGER") {
      return active.filter((row) => row.role === pairedRole);
    }
    return active;
  }, [pairedRole, shop]);

  useEffect(() => {
    if (!staffId && floorStaff[0]) setStaffId(floorStaff[0].id);
  }, [floorStaff, staffId]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signInStation({ data: { staffId, pin } });
      writeStationSession({
        sessionId: result.sessionId,
        staffId: result.staff.id,
        role: result.staff.role,
        name: result.staff.name,
      });
      const path =
        result.staff.role === "KITCHEN"
          ? "/station/kitchen"
          : result.staff.role === "MANAGER"
            ? "/station/manager"
            : "/station/cashier";
      await navigate({ to: path });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const pair = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await claimPairingCode({ data: { pairingId, code, deviceName } });
      writeDeviceId(result.deviceId, result.role);
      setCode("");
      setNotice(`This device is now a ${ROLE_LABEL[result.role as StaffRole]} station. Sign in with that role's PIN.`);
      const next = await getStationGate();
      setShop(next);
      const match = next.staff.find((row) => row.role === result.role && row.status === "ACTIVE");
      if (match) setStaffId(match.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 text-ink">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">Start your shift</p>
          <h1 className="mt-3 font-display text-5xl font-medium tracking-tight">Who's working this station?</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-muted">
            Choose your name and enter your PIN. ThePlugOS opens only the tools for your role.
          </p>
          <div className="mt-8 space-y-4">
            {!shop ? <Notice>Pair this device to load the staff list. Owners can sign in to open their business.</Notice> : null}
            <Field label="Staff profile">
              <select
                className="h-12 w-full rounded-md border border-line bg-paper px-3"
                value={staffId}
                onChange={(event) => setStaffId(event.target.value)}
              >
                {floorStaff.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {ROLE_LABEL[row.role]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="PIN">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  className="h-12 rounded-md border border-line bg-warm font-mono text-lg tabular-nums hover:border-signal"
                  onClick={() => setPin((current) => (current + digit).slice(0, 8))}
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                className="col-span-2 h-12 rounded-md border border-line bg-paper text-sm font-semibold"
                onClick={() => setPin((current) => current.slice(0, -1))}
              >
                <span className="inline-flex items-center gap-2">
                  <Delete className="h-4 w-4" /> Clear last
                </span>
              </button>
            </div>
            {error ? <Notice tone="alert">{error}</Notice> : null}
            {notice ? <Notice tone="ok">{notice}</Notice> : null}
            <Button variant="ink" className="w-full" disabled={busy || !staffId} onClick={() => void signIn()}>
              {busy ? "Opening…" : "Open my workspace"}
            </Button>
            {shop && !pairedRole ? <Link to="/owner" className="text-sm font-semibold text-signal">
              Owner dashboard
            </Link> : <Link to="/login" className="text-sm font-semibold text-signal">Owner sign-in</Link>}
          </div>
        </Card>
        <Card className="space-y-4 p-8">
          <h2 className="font-display text-2xl font-medium">Pair this device</h2>
          <p className="text-sm leading-6 text-muted">
            Open the invitation link from the owner, then enter the 6-digit code. This tablet becomes a cashier, kitchen or manager station.
          </p>
          {pairedRole ? (
            <p className="rounded-lg bg-warm px-3 py-2 text-sm">
              Currently paired as {ROLE_LABEL[(pairedRole as StaffRole) || "CASHIER"]}.
            </p>
          ) : null}
          {!pairingId ? <Notice>Open the owner’s invitation link to pair this device.</Notice> : null}
          <Field label="Device name">
            <Input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
          </Field>
          <Field label="Pairing code">
            <Input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
          </Field>
          <Button variant="secondary" className="w-full" disabled={busy || !pairingId || code.length !== 6} onClick={() => void pair()}>
            Pair device
          </Button>
        </Card>
      </div>
    </main>
  );
}
