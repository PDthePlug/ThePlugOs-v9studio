import React, { useState } from 'react';
import { UserSession, OrderRecord, ProductItem, StaffMember, SupplierRecord, RestockRequest, CustomerRecord } from '../types';
import { StaffManagement } from '../components/StaffManagement';
import { MenuManagement } from '../components/MenuManagement';
import { InventoryManagement } from '../components/InventoryManagement';
import { SupplierManagement } from '../components/SupplierManagement';
import { PurchaseOrderEngine } from '../components/PurchaseOrderEngine';
import { CustomerDirectory } from '../components/CustomerDirectory';
import { 
  BarChart3, 
  Package, 
  Users, 
  ShieldCheck, 
  Clock, 
  Plus, 
  DollarSign, 
  AlertTriangle, 
  TrendingUp, 
  Layers, 
  FileText,
  RefreshCw,
  CheckCircle2,
  Sliders,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  FileSpreadsheet,
  UserCheck
} from 'lucide-react';

import { VatSettingsControl } from '../components/VatSettingsControl';
import { ShiftsAndSalesLedger } from '../components/ShiftsAndSalesLedger';

interface ManagerWorkspaceProps {
  session: UserSession;
  kernel: any;
  orders: OrderRecord[];
  products?: ProductItem[];
  onUpdateProducts?: (updated: ProductItem[]) => void;
  staffList?: StaffMember[];
  onUpdateStaff?: (updated: StaffMember[]) => void;
  vatConfig?: { enabled: boolean; rate: number };
  onUpdateVatConfig?: (newConfig: { enabled: boolean; rate: number }) => void;
  suppliers?: SupplierRecord[];
  onUpdateSuppliers?: (suppliers: SupplierRecord[]) => void;
  restockRequests?: RestockRequest[];
  onUpdateRestockRequests?: (requests: RestockRequest[]) => void;
  customers?: CustomerRecord[];
  onUpdateCustomers?: (customers: CustomerRecord[]) => void;
  onVoidOrder?: (orderId: string, voidedBy: string) => void;
}

