import React, { useState } from 'react';
import { UserSession } from '../types';
import { OfflineHubInspector } from '../components/OfflineHubInspector';
import { 
  ShieldAlert, 
  Terminal, 
  Cpu, 
  Key, 
  Wifi, 
  RefreshCw, 
  CheckCircle2, 
  Layers, 
  Search,
  Database,
  Lock,
  Radio
} from 'lucide-react';

interface AdminWorkspaceProps {
  session: UserSession;
  kernel: any;
  kernelEvents: any[];
}

export const AdminWorkspace: React.FC<AdminWorkspaceProps> = ({
  session,
  kernel,
  kernelEvents
}) => {
  const [activeTab, setActiveTab] = useState<'EVENT_BUS' | 'USERS' | 'DEVICES' | 'SECURITY'>('EVENT_BUS');
  const [staffList, setStaffList] = useState([]);
  const [filterEvent, setFilterEvent] = useState<string>('');

  const filteredEvents = kernelEvents.filter(e => 
    !filterEvent || e.type.toLowerCase().includes(filterEvent.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* Compact Header & Mobile Navigation Tabs */}
      <div className="plug-workspace-bar bg-slate-900 border border-slate-800 p-3 sm:p-4 rounded-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">System Administrator Hub</h1>
                <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                  ADMIN
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {session.branchName} • Device: {session.deviceId}
              </p>
            </div>
          </div>
        </div>

        {/* Admin Navigation Tabs (Horizontal swipe on mobile) */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('EVENT_BUS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              activeTab === 'EVENT_BUS' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            ⚡ Kernel Event Ledger ({kernelEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('USERS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              activeTab === 'USERS' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            🔑 Staff Roles & PINs
          </button>
          <button
            onClick={() => setActiveTab('DEVICES')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              activeTab === 'DEVICES' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            📡 Local Mesh Devices
          </button>
        </div>
      </div>

      {/* Tab View 1: Event Bus Inspector */}
      {activeTab === 'EVENT_BUS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 font-mono">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-bold text-white">Kernel Immutable Event Log</h2>
            </div>
            
            <input
              type="text"
              value={filterEvent}
              onChange={(e) => setFilterEvent(e.target.value)}
              placeholder="Filter event type..."
              className="bg-slate-950 border border-slate-800 text-xs text-slate-200 px-3 py-1.5 rounded-xl w-full sm:w-64 font-sans"
            />
          </div>

          {filteredEvents.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center font-sans">No events in stream matching filter.</p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {filteredEvents.map((evt, idx) => (
                <div key={idx} className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-1.5 text-xs">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-amber-400">[{evt.type}]</span>
                    <span className="text-slate-500">{new Date(evt.timestamp || Date.now()).toLocaleTimeString()}</span>
                  </div>
                  <pre className="text-[10px] text-slate-300 bg-slate-900/60 p-2 rounded-lg overflow-x-auto">
                    {JSON.stringify(evt.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab View 2: Staff & PIN Management */}
      {activeTab === 'USERS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Key className="w-4 h-4 text-rose-400" /> Staff Credentials & Security Roles
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="p-3">Staff Name</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Auth PIN</th>
                  <th className="p-3">Assigned Branch</th>
                  <th className="p-3">Security Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {staffList.map(s => (
                  <tr key={s.id} className="hover:bg-slate-950/50">
                    <td className="p-3 font-bold text-white">{s.name}</td>
                    <td className="p-3 font-mono text-amber-400 font-bold">{s.role}</td>
                    <td className="p-3 font-mono text-slate-400 font-bold">••••</td>
                    <td className="p-3 text-slate-400">{s.branchName || 'Branch not configured'}</td>
                    <td className="p-3">
                      <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                        ENFORCED
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

// Tab View 3: Mesh Devices & Offline Hub Inspector
      {activeTab === 'DEVICES' && (
        <div>
          <OfflineHubInspector kernel={kernel} />
        </div>
      )}

    </div>
  );
};
