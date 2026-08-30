import React, { useState } from 'react';
import { 
  Activity, 
  Database, 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  ShieldCheck, 
  Layers, 
  Code2, 
  FileText, 
  CheckCircle2,
  Terminal,
  Server
} from 'lucide-react';

interface KernelInspectorProps {
  eventLedger: any[];
  outboxEvents: any[];
  isOnline: boolean;
  onFlushOutbox: () => void;
  onToggleNetwork: () => void;
  systemHealth: any;
}

export const KernelInspector: React.FC<KernelInspectorProps> = ({
  eventLedger,
  outboxEvents,
  isOnline,
  onFlushOutbox,
  onToggleNetwork,
  systemHealth
}) => {
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-amber-500 text-slate-950 p-3 rounded-xl">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">
                Kernel Event Engine Ledger & Outbox Inspector
              </h2>
              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                IMMUTABLE SOURCING
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Audit trail of all ULID-indexed events and background sync outbox state
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onToggleNetwork}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30 animate-pulse'
            }`}
          >
            {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span>{isOnline ? 'NETWORK: ONLINE' : 'NETWORK: OFFLINE'}</span>
          </button>

          {outboxEvents.length > 0 && (
            <button
              onClick={onFlushOutbox}
              className="bg-amber-500 text-slate-950 hover:bg-amber-400 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-amber-500/20"
            >
              <RefreshCw className="w-4 h-4" />
              Flush Outbox ({outboxEvents.length})
            </button>
          )}
        </div>
      </div>

      {/* System Health Component Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">STORAGE ENGINE</span>
            <span className="font-mono text-xs font-bold text-white">Mounted (In-Memory / Cloud)</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">EVENT ENGINE LEDGER</span>
            <span className="font-mono text-xs font-bold text-white">{eventLedger.length} Total Events</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
            <RefreshCw className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">SYNC OUTBOX QUEUE</span>
            <span className="font-mono text-xs font-bold text-amber-400">{outboxEvents.length} Pending</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">SECURITY ENGINE</span>
            <span className="font-mono text-xs font-bold text-emerald-400">Active Enforcement</span>
          </div>
        </div>

      </div>

      {/* Main Grid: Event Ledger Table & JSON Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Event Table */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-white text-base">Immutable Event Log</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">Showing {eventLedger.length} events</span>
          </div>

          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 sticky top-0 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="p-2.5">Event ID (ULID)</th>
                  <th className="p-2.5">Action</th>
                  <th className="p-2.5">Entity</th>
                  <th className="p-2.5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {eventLedger.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500 font-sans italic">
                      No events published yet in this session.
                    </td>
                  </tr>
                ) : (
                  [...eventLedger].reverse().map((event) => {
                    const isSelected = selectedEvent?.eventId === event.eventId;
                    return (
                      <tr
                        key={event.eventId}
                        onClick={() => setSelectedEvent(event)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-amber-500/20 text-white font-bold' : 'hover:bg-slate-950/60 text-slate-300'
                        }`}
                      >
                        <td className="p-2.5 text-amber-400 font-bold">{event.eventId?.slice(-10) || event.eventId}</td>
                        <td className="p-2.5">
                          <span className="bg-slate-950 text-slate-200 border border-slate-800 px-2 py-0.5 rounded">
                            {event.action}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-400">{event.entityType}#{event.entityId?.slice(0, 8)}</td>
                        <td className="p-2.5 text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: JSON Payload Details */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Code2 className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-white text-base">Payload Inspector</h3>
            </div>
            {selectedEvent && (
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                VERIFIED ULID
              </span>
            )}
          </div>

          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-amber-300 overflow-auto max-h-[420px]">
            {selectedEvent ? (
              <pre className="whitespace-pre-wrap">{JSON.stringify(selectedEvent, null, 2)}</pre>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-center font-sans italic">
                Click an event row on the left to inspect its exact payload
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
