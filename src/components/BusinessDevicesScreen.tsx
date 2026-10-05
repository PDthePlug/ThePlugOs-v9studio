import React, { useEffect, useState } from 'react';
import { AlertTriangle, Radio, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { NetworkHealth } from '@plugos/core';

interface BusinessDevicesScreenProps {
  kernel: any;
  onClose?: () => void;
  branchName?: string;
  businessId: string;
  branchId: string;
  userRole?: string;
  sessionToken?: string;
}

/**
 * Device administration is intentionally unavailable until the staged cloud
 * enrollment receiver and native proof-of-possession flow are deployed. This
 * replaces the former browser RPC, synthetic printer success, and direct table
 * writes with an honest state rather than an unsafe approximation.
 */
export const BusinessDevicesScreen: React.FC<BusinessDevicesScreenProps> = ({
  kernel,
  onClose,
  branchName = 'Branch not configured'
}) => {
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!kernel?.hub) return;
    const update = (snapshot?: { networkHealth?: NetworkHealth }) => {
      setHealth(snapshot?.networkHealth || kernel.hub.getNetworkHealth());
    };
    update();
    return kernel.hub.subscribe(update);
  }, [kernel]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await kernel?.network?.refresh?.();
      setHealth(kernel?.hub?.getNetworkHealth?.() || null);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-slate-100 max-w-2xl mx-auto shadow-2xl space-y-6">
      <header className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl"><Radio className="w-6 h-6" /></div>
          <div>
            <h2 className="text-lg font-bold text-white">Business device authority</h2>
            <p className="text-xs text-slate-400">{branchName} · native enrollment only</p>
          </div>
        </div>
        {onClose && <button type="button" onClick={onClose} className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white" aria-label="Close device authority"><X className="w-5 h-5" /></button>}
      </header>

      <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 flex gap-3" role="status" aria-live="polite">
        <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-amber-100">No browser device administration</h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
            {health?.message || 'This browser does not hold an authenticated Hub device identity.'}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3 text-xs leading-relaxed text-slate-300">
        <div className="flex items-center gap-2 text-slate-100"><ShieldCheck className="w-4 h-4 text-emerald-300" /><strong>Required before a device can be shown, paired, renamed, revoked, or tested</strong></div>
        <ol className="list-decimal pl-4 space-y-1.5">
          <li>R001 staging clone and R002 credential rehearsal accepted.</li>
          <li>Native challenge/proof enrollment receiver deployed with source-aware throttling.</li>
          <li>Cloud-signed authorization bundle verified by the Android Hub.</li>
          <li>Measured native device registry and peripheral result reported back to this surface.</li>
        </ol>
      </section>

      <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">
        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh measured Hub state
      </button>
    </div>
  );
};
