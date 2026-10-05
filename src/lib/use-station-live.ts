import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { endStationSession, getStationContext } from "@/lib/hub";
import { flushLocalHub, mergeLocalContext, subscribeLocalHub } from "@/lib/local-hub";
import { clearStationSession, isOfflineMode, readStationSession } from "@/lib/session-store";
import type { StaffRole, StationContext } from "@/lib/types";

export function useStationLive(expectedRole: StaffRole, pollMs = 2000) {
  const navigate = useNavigate();
  const [session] = useState(() => readStationSession());
  const [context, setContext] = useState<StationContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: StationContext) => {
    setContext(mergeLocalContext(next));
    setError(null);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    if (isOfflineMode()) {
      setContext((current) => (current ? mergeLocalContext(current) : current));
      return;
    }
    try {
      const next = await getStationContext({ data: { sessionId: session.sessionId } });
      apply(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the station.");
    }
  }, [apply, session]);

  const goOnline = useCallback(async () => {
    if (!session) return;
    try {
      if (session.role === "CASHIER" || session.role === "MANAGER") {
        const flushed = await flushLocalHub(session.sessionId);
        if (flushed) {
          apply(flushed);
          return;
        }
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync offline tickets.");
      await load();
    }
  }, [apply, load, session]);

  useEffect(() => {
    if (!session || session.role !== expectedRole) {
      void navigate({ to: "/station" });
      return;
    }
    void getStationContext({ data: { sessionId: session.sessionId } })
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not open this station."));
    const timer = window.setInterval(() => void load(), pollMs);
    const unsub = subscribeLocalHub(() => {
      setContext((current) => (current ? mergeLocalContext(current) : current));
      if (!isOfflineMode()) void load();
    });
    const onBrowserOnline = () => {
      if (!isOfflineMode()) void goOnline();
    };
    window.addEventListener("online", onBrowserOnline);
    return () => {
      window.clearInterval(timer);
      unsub();
      window.removeEventListener("online", onBrowserOnline);
    };
  }, [apply, expectedRole, goOnline, load, navigate, pollMs, session]);

  const exit = useCallback(() => {
    if (session) void endStationSession({ data: { sessionId: session.sessionId } });
    clearStationSession();
    void navigate({ to: "/station" });
  }, [navigate, session]);

  return { session, context, setContext: apply, error, setError, load, goOnline, exit };
}
