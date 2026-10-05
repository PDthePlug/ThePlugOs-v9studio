import React from 'react';
import { Percent, ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';

interface VatSettingsControlProps {
  vatConfig: { enabled: boolean; rate: number };
  onUpdateVatConfig: (newConfig: { enabled: boolean; rate: number }) => void;
  userRole: 'OWNER' | 'MANAGER' | string;
}

export const VatSettingsControl: React.FC<VatSettingsControlProps> = ({
  vatConfig,
  onUpdateVatConfig,
  userRole,
}) => {
  if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
    return null; // Cashiers & other roles cannot see or configure VAT
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/30">
            <Percent className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">VAT settings</h3>
            <p className="text-xs text-slate-400">Available to owners and managers. Applied to eligible sales.</p>
          </div>
        </div>

        <button
          onClick={() => onUpdateVatConfig({ ...vatConfig, enabled: !vatConfig.enabled })}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all touch-btn ${
            vatConfig.enabled
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'bg-slate-950 text-slate-400 border border-slate-800'
          }`}
        >
          {vatConfig.enabled ? (
            <>
              <ToggleRight className="w-5 h-5 text-emerald-400" />
              <span>VAT ENABLED</span>
            </>
          ) : (
            <>
              <ToggleLeft className="w-5 h-5 text-slate-500" />
              <span>VAT DISABLED (OPTIONAL)</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-300 block">VAT Percentage Rate (%)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="30"
              step="0.5"
              disabled={!vatConfig.enabled}
              value={vatConfig.rate}
              onChange={(e) => onUpdateVatConfig({ ...vatConfig, rate: parseFloat(e.target.value) || 0 })}
              className={`w-28 bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-purple-500 ${
                !vatConfig.enabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            />
            <span className="text-xs text-slate-400">% SA Standard Sales Tax</span>
          </div>
        </div>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 text-xs text-slate-400 space-y-1">
          <p className="font-bold text-slate-200 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Applied automatically
          </p>
          <p>
            {vatConfig.enabled
              ? `Receipts and POS checkout will display ${vatConfig.rate}% VAT line item.`
              : 'VAT is currently disabled. Receipts will present total sales without tax calculations.'}
          </p>
        </div>
      </div>
    </div>
  );
};
