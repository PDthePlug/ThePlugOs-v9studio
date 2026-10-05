import { RefreshCw, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Button } from "@/components/ui";
import { isOfflineMode } from "@/lib/session-store";
import { useEffect, useState } from "react";

export function StationShell({
  role,
  staffName,
  title,
  subtitle,
  pendingOutbox,
  onExit,
  onGoOnline,
  children,
}: {
  role: string;
  staffName: string;
  title: string;
  subtitle: string;
  pendingOutbox: number;
  onExit: () => void;
  onGoOnline?: () => void;
  children: ReactNode;
}) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(isOfflineMode());
    sync();
    window.addEventListener("offline", sync);
    window.addEventListener("online", sync);
    return () => { window.removeEventListener("offline", sync); window.removeEventListener("online", sync); };
  }, []);

  return (
    <main className="min-h-screen bg-canvas px-4 py-5 text-ink sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-xl border border-line bg-paper p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="signal">{role}</Badge>
              {offline ? <Badge tone="alert">Disconnected</Badge> : <Badge tone="live">Live</Badge>}
              {pendingOutbox > 0 ? <Badge>{pendingOutbox} waiting to sync</Badge> : null}
            </div>
            <h1 className="mt-3 font-display text-3xl font-medium tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
            <p className="mt-1 text-sm font-semibold">{staffName}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={onGoOnline}
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="ghost" type="button" onClick={onExit}>
              <LogOut className="h-4 w-4" /> Lock station
            </Button>
          </div>
        </header>
        {offline ? (
          <p className="rounded-lg border border-signal/30 bg-signal-soft/15 px-4 py-3 text-sm">
            Connection lost. Keep the basket open and reconnect before sending orders or taking payment.
          </p>
        ) : null}
        {children}
      </div>
    </main>
  );
}
