import React, { useState } from 'react';
import { UserSession, OrderRecord, StaffMember, ShiftInfo } from '../types';
import { ReceiptModal } from './ReceiptModal';
import { 
  Lock, 
  History, 
  FileText, 
  Search, 
  Printer, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  DollarSign, 
  Users, 
  X,
  CreditCard,
  Banknote
} from 'lucide-react';

interface ShiftsAndSalesLedgerProps {
  session: UserSession;
  orders: OrderRecord[];
  staffList?: StaffMember[];
  vatConfig?: { enabled: boolean; rate: number };
  onVoidOrder?: (orderId: string, voidedBy: string) => void;
  kernel?: any;
}

export const ShiftsAndSalesLedger: React.FC<ShiftsAndSalesLedgerProps> = ({
  session,
  orders,
  staffList = [],
  vatConfig,
  onVoidOrder,
  kernel
}) => {
  const [receiptSearch, setReceiptSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'PENDING' | 'CANCELLED'>('ALL');
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<OrderRecord | null>(null);

  // Active Shifts State
  const [activeShift, setActiveShift] = useState<ShiftInfo>({
    id: `shf-${session.branchId || 'main'}-01`,
    branchId: session.branchId || '',
    branchName: session.branchName || 'Unknown Branch',
    operatorId: session.userId,
    operatorName: session.userName,
    role: session.role || 'CASHIER',
    openedAt: new Date().toISOString(),
    status: 'OPEN',
    openingFloat: 500.00,
    expectedCashTotal: 500.00,
    closingCashCount: 0,
    variance: 0,
    managerApproved: true
  });

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [actualCashInput, setActualCashInput] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');

  // Calculate shift stats
  const cashOrdersDuringShift = orders.filter(
    o => (o.paymentMethod === 'CASH' || o.paymentType === 'CASH') && o.status !== 'CANCELLED'
  );
  const totalCashSales = cashOrdersDuringShift.reduce((acc, o) => acc + (o.totalAmount || o.total || 0), 0);
  const expectedCashInDrawer = activeShift.openingFloat + totalCashSales;

  // Handle Close Shift
  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    const actualCount = parseFloat(actualCashInput) || 0;
    const diff = actualCount - expectedCashInDrawer;

    const closed: ShiftInfo = {
      ...activeShift,
      status: 'CLOSED',
      closedAt: new Date().toISOString(),
      closingCashCount: actualCount,
      expectedCashTotal: expectedCashInDrawer,
      variance: diff,
      managerApproved: true,
      notes: shiftNotes || `Shift reconciled by ${session.userName}.`
    };

    setActiveShift(closed);
    setIsShiftModalOpen(false);

    if (kernel?.events?.publish) {
      kernel.events.publish('SHIFT_CLOSED', {
        shiftId: closed.id,
        branchId: closed.branchId,
        cashierName: closed.operatorName,
        openingFloat: closed.openingFloat,
        expectedCash: closed.expectedCashTotal,
        actualCash: closed.closingCashCount,
        variance: closed.variance,
        timestamp: new Date().toISOString()
      });
    }
  };

  const cashiers = staffList.filter(s => s.role === 'CASHIER' || s.role === 'MANAGER' || s.role === 'OWNER');

  // Filtered orders for lookup
  const filteredOrders = orders.filter(o => {
    if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
    if (!receiptSearch) return true;
    const q = receiptSearch.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      (o.customerPhone && o.customerPhone.includes(q)) ||
      (o.cashierName && o.cashierName.toLowerCase().includes(q)) ||
      o.items.some(i => i.name.toLowerCase().includes(q))
    );
  });

  const totalSalesVolume = orders.reduce((acc, o) => acc + (o.totalAmount || o.total || 0), 0);
  const voidedOrdersCount = orders.filter(o => o.status === 'CANCELLED').length;

  return (
    <div className="space-y-6 font-mono">
      
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <p className="text-slate-400 font-medium flex items-center gap-1.5">
            <DollarSign className="w-4 h-4 text-emerald-400" /> Sales recorded
          </p>
          <p className="text-2xl font-black text-white font-mono">
            R{totalSalesVolume.toFixed(2)}
          </p>
          <p className="text-[10px] text-slate-500">{orders.length} Total Transactions</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <p className="text-slate-400 font-medium flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-purple-400" /> Active Cashier Shift
          </p>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${activeShift.status === 'OPEN' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <p className="text-lg font-black text-white font-mono">
              {activeShift.status === 'OPEN' ? 'SHIFT ACTIVE' : 'SHIFT CLOSED'}
            </p>
          </div>
          <p className="text-[10px] text-slate-400">Op: {activeShift.operatorName} • Float: R{activeShift.openingFloat.toFixed(2)}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <p className="text-slate-400 font-medium flex items-center gap-1.5">
            <Banknote className="w-4 h-4 text-amber-400" /> Expected Drawer Cash
          </p>
          <p className="text-2xl font-black text-amber-400 font-mono">
            R{expectedCashInDrawer.toFixed(2)}
          </p>
          <p className="text-[10px] text-slate-500">Float + Cash Sales</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <p className="text-slate-400 font-medium flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4 text-rose-400" /> Voided Orders
          </p>
          <p className="text-2xl font-black text-rose-400 font-mono">
            {voidedOrdersCount} Voids
          </p>
          <p className="text-[10px] text-slate-500">Refunds Processed</p>
        </div>
      </div>

      {/* Active Cashier Shift Control Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Cashier shifts</h3>
              <p className="text-xs text-slate-400">Reconcile till drawers, monitor cash floats, and issue shift closures</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeShift.status === 'OPEN' ? (
              <button
                onClick={() => setIsShiftModalOpen(true)}
                className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-lg"
              >
                <Lock className="w-4 h-4" /> Reconcile & Close Cashier Shift
              </button>
            ) : (
              <button
                onClick={() => {
                  setActiveShift({
                    id: `shf-${Date.now()}`,
                    branchId: session.branchId || '',
                    branchName: session.branchName || 'Unknown Branch',
                    operatorId: session.userId,
                    operatorName: session.userName,
                    role: session.role || 'CASHIER',
                    openedAt: new Date().toISOString(),
                    status: 'OPEN',
                    openingFloat: 500.00,
                    expectedCashTotal: 500.00,
                    closingCashCount: 0,
                    variance: 0,
                    managerApproved: true
                  });
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-lg"
              >
                <Clock className="w-4 h-4" /> Start New Cashier Shift
              </button>
            )}
          </div>
        </div>

        {/* Active Cashier List Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {cashiers.length === 0 ? (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 text-xs col-span-3">
              No registered cashiers found.
            </div>
          ) : (
            cashiers.map(staff => (
              <div key={staff.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-white">{staff.name}</p>
                  <p className="text-[11px] text-slate-500">{staff.role}</p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {staff.activeShift ? 'ACTIVE' : 'READY'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Receipt & Sales Lookup Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Receipts & sales search</h3>
              <p className="text-xs text-slate-400">Find a sale, reprint its receipt, or process a manager-approved void.</p>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="PENDING">Pending</option>
              <option value="CANCELLED">Cancelled / Voided</option>
            </select>

            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-500" />
              <input
                type="text"
                placeholder="Lookup Order ID, Phone, Item..."
                value={receiptSearch}
                onChange={(e) => setReceiptSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Transaction Ledger List */}
        <div className="divide-y divide-slate-800 max-h-96 overflow-y-auto pr-1">
          {filteredOrders.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              No matching transactions found in the sales ledger.
            </div>
          ) : (
            filteredOrders.map(ord => (
              <div key={ord.id} className="py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-950/40 px-2 rounded-xl transition-all">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white text-xs">{ord.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      ord.status === 'CANCELLED' 
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' 
                        : ord.status === 'COMPLETED'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}>
                      {ord.status}
                    </span>
                    <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold">
                      {ord.paymentMethod || ord.paymentType || 'CASH'}
                    </span>
                    <span className="text-slate-500 text-[11px]">{new Date(ord.createdAt).toLocaleString()}</span>
                  </div>
                  
                  <p className="text-slate-400 text-[11px]">
                    Cashier: <span className="text-slate-300 font-semibold">{ord.cashierName || 'Cashier Terminal'}</span> • Phone: <span className="text-slate-300">{ord.customerPhone || 'Walk-in'}</span>
                  </p>
                  
                  <p className="text-slate-400 text-[11px] line-clamp-1">
                    Items: {ord.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <span className="font-bold text-amber-400 text-sm font-mono mr-2">
                    R{(ord.totalAmount || ord.total || 0).toFixed(2)}
                  </span>
                  
                  <button
                    onClick={() => setSelectedReceiptOrder(ord)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all touch-btn"
                  >
                    <Printer className="w-3.5 h-3.5 text-blue-400" /> Receipt
                  </button>

                  {ord.status !== 'CANCELLED' && onVoidOrder && (
                    <button
                      onClick={() => {
                        if (confirm(`Void Order #${ord.id}? This will restore inventory stock.`)) {
                          onVoidOrder(ord.id, session.userName);
                        }
                      }}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all touch-btn"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Void / Refund
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Close Shift Modal */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 relative text-xs">
            <button
              onClick={() => setIsShiftModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Lock className="w-5 h-5 text-purple-400" />
              <div>
                <h3 className="text-base font-bold text-white">Close and balance shift</h3>
                <p className="text-xs text-slate-400 font-mono">Shift ID: {activeShift.id}</p>
              </div>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-4">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>Opening Cash Float:</span>
                  <span className="font-bold text-white">R{activeShift.openingFloat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Cash Sales Recorded:</span>
                  <span className="font-bold text-emerald-400">R{totalCashSales.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-300 pt-2 border-t border-slate-800 font-bold">
                  <span>Expected Drawer Cash:</span>
                  <span className="text-amber-400">R{expectedCashInDrawer.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold block">Actual Counted Cash in Drawer (R):</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 500.00"
                  value={actualCashInput}
                  onChange={(e) => setActualCashInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-base focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Manager Authorization PIN:</label>
                <input
                  type="password"
                  maxLength={4}
                  placeholder="Manager PIN"
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Reconciliation Notes:</label>
                <input
                  type="text"
                  placeholder="e.g. Till reconciled cleanly end of day."
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsShiftModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-1.5"
                >
                  <Lock className="w-4 h-4" /> Close Shift & Lock Drawer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      <ReceiptModal 
        order={selectedReceiptOrder} 
        onClose={() => setSelectedReceiptOrder(null)} 
        vatConfig={vatConfig}
        onVoidOrder={onVoidOrder}
      />

    </div>
  );
};
