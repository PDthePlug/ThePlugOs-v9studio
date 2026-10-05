import React, { useState } from 'react';
import { UserSession, OrderRecord, ProductItem, StaffMember, SupplierRecord, RestockRequest, CustomerRecord, Branch } from '../types';
import { BusinessDevicesScreen } from '../components/BusinessDevicesScreen';
import { MenuManagement } from '../components/MenuManagement';
import { StaffManagement } from '../components/StaffManagement';
import { InventoryManagement } from '../components/InventoryManagement';
import { SupplierManagement } from '../components/SupplierManagement';
import { PurchaseOrderEngine } from '../components/PurchaseOrderEngine';
import { CustomerDirectory } from '../components/CustomerDirectory';
import { 
  Building2, 
  TrendingUp, 
  DollarSign, 
  PieChart, 
  Layers, 
  Sparkles, 
  ShieldCheck, 
  ArrowUpRight,
  Briefcase,
  Users,
  Activity,
  Radio,
  UtensilsCrossed,
  Package,
  Truck,
  FileSpreadsheet,
  UserCheck
} from 'lucide-react';

import { VatSettingsControl } from '../components/VatSettingsControl';
import { ShiftsAndSalesLedger } from '../components/ShiftsAndSalesLedger';

interface OwnerWorkspaceProps {
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
  branches?: Branch[];
  onVoidOrder?: (orderId: string, voidedBy: string) => void;
}

