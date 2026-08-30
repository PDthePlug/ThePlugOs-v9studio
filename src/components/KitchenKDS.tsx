import React from 'react';
import { 
  DomainType, 
  OrderRecord, 
  UserRole 
} from '../types';
import { 
  Clock, 
  CheckCircle2, 
  Play, 
  Package, 
  Utensils, 
  Pill, 
  AlertTriangle, 
  Check, 
  User, 
  FileText 
} from 'lucide-react';

interface KitchenKDSProps {
  domain: DomainType;
  orders: OrderRecord[];
  currentRole: UserRole;
  onUpdateOrderStatus: (orderId: string, nextStatus: 'PREP' | 'READY' | 'COMPLETED') => void;
}

export const KitchenKDS: React.FC<KitchenKDSProps> = ({
  domain,
  orders,
  currentRole,
  onUpdateOrderStatus
}) => {
  const domainOrders = orders.filter(o => o.domain === domain);

  const pendingOrders = domainOrders.filter(o => o.status === 'PENDING');
  const prepOrders = domainOrders.filter(o => o.status === 'PREP');
  const readyOrders = domainOrders.filter(o => o.status === 'READY');
  const completedOrders = domainOrders.filter(o => o.status === 'COMPLETED').slice(-5);

  const getElapsedTimeInMinutes = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    return Math.floor(diff / 60000);
  };

  const getSlaBadge = (mins: number) => {
    if (mins < 5) {
      return (
        <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
          <Clock className="w-3 h-3" /> {mins}m (SLA OK)
        </span>
      );
    } else if (mins < 10) {
      return (
        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
          <Clock className="w-3 h-3" /> {mins}m (WARNING)
        </span>
      );
    } else {
      return (
        <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
          <AlertTriangle className="w-3 h-3" /> {mins}m (URGENT)
        </span>
      );
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] space-y-4">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-xl ${
            domain === 'fastfood-domain' ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-slate-950'
          }`}>
            {domain === 'fastfood-domain' ? <Utensils className="w-6 h-6" /> : <Pill className="w-6 h-6" />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              {domain === 'fastfood-domain' ? 'Kitchen queue' : 'Pharmacy queue'}
            </h2>
            <p className="text-xs text-slate-400">
              New work moves from waiting to in progress, then ready.
            </p>
          </div>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-3">
          <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-center">
            <span className="text-[10px] text-slate-400 block font-semibold">NEW ORDERS</span>
            <span className="font-mono font-extrabold text-amber-400 text-sm">{pendingOrders.length}</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-center">
            <span className="text-[10px] text-slate-400 block font-semibold">IN PREPARATION</span>
            <span className="font-mono font-extrabold text-blue-400 text-sm">{prepOrders.length}</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-center">
            <span className="text-[10px] text-slate-400 block font-semibold">READY PICKUP</span>
            <span className="font-mono font-extrabold text-emerald-400 text-sm">{readyOrders.length}</span>
          </div>
        </div>
      </div>

      {/* Kanban Board Columns */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-hidden">
        
        {/* Column 1: PENDING / NEW */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="font-bold text-amber-400 text-sm flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              NEW ORDERS ({pendingOrders.length})
            </h3>
            <span className="text-[10px] font-mono text-slate-500 uppercase">Step: PENDING</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {pendingOrders.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 font-medium italic">
                No new orders in queue
              </div>
            ) : (
              pendingOrders.map(order => {
                const elapsed = getElapsedTimeInMinutes(order.createdAt);
                return (
                  <div key={order.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-md">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono font-bold text-amber-400 text-xs block">{order.id}</span>
                        <span className="text-xs text-slate-300 font-semibold">{order.customerName}</span>
                      </div>
                      {getSlaBadge(elapsed)}
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-slate-200">
                          <span>{item.quantity}× {item.name}</span>
                          <span className="font-mono text-slate-400">R {(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => onUpdateOrderStatus(order.id, 'PREP')}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm"
                    >
                      <Play className="w-3.5 h-3.5 fill-slate-950" />
                      Start Preparation (`PAYMENT_RECEIVED`)
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Column 2: IN PREPARATION */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="font-bold text-blue-400 text-sm flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
              IN PREPARATION ({prepOrders.length})
            </h3>
            <span className="text-[10px] font-mono text-slate-500 uppercase">Step: PREP</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {prepOrders.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 font-medium italic">
                Kitchen is currently clear
              </div>
            ) : (
              prepOrders.map(order => {
                const elapsed = getElapsedTimeInMinutes(order.createdAt);
                return (
                  <div key={order.id} className="bg-slate-950 border border-blue-500/40 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-md bg-blue-500/5">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono font-bold text-blue-400 text-xs block">{order.id}</span>
                        <span className="text-xs text-slate-300 font-semibold">{order.customerName}</span>
                      </div>
                      {getSlaBadge(elapsed)}
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-slate-200">
                          <span>{item.quantity}× {item.name}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => onUpdateOrderStatus(order.id, 'READY')}
                      className="w-full bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Mark Order Prepared (`ORDER_PREPARED`)
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Column 3: READY FOR PICKUP */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <h3 className="font-bold text-emerald-400 text-sm flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              READY FOR PICKUP ({readyOrders.length})
            </h3>
            <span className="text-[10px] font-mono text-slate-500 uppercase">Step: READY</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {readyOrders.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 font-medium italic">
                No orders waiting pickup
              </div>
            ) : (
              readyOrders.map(order => (
                <div key={order.id} className="bg-slate-950 border border-emerald-500/40 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-md bg-emerald-500/5">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono font-bold text-emerald-400 text-xs block">{order.id}</span>
                      <span className="text-xs text-slate-300 font-semibold">{order.customerName}</span>
                    </div>
                    <span className="bg-emerald-500/20 text-emerald-300 font-bold text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30">
                      PASSED SLA
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300">
                    <span className="block font-semibold mb-1">Items to Handover:</span>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                      {order.items.map((item, idx) => (
                        <li key={idx}>{item.quantity}× {item.name}</li>
                      ))}
                    </ul>
                  </div>

                  <button
                    onClick={() => onUpdateOrderStatus(order.id, 'COMPLETED')}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Complete Customer Handover
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