export const ManagerWorkspace: React.FC<ManagerWorkspaceProps> = ({
  session,
  kernel,
  orders,
  products = [],
  onUpdateProducts,
  staffList = [],
  onUpdateStaff,
  vatConfig = { enabled: false, rate: 15 },
  onUpdateVatConfig,
  suppliers = [],
  onUpdateSuppliers,
  restockRequests = [],
  onUpdateRestockRequests,
  customers = [],
  onUpdateCustomers,
  onVoidOrder
}) => {
  const [selectedTab, setSelectedTab] = useState<'OPERATIONS' | 'SHIFTS_SALES' | 'MENU' | 'INVENTORY' | 'SUPPLIERS' | 'PURCHASE_ORDERS' | 'CUSTOMERS' | 'STAFF' | 'RULES_LOGS'>('OPERATIONS');
  
  // Stock Restock Form State
  const [restockItem, setRestockItem] = useState<string>(products[0]?.id || '');
  const [restockQty, setRestockQty] = useState<number>(50);
  const [notification, setNotification] = useState<string>('');

  // Daily Stats Calculations
  const todayRevenue = orders.reduce((acc, order) => acc + order.totalAmount, 0);
  const totalOrdersCount = orders.length;
  const completedOrdersCount = orders.filter(o => o.status === 'COMPLETED').length;
  const lowStockItems = products.filter(p => p.stock <= 10);

  const handleRestockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetProduct = products.find(p => p.id === restockItem);
    if (!targetProduct) return;

    // Phase 4: Generate Purchase Order -> WhatsApp -> Send
    const poId = `PO-${Math.floor(100000 + Math.random() * 900000)}`;
    const defaultSupplier = suppliers && suppliers.length > 0 ? suppliers[0] : { id: 'sup-1', name: 'Default Supplier', phone: '27830000000' };

    const newRequest: RestockRequest = {
      id: poId,
      branchId: session.branchId,
      branchName: session.branchName,
      managerId: session.userId,
      managerName: session.userName,
      supplierId: defaultSupplier.id || 'sup-1',
      supplierName: defaultSupplier.name,
      supplierPhone: defaultSupplier.phone,
      items: [{
        productId: targetProduct.id,
        name: targetProduct.name,
        quantity: restockQty,
        unit: targetProduct.unit,
        costPrice: targetProduct.costPrice || 0
      }],
      status: 'PENDING_APPROVAL',
      reason: 'Urgent Manager Triggered Restock',
      date: new Date().toISOString()
    };

    if (onUpdateRestockRequests && restockRequests) {
      onUpdateRestockRequests([newRequest, ...restockRequests]);
    }

    const message = `RESTOCK PURCHASE REQUEST\nPO #: ${poId}\nBranch: ${session.branchName}\nManager: ${session.userName}\n\nItems:\n- ${restockQty}x ${targetProduct.name}\n\nReason: Urgent Manager Triggered Restock`;
    const cleanPhone = (defaultSupplier.phone || '27830000000').replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');

    setNotification(`Purchase Order ${poId} generated and WhatsApp opened for supplier.`);
    setTimeout(() => setNotification(''), 4000);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* Compact Header & Mobile Navigation Tabs */}
      <div className="plug-workspace-bar bg-slate-900 border border-slate-800 p-3 sm:p-4 rounded-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">Branch pulse</h1>
                <span className="bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                  MANAGER
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {session.branchName} • Device: {session.deviceId}
              </p>
            </div>
          </div>
        </div>

        {/* Manager Navigation Tabs (Horizontal swipe on mobile) */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedTab('OPERATIONS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'OPERATIONS' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setSelectedTab('SHIFTS_SALES')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'SHIFTS_SALES' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Shifts &amp; sales
          </button>
          <button
            onClick={() => setSelectedTab('MENU')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'MENU' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Products
          </button>
          <button
            onClick={() => setSelectedTab('INVENTORY')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'INVENTORY' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Stock
          </button>
          <button
            onClick={() => setSelectedTab('SUPPLIERS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'SUPPLIERS' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            🚚 Suppliers
          </button>
          <button
            onClick={() => setSelectedTab('PURCHASE_ORDERS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'PURCHASE_ORDERS' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            📋 Purchase Orders
          </button>
          <button
            onClick={() => setSelectedTab('CUSTOMERS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'CUSTOMERS' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Customers
          </button>
          <button
            onClick={() => setSelectedTab('STAFF')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'STAFF' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Team
          </button>
          <button
            onClick={() => setSelectedTab('RULES_LOGS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'RULES_LOGS' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Automatic checks
          </button>
        </div>
      </div>

      {notification && (
        <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Phase 7: Business VAT Settings Control */}
      {selectedTab === 'OPERATIONS' && onUpdateVatConfig && (
        <VatSettingsControl
          vatConfig={vatConfig}
          onUpdateVatConfig={onUpdateVatConfig}
          userRole={session.role}
        />
      )}

      {/* High-Level Operational Metrics (Dense 2x2 Grid on Mobile) */}
      {selectedTab === 'OPERATIONS' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Shift Revenue</span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xl sm:text-3xl font-black text-white font-mono tracking-tight">R{todayRevenue.toFixed(2)}</p>
            <p className="text-[10px] sm:text-xs text-emerald-400 flex items-center gap-1 font-mono pt-0.5">
              <TrendingUp className="w-3.5 h-3.5" /> Live shift sales total
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Shift Orders</span>
              <ShoppingBag className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-xl sm:text-3xl font-black text-white font-mono tracking-tight">{totalOrdersCount} Orders</p>
            <p className="text-[10px] sm:text-xs text-slate-400 font-mono pt-0.5">{completedOrdersCount} completed tickets</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Stock Alerts</span>
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <p className="text-xl sm:text-3xl font-black text-white font-mono tracking-tight">{lowStockItems.length} Low Stock</p>
            <p className="text-[10px] sm:text-xs text-rose-400 font-mono pt-0.5">Require replenishment</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Active Shifts</span>
              <Users className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-xl sm:text-3xl font-black text-white font-mono tracking-tight">{staffList.filter(s => s.activeShift).length} Active</p>
            <p className="text-[10px] sm:text-xs text-emerald-400 font-mono pt-0.5">Supervised shift team</p>
          </div>
        </div>
      )}

      {/* Tab Content View 1: Operations */}
      {selectedTab === 'OPERATIONS' && (
        <div className="space-y-6">

          {/* Phase 10: Commercial Intelligence & Domain Performance Breakdown */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 font-mono text-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <h2 className="text-sm font-bold text-white font-sans">Sales mix and margin</h2>
              </div>
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] px-2.5 py-1 rounded-full font-bold">
                LIVE BUSINESS NUMBERS
              </span>
            </div>

            {/* Metric Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              
              {/* Fast Food Revenue */}
              {(() => {
                const fastFoodSales = orders
                  .filter(o => o.status !== 'CANCELLED')
                  .flatMap(o => o.items.filter(i => i.domain === 'fastfood-domain' || !i.domain))
                  .reduce((sum, item) => sum + (item.price * item.quantity), 0);
                
                const storeItemSales = orders
                  .filter(o => o.status !== 'CANCELLED')
                  .flatMap(o => o.items.filter(i => i.domain === 'store-items'))
                  .reduce((sum, item) => sum + (item.price * item.quantity), 0);

                const totalRev = fastFoodSales + storeItemSales || 1;
                const ffPct = Math.round((fastFoodSales / totalRev) * 100);
                const storePct = Math.round((storeItemSales / totalRev) * 100);

                // Estimated COGS (approx 55% average or from costPrice)
                const totalCost = orders
                  .filter(o => o.status !== 'CANCELLED')
                  .flatMap(o => o.items)
                  .reduce((sum, i) => {
                    const prod = products.find(p => p.id === i.productId || p.name === i.name);
                    const unitCost = prod?.costPrice || (i.price * 0.55);
                    return sum + (unitCost * i.quantity);
                  }, 0);

                const grossProfit = todayRevenue - totalCost;
                const marginPct = todayRevenue > 0 ? ((grossProfit / todayRevenue) * 100).toFixed(1) : '0.0';

                return (
                  <>
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 text-[11px] block font-sans font-semibold">🍔 Fast Food Sales</span>
                      <p className="text-lg font-bold text-white">R{fastFoodSales.toFixed(2)}</p>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
                        <div className="bg-amber-500 h-full" style={{ width: `${ffPct}%` }}></div>
                      </div>
                      <span className="text-[10px] text-slate-500">{ffPct}% of total volume</span>
                    </div>

                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 text-[11px] block font-sans font-semibold">🛒 Store Items Sales</span>
                      <p className="text-lg font-bold text-white">R{storeItemSales.toFixed(2)}</p>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
                        <div className="bg-blue-500 h-full" style={{ width: `${storePct}%` }}></div>
                      </div>
                      <span className="text-[10px] text-slate-500">{storePct}% of total volume</span>
                    </div>

                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 text-[11px] block font-sans font-semibold">💰 Gross Profit Margin</span>
                      <p className="text-lg font-bold text-emerald-400">R{grossProfit.toFixed(2)}</p>
                      <span className="text-[10px] text-emerald-400 font-bold">Margin: {marginPct}%</span>
                    </div>

                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 text-[11px] block font-sans font-semibold">Repeat customers</span>
                      <p className="text-lg font-bold text-purple-400">
                        {customers.filter(c => c.visits > 1).length} / {customers.length}
                      </p>
                      <span className="text-[10px] text-purple-300">
                        Avg Basket: R{customers.length > 0 ? (customers.reduce((sum, c) => sum + c.avgBasket, 0) / customers.length).toFixed(2) : '0.00'}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Top Selling Products Breakdown */}
            <div className="pt-2 border-t border-slate-800">
              <h3 className="text-xs font-bold text-slate-300 mb-2 font-sans">Top five products by sales</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                {(() => {
                  const productSalesMap: { [name: string]: { qty: number; revenue: number; domain: string } } = {};
                  orders.filter(o => o.status !== 'CANCELLED').forEach(o => {
                    o.items.forEach(i => {
                      if (!productSalesMap[i.name]) {
                        productSalesMap[i.name] = { qty: 0, revenue: 0, domain: i.domain || 'fastfood-domain' };
                      }
                      productSalesMap[i.name].qty += i.quantity;
                      productSalesMap[i.name].revenue += i.price * i.quantity;
                    });
                  });

                  const top5 = Object.entries(productSalesMap)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .slice(0, 5);

                  if (top5.length === 0) {
                    return <p className="text-slate-500 italic text-[11px] col-span-5">No sales recorded yet to rank products.</p>;
                  }

                  return top5.map(([name, data], rank) => (
                    <div key={name} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-bold text-amber-400">#{rank + 1} Best Seller</span>
                        <p className="font-bold text-white text-[11px] truncate mt-0.5">{name}</p>
                        <span className="text-[10px] text-slate-500 block">{data.domain === 'store-items' ? '🛒 Store Item' : '🍔 Fast Food'}</span>
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-slate-800 flex justify-between items-center text-[10px]">
                        <span className="text-slate-400">{data.qty} sold</span>
                        <span className="font-bold text-emerald-400">R{data.revenue.toFixed(2)}</span>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Recent Branch Orders Stream */}
            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" /> Recent branch orders
              </h2>

              {orders.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">No orders recorded in current session yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {orders.map(order => (
                    <div key={order.id} className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl flex items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-white">{order.id}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {order.paymentType}
                          </span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                            order.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {order.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-bold font-mono text-amber-400">R{order.totalAmount.toFixed(2)}</p>
                        <p className="text-[10px] text-slate-500">{new Date(order.createdAt).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Restock Panel */}
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-400" /> Add stock quickly
              </h2>
              
              <form onSubmit={handleRestockSubmit} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Select Product</label>
                  <select
                    value={restockItem}
                    onChange={(e) => setRestockItem(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl p-2.5"
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Current: {p.stock} {p.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Quantity to Add</label>
                  <input
                    type="number"
                    min={1}
                    value={restockQty}
                    onChange={(e) => setRestockQty(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs rounded-xl p-2.5"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Add to stock
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content View: Shifts & Sales Ledger */}
      {selectedTab === 'SHIFTS_SALES' && (
        <ShiftsAndSalesLedger
          session={session}
          orders={orders}
          staffList={staffList}
          vatConfig={vatConfig}
          onVoidOrder={onVoidOrder}
          kernel={kernel}
        />
      )}

      {/* Tab Content View 2: Menu Editor */}
      {selectedTab === 'MENU' && (
        <MenuManagement
          products={products}
          onUpdateProducts={(updated) => onUpdateProducts ? onUpdateProducts(updated) : null}
          kernel={kernel}
        />
      )}

      {/* Tab Content View 3: Inventory Grid */}
      {selectedTab === 'INVENTORY' && (
        <InventoryManagement
          products={products}
          onUpdateProducts={(updated) => onUpdateProducts ? onUpdateProducts(updated) : null}
          suppliers={suppliers}
          onAddRestockRequest={(req) => {
            if (onUpdateRestockRequests) {
              onUpdateRestockRequests([req, ...restockRequests]);
            }
          }}
          kernel={kernel}
          branchId={session.branchId}
          userId={session.userId}
        />
      )}

      {/* Tab Content View: Suppliers */}
      {selectedTab === 'SUPPLIERS' && (
        <SupplierManagement
          suppliers={suppliers}
          onUpdateSuppliers={(updated) => onUpdateSuppliers ? onUpdateSuppliers(updated) : null}
          kernel={kernel}
        />
      )}

      {/* Tab Content View: Purchase Orders */}
      {selectedTab === 'PURCHASE_ORDERS' && (
        <PurchaseOrderEngine
          requests={restockRequests}
          suppliers={suppliers}
          products={products}
          onUpdateRequests={(updated) => onUpdateRestockRequests ? onUpdateRestockRequests(updated) : null}
          onUpdateProducts={(updated) => onUpdateProducts ? onUpdateProducts(updated) : null}
          kernel={kernel}
          userRole={session.role}
          userName={session.userName}
        />
      )}

      {/* Tab Content View: Customer Directory CRM */}
      {selectedTab === 'CUSTOMERS' && (
        <CustomerDirectory
          customers={customers}
          onUpdateCustomers={(updated) => onUpdateCustomers ? onUpdateCustomers(updated) : null}
          kernel={kernel}
        />
      )}

      {/* Tab Content View 4: Staff Management */}
      {selectedTab === 'STAFF' && (
        <StaffManagement businessId={session.businessId}
          staffList={staffList}
          onUpdateStaff={(updated) => onUpdateStaff ? onUpdateStaff(updated) : null}
          kernel={kernel}
        />
      )}

      {/* Tab Content View 5: Rules Engine & Audit Logs */}
      {selectedTab === 'RULES_LOGS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" /> Automatic business checks
          </h2>

          <div className="space-y-2 font-mono text-xs">
            <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex items-center justify-center text-slate-500">
              No checks need attention right now.
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