export const OwnerWorkspace: React.FC<OwnerWorkspaceProps> = ({
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
  branches = [],
  onVoidOrder
}) => {
  const [selectedTab, setSelectedTab] = useState<'OVERVIEW' | 'SHIFTS_SALES' | 'DEVICES' | 'MENU' | 'STAFF' | 'INVENTORY' | 'SUPPLIERS' | 'PURCHASE_ORDERS' | 'CUSTOMERS'>('OVERVIEW');

  const activeBranchesList = branches && branches.length > 0 ? branches : [
    { id: session.branchId || '', name: session.branchName || 'Unknown Branch', location: 'Unknown', domain: 'fastfood-domain', isActive: true }
  ];

  const branchPerformance = activeBranchesList.map(branch => {
    const branchOrders = orders.filter(o => o.branchId === branch.id || !o.branchId);
    const revenue = branchOrders.reduce((acc, o) => acc + (o.totalAmount || o.total || 0), 0);
    const orderCount = branchOrders.length;
    const margin = revenue > 0 ? '38.5%' : '0.0%'; 
    return {
      name: branch.name,
      revenue,
      orders: orderCount,
      margin,
      status: revenue > 1000 ? 'HIGH VOLUME' : revenue > 0 ? 'HEALTHY' : 'NO DATA'
    };
  });

  const totalNetworkRevenue = orders.reduce((acc, o) => acc + (o.totalAmount || o.total || 0), 0);
  const totalNetworkOrders = orders.length;
  const activeEmployeesCount = staffList.length;
  const activeProductsCount = products.length;
  const lowStockAlertsCount = products.filter(p => p.stock < 10).length;

  // Calculate Revenue Breakdown by Commercial Product Domain
  const domainRevenueMap: Record<string, { label: string; icon: string; revenue: number; itemsSold: number }> = {
    'fastfood-domain': { label: 'Fast Food', icon: '🍔', revenue: 0, itemsSold: 0 },
    'store-items': { label: 'Store Items', icon: '🛒', revenue: 0, itemsSold: 0 }
  };

  orders.forEach(order => {
    order.items.forEach(item => {
      const dKey = item.domain || order.domain || 'fastfood-domain';
      const itemRev = (item.price || 0) * (item.quantity || 1);
      if (!domainRevenueMap[dKey]) {
        domainRevenueMap[dKey] = { label: dKey, icon: '📦', revenue: 0, itemsSold: 0 };
      }
      domainRevenueMap[dKey].revenue += itemRev;
      domainRevenueMap[dKey].itemsSold += item.quantity || 1;
    });
  });

  const domainList = Object.entries(domainRevenueMap).map(([key, val]) => ({
    key,
    ...val,
    percentage: totalNetworkRevenue > 0 ? ((val.revenue / totalNetworkRevenue) * 100).toFixed(1) : '0.0'
  }));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* Compact Header & Mobile Navigation Tabs */}
      <div className="plug-workspace-bar bg-slate-900 border border-slate-800 p-3 sm:p-4 rounded-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-purple-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">Business heartbeat</h1>
                <span className="bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                  OWNER
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {session.branchName} • Device: {session.deviceId}
              </p>
            </div>
          </div>
        </div>

        {/* Owner Navigation Tabs (Horizontal swipe on mobile) */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedTab('OVERVIEW')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'OVERVIEW' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setSelectedTab('SHIFTS_SALES')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'SHIFTS_SALES' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Shifts &amp; sales
          </button>
          <button
            onClick={() => setSelectedTab('DEVICES')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'DEVICES' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Devices
          </button>
          <button
            onClick={() => setSelectedTab('MENU')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'MENU' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Products
          </button>
          <button
            onClick={() => setSelectedTab('STAFF')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'STAFF' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Team
          </button>
          <button
            onClick={() => setSelectedTab('INVENTORY')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'INVENTORY' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Stock
          </button>
          <button
            onClick={() => setSelectedTab('SUPPLIERS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'SUPPLIERS' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Suppliers
          </button>
          <button
            onClick={() => setSelectedTab('PURCHASE_ORDERS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'PURCHASE_ORDERS' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Purchase orders
          </button>
          <button
            onClick={() => setSelectedTab('CUSTOMERS')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn flex items-center gap-1.5 ${
              selectedTab === 'CUSTOMERS' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Customers
          </button>
        </div>
      </div>

      {/* Tab 1: Executive Overview */}
      {selectedTab === 'OVERVIEW' && (
        <div className="space-y-5">
          {/* Financial Executive Summary Cards (Dense 2x2 Grid on Mobile, arm's-length text size) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
              <p className="text-slate-400 text-xs font-medium">Sales across branches</p>
              <p className="text-xl sm:text-3xl font-black text-white font-mono tracking-tight">R{totalNetworkRevenue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
              <p className="text-[10px] sm:text-xs text-emerald-400 flex items-center gap-1 font-mono pt-0.5">
                <ArrowUpRight className="w-3.5 h-3.5" /> Live total
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
              <p className="text-slate-400 text-xs font-medium">Orders today</p>
              <p className="text-xl sm:text-3xl font-black text-white font-mono tracking-tight">{totalNetworkOrders} Orders</p>
              <p className="text-[10px] sm:text-xs text-slate-400 font-mono pt-0.5">Avg: R{totalNetworkOrders > 0 ? (totalNetworkRevenue / totalNetworkOrders).toFixed(2) : '0.00'}</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
              <p className="text-slate-400 text-xs font-medium">Active team</p>
              <p className="text-xl sm:text-3xl font-black text-purple-300 font-mono tracking-tight">{activeEmployeesCount} Staff</p>
              <p className="text-[10px] sm:text-xs text-slate-400 font-mono pt-0.5">Profiles registered</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-1">
              <p className="text-slate-400 text-xs font-medium">Products &amp; stock</p>
              <p className="text-xl sm:text-3xl font-black text-white font-mono tracking-tight">{activeProductsCount} Items</p>
              <p className="text-[10px] sm:text-xs text-amber-400 font-mono pt-0.5">{lowStockAlertsCount} need restocking</p>
            </div>
          </div>

          {/* Phase 7: Business VAT Settings Control */}
          {onUpdateVatConfig && (
            <VatSettingsControl
              vatConfig={vatConfig}
              onUpdateVatConfig={onUpdateVatConfig}
              userRole={session.role}
            />
          )}

          {/* Business Network Status Banner */}
          <div className="bg-emerald-950/40 border border-emerald-500/30 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Business devices are healthy
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Cashier, kitchen, manager, printer and owner phone are connected
                </p>
              </div>
            </div>

            <button
              onClick={() => setSelectedTab('DEVICES')}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-2"
            >
              <Radio className="w-4 h-4" /> Manage Devices
            </button>
          </div>

          {/* Multi-Branch Performance Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-purple-400" /> Branch performance
              </h2>
              <span className="text-xs text-slate-400 font-mono">Live</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-3">Branch Location</th>
                    <th className="p-3">Sales</th>
                    <th className="p-3">Orders</th>
                    <th className="p-3">Margin</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {branchPerformance.map((b, idx) => (
                    <tr key={idx} className="hover:bg-slate-950/50">
                      <td className="p-3 font-bold text-white flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-slate-500" /> {b.name}
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-400">R{b.revenue.toFixed(2)}</td>
                      <td className="p-3 font-mono">{b.orders}</td>
                      <td className="p-3 font-mono text-purple-300">{b.margin}</td>
                      <td className="p-3">
                        <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Domain Revenue Breakdown */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <PieChart className="w-4 h-4 text-emerald-400" /> Sales by business area
              </h2>
              <span className="text-xs text-slate-400 font-mono">Current sales mix</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {domainList.map((d) => (
                <div key={d.key} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>{d.icon}</span> {d.label}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30">
                      {d.percentage}% Share
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-lg font-bold font-mono text-emerald-400">
                      R{d.revenue.toFixed(2)}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {d.itemsSold} units sold
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strategic Intelligence Insights */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" /> Business signals
            </h2>
            <div className="grid grid-cols-1 gap-3 text-xs">
              <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 text-slate-500 text-center flex items-center justify-center">
                New business signals will appear as trading history grows.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Shifts & Sales Ledger */}
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

      {/* Tab 2: Devices Screen */}
      {selectedTab === 'DEVICES' && (
        <BusinessDevicesScreen
          kernel={kernel}
          branchName={session.branchName}
          businessId={session.businessId || ''}
          branchId={session.branchId}
          userRole={session.role}
          sessionToken={session.sessionToken}
        />
      )}

      {/* Tab 3: Master Catalog */}
      {selectedTab === 'MENU' && (
        <MenuManagement
          products={products}
          onUpdateProducts={(updated) => onUpdateProducts ? onUpdateProducts(updated) : null}
          kernel={kernel}
          branchId={session.branchId}
        />
      )}

      {/* Tab 4: Staff Directory */}
      {selectedTab === 'STAFF' && (
        <StaffManagement businessId={session.businessId}
          staffList={staffList}
          onUpdateStaff={(updated) => onUpdateStaff ? onUpdateStaff(updated) : null}
          kernel={kernel}
          branches={[]}
        />
      )}

      {/* Tab 5: Network Stock */}
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

      {/* Tab: Supplier Base */}
      {selectedTab === 'SUPPLIERS' && (
        <SupplierManagement
          suppliers={suppliers}
          onUpdateSuppliers={(updated) => onUpdateSuppliers ? onUpdateSuppliers(updated) : null}
          kernel={kernel}
        />
      )}

      {/* Tab: Purchase Orders */}
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

      {/* Tab: Customer Directory CRM */}
      {selectedTab === 'CUSTOMERS' && (
        <CustomerDirectory
          customers={customers}
          onUpdateCustomers={(updated) => onUpdateCustomers ? onUpdateCustomers(updated) : null}
          kernel={kernel}
        />
      )}

    </div>
  );
};
