import React, { useState } from 'react';
import { ShiftInfo, OrderRecord } from '../types';
import { 
  LogOut, 
  Banknote, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  X, 
  Printer 
} from 'lucide-react';

interface ShiftCloseModalProps {
  shift: ShiftInfo | null;
  orders: OrderRecord[];
  onConfirmClose: (closingCashCount: number, expectedTotal: number) => void;
  onCancel: () => void;
}

export const ShiftCloseModal: React.FC<ShiftCloseModalProps> = ({
  shift,
  orders,
  onConfirmClose,
  onCancel
}) => {
  if (!shift) return null;

  const cashOrdersTotal = orders
    .filter(o => o.paymentMethod === 'CASH')
    .reduce((sum, o) => sum + o.total, 0);

  const expectedCashTotal = shift.openingFloat + cashOrdersTotal;
  const [actualCashCount, setActualCashCount] = useState<string>(expectedCashTotal.toString());

  const actualNum = parseFloat(actualCashCount) || 0;
  const discrepancy = actualNum - expectedCashTotal;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5">
        
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <LogOut className="w-5 h-5 text-rose-400" />
            <h3 className="font-bold text-white text-base">Close and balance shift</h3>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Opening Cash Float:</span>
            <span className="font-mono text-slate-200 font-bold">R {shift.openingFloat.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Shift Cash Sales:</span>
            <span className="font-mono text-emerald-400 font-bold">R {cashOrdersTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-200 font-bold pt-2 border-t border-slate-800 text-sm">
            <span>Expected Drawer Cash:</span>
            <span className="font-mono text-amber-400">R {expectedCashTotal.toFixed(2)}</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1">
            Actual Cash Counted in Drawer (R)
          </label>
          <div className="relative">
            <Banknote className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="number"
              step="1"
              value={actualCashCount}
              onChange={(e) => setActualCashCount(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
            />
          </div>
        </div>

        {/* Discrepancy indicator */}
        <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
          discrepancy === 0
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : discrepancy > 0
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
        }`}>
          {discrepancy === 0 ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>Perfect Balance! Zero cash discrepancy.</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span>
                Discrepancy: <strong className="font-mono">R {Math.abs(discrepancy).toFixed(2)}</strong> {discrepancy > 0 ? 'OVERAGE' : 'SHORTAGE'}
              </span>
            </>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-slate-800 text-slate-400 font-semibold text-xs hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirmClose(actualNum, expectedCashTotal)}
            className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-xs shadow-md shadow-rose-500/20"
          >
            Close Shift & Publish Log
          </button>
        </div>

      </div>
    </div>
  );
};
