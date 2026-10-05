import React, { useState } from 'react';
import { UserSession, OrderRecord } from '../types';
import { 
  Flame, 
  Clock, 
  CheckCircle2, 
  Play, 
  Check
} from 'lucide-react';

interface KitchenWorkspaceProps {
  session: UserSession;
  kernel: any;
  orders: OrderRecord[];
  onUpdateOrderStatus: (orderId: string, status: OrderRecord['status']) => void;
}

export const KitchenWorkspace: React.FC<KitchenWorkspaceProps> = ({
  session,
  kernel,
  orders,
  onUpdateOrderStatus
}) => {
  const [filterDomain, setFilterDomain] = useState<string>('ALL');

  // Active Kitchen Pipeline Orders
  const kitchenOrders = orders.filter(o => 
    (o.status === 'PENDING' || o.status === 'SUBMITTED' || o.status === 'PREP' || o.status === 'IN_PREP' || o.status === 'READY') &&
    (filterDomain === 'ALL' || o.items.some(i => i.domain === filterDomain))
  );

  const pendingOrders = kitchenOrders.filter(o => o.status === 'PENDING' || o.status === 'SUBMITTED');
  const prepOrders = kitchenOrders.filter(o => o.status === 'PREP' || o.status === 'IN_PREP');
  const readyOrders = kitchenOrders.filter(o => o.status === 'READY');

  const getElapsedMinutes = (dateStr: string) => {
    const elapsedMs = Date.now() - new Date(dateStr).getTime();
    return Math.floor(elapsedMs / 60000);
  };

  const getSLAStyle = (elapsedMins: number) => {
    if (elapsedMins < 5) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    if (elapsedMins < 10) return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/30 animate-pulse';
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* Compact Header & Domain Filter Tabs */}
      <div className="plug-workspace-bar bg-slate-900 border border-slate-800 p-3 sm:p-4 rounded-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">Kitchen queue</h1>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                  KITCHEN QUEUE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {session.branchName} • Device: {session.deviceId}
              </p>
            </div>
          </div>
        </div>

        {/* Ticket Domain Filter Tabs (Horizontal swipe on mobile) */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setFilterDomain('ALL')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              filterDomain === 'ALL' ? 'bg-amber-500 text-slate-950 font-black shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            All orders
          </button>
          <button
            onClick={() => setFilterDomain('fastfood-domain')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              filterDomain === 'fastfood-domain' ? 'bg-amber-500 text-slate-950 font-black shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Food orders
          </button>
        </div>
      </div>

      {/* Kanban Board Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Column 1: PENDING ORDERS */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping"></span>
              <h2 className="text-sm font-bold text-white">1. Waiting to start</h2>
            </div>
            <span className="bg-rose-500/20 text-rose-300 font-mono text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingOrders.length}
            </span>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="py-12 text-center text-slate-600 text-xs">
              No new incoming tickets.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingOrders.map(order => {
                const elapsedMins = getElapsedMinutes(order.createdAt);
                return (
                  <div key={order.id} className="bg-slate-950 border border-rose-500/40 p-4 rounded-xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-sm font-black font-mono text-white">{order.id}</span>
                        <p className="text-[10px] text-slate-400">Cashier: {order.cashierName}</p>
                      </div>
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${getSLAStyle(elapsedMins)}`}>
                        <Clock className="w-3 h-3" /> {elapsedMins}m ago
                      </span>
                    </div>

                    <div className="space-y-1.5 border-t border-b border-slate-800/80 py-2">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-slate-200 font-medium">
                          <span><strong className="text-amber-400">{item.quantity}x</strong> {item.name}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => onUpdateOrderStatus(order.id, 'PREP')}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-500/10"
                    >
                      <Play className="w-4 h-4" /> Start Preparation
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 2: IN PREPARATION */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <h2 className="text-sm font-bold text-white">2. Being prepared</h2>
            </div>
            <span className="bg-amber-500/20 text-amber-300 font-mono text-xs font-bold px-2 py-0.5 rounded-full">
              {prepOrders.length}
            </span>
          </div>

          {prepOrders.length === 0 ? (
            <div className="py-12 text-center text-slate-600 text-xs">
              No orders actively cooking/preparing.
            </div>
          ) : (
            <div className="space-y-3">
              {prepOrders.map(order => {
                const elapsedMins = getElapsedMinutes(order.createdAt);
                return (
                  <div key={order.id} className="bg-slate-950 border border-amber-500/50 p-4 rounded-xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-sm font-black font-mono text-amber-400">{order.id}</span>
                        <p className="text-[10px] text-slate-400">Station: Main Kitchen Grill</p>
                      </div>
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${getSLAStyle(elapsedMins)}`}>
                        <Clock className="w-3 h-3" /> {elapsedMins}m elapsed
                      </span>
                    </div>

                    <div className="space-y-1.5 border-t border-b border-slate-800/80 py-2">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-slate-200 font-medium">
                          <span><strong className="text-amber-400">{item.quantity}x</strong> {item.name}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => onUpdateOrderStatus(order.id, 'READY')}
                      className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-500/10"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Mark Ready for Counter
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 3: READY FOR COLLECTION */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="text-sm font-bold text-white">3. Ready for collection</h2>
            </div>
            <span className="bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold px-2 py-0.5 rounded-full">
              {readyOrders.length}
            </span>
          </div>

          {readyOrders.length === 0 ? (
            <div className="py-12 text-center text-slate-600 text-xs">
              No orders waiting at pickup station.
            </div>
          ) : (
            <div className="space-y-3">
              {readyOrders.map(order => (
                <div key={order.id} className="bg-slate-950 border border-emerald-500/30 p-4 rounded-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-black font-mono text-emerald-400">{order.id}</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold">
                      NOTIFICATION SENT
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 font-medium">
                    {order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                  </p>

                  <div className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-800">
                    Awaiting cashier handover to customer.
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
