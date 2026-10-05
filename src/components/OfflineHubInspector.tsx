import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Server, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import type { DeviceNode, HubSnapshot, NetworkHealth } from '@plugos/core';

interface OfflineHubInspectorProps {
  kernel: any;
  onClose?: () => void;
}

const emptySnapshot = (): HubSnapshot => ({
  devices: [],
  networkHealth: {
    mode: 'NATIVE_HUB_REQUIRED',
    availability: 'UNAVAILABLE',
    localPeerCount: 0,
    packetLossRate: null,
    latencyMs: null,
    outboxDepth: 0,
    inboxDepth: 0,
    lastSyncTimestamp: null,
    cloudConnected: false,
    cloudStatus: 'UNKNOWN',
    activeTransport: 'UNAVAILABLE',
    message: 'Waiting for local Hub status.'
  },
  failures: [],
  transportMetrics: [],
  outbox: [],
  inbox: []
});

function StatusPill({ health }: { health: NetworkHealth }) {
  const isReady = health.availability === 'READY';
  const isError = health.availability === 'ERROR';
  const tone = isReady ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : isError ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200';
  return <span className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${tone}`}>{health.availability}</span>;
}

function DeviceCard({ device }: { device: DeviceNode }) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-100">{device.name}</h4>
          <p className="mt-1 text-[11px] text-slate-400 font-mono">{device.id}</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${device.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200'}`}>{device.status}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-slate-500">Role</dt><dd className="mt-0.5 text-slate-200">{device.role}</dd></div>
        <div><dt className="text-slate-500">Transport</dt><dd className="mt-0.5 text-slate-200">{device.connectionType}</dd></div>
        <div><dt className="text-slate-500">Last heartbeat</dt><dd className="mt-0.5 text-slate-200">{device.lastHeartbeat || 'Not reported'}</dd></div>
        <div><dt className="text-slate-500">Queued events</dt><dd className="mt-0.5 text-slate-200">{device.queuedEvents}</dd></div>
      </dl>
    </article>
  );
}

export function OfflineHubInspector({ kernel, onClose }: OfflineHubInspectorProps) {
  const [snapshot, setSnapshot] = useState<HubSnapshot>(emptySnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    if (!kernel?.hub) return;
    setSnapshot({
      devices: kernel.hub.getDevices(),
      networkHealth: kernel.hub.getNetworkHealth(),
      failures: kernel.hub.getFailures(),
      transportMetrics: kernel.hub.getTransportMetrics(),
      outbox: kernel.hub.getOutbox(),
      inbox: kernel.hub.getInbox()
    });
    return kernel.hub.subscribe((next: HubSnapshot) => setSnapshot(next));
  }, [kernel]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await kernel?.network?.refresh?.();
      setSnapshot({
        devices: kernel.hub.getDevices(),
        networkHealth: kernel.hub.getNetworkHealth(),
        failures: kernel.hub.getFailures(),
        transportMetrics: kernel.hub.getTransportMetrics(),
        outbox: kernel.hub.getOutbox(),
        inbox: kernel.hub.getInbox()
      });
    } catch (cause: any) {
      setRefreshError(cause?.message || 'The native Hub status could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const health = snapshot.networkHealth;
  const nativeHubReady = health.availability === 'READY';

  return (
    <div className="bg-slate-900 text-slate-100 rounded-xl border border-slate-800 shadow-2xl overflow-hidden max-w-5xl w-full mx-auto my-4">
      <header className="p-6 bg-slate-950 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400"><Server className="w-6 h-6" /></div>
          <div>
            <div className="flex items-center gap-2"><h2 className="text-xl font-bold tracking-tight text-slate-100">Local Hub control plane</h2><StatusPill health={health} /></div>
            <p className="text-xs text-slate-400 mt-1">Only the Android Cashier Hub is allowed to report nearby terminals, local delivery, or durable outbox state.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"><RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button>
          {onClose && <button onClick={onClose} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700"><X className="w-3.5 h-3.5" />Close</button>}
        </div>
      </header>

      <main className="p-6 space-y-6">
        {!nativeHubReady ? (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 flex gap-3" aria-live="polite">
            <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-amber-100">No local operating authority is attached</h3>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/80">{health.message}</p>
              <p className="mt-3 text-xs text-slate-300">This is deliberate: a browser tab, `BroadcastChannel`, or manually entered IP address is not a secure substitute for the Cashier Hub.</p>
            </div>
          </section>
        ) : (
          <>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4"><p className="text-xs text-slate-500">Cloud replica</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-100">{health.cloudStatus === 'CONNECTED' ? <Wifi className="w-4 h-4 text-emerald-300" /> : <WifiOff className="w-4 h-4 text-amber-300" />}{health.cloudStatus}</p></div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4"><p className="text-xs text-slate-500">Pending cloud acknowledgements</p><p className="mt-2 text-2xl font-bold text-slate-100">{health.outboxDepth}</p></div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4"><p className="text-xs text-slate-500">Authenticated local peers</p><p className="mt-2 text-2xl font-bold text-slate-100">{health.localPeerCount}</p></div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-emerald-300" /><h3 className="text-sm font-semibold text-slate-100">Native Hub device registry</h3></div>
              {snapshot.devices.length ? <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{snapshot.devices.map((device) => <DeviceCard key={device.id} device={device} />)}</div> : <p className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">The native Hub has not reported any authorized devices.</p>}
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3"><Database className="w-4 h-4 text-amber-300" /><h3 className="text-sm font-semibold text-slate-100">Durable event outbox</h3></div>
              {snapshot.outbox.length ? <div className="rounded-xl border border-slate-800 overflow-hidden"><table className="w-full text-left text-xs"><thead className="bg-slate-950 text-slate-400"><tr><th className="p-3">Event</th><th className="p-3">Action</th><th className="p-3">Recorded</th></tr></thead><tbody className="divide-y divide-slate-800">{snapshot.outbox.map((event) => <tr key={event.eventId}><td className="p-3 font-mono text-slate-300">{event.eventId}</td><td className="p-3 text-slate-200">{event.action}</td><td className="p-3 text-slate-400">{event.timestamp}</td></tr>)}</tbody></table></div> : <p className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400 flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />No pending Hub events are currently reported. This does not claim cloud synchronization unless the Hub reports a connected cloud replica.</p>}
            </section>
          </>
        )}
        {refreshError && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-100" role="alert">{refreshError}</p>}
      </main>
    </div>
  );
}
