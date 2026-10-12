import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Store,
  Users,
  WalletCards,
} from 'lucide-react';
import type { Branch, StaffMember, UserRole } from '../types';
import {
  capturedOrder,
  loadOwnerProjection,
  summarizeOwnerProjection,
  tradingDay,
  type OwnerProduct,
  type OwnerProjection,
} from '../lib/owner-projection';
import {
  createOwnerCatalogProduct,
  createOwnerStaffProfile,
  setOwnerCatalogProductActive,
  updateOwnerCatalogProduct,
  type OwnerCatalogInput,
} from '../lib/owner-admin';
import { NativeHubEnrollmentControl } from './NativeHubEnrollmentControl';
import { NativeStaffCredentialResetControl } from './NativeStaffCredentialResetControl';

type OwnerSection = 'OVERVIEW' | 'ORDERS' | 'MENU' | 'STOCK' | 'FINANCE' | 'TEAM' | 'DEVICES';

interface OwnerPortalShellProps {
  businessId: string;
  branches: Branch[];
  branchId?: string;
  staffList: StaffMember[];
  onSelectBranch?: (branchId: string) => void;
  onSignOut?: () => void;
}

const navItems: Array<{ id: OwnerSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'ORDERS', label: 'Orders', icon: ClipboardList },
  { id: 'MENU', label: 'Menu', icon: Store },
  { id: 'STOCK', label: 'Stock', icon: Boxes },
  { id: 'FINANCE', label: 'Finance', icon: CircleDollarSign },
  { id: 'TEAM', label: 'Team & access', icon: Users },
  { id: 'DEVICES', label: 'Devices & settings', icon: Settings },
];

const money = (value: number) => `R${Number(value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roleLabel = (role: UserRole) => role === 'KITCHEN_STAFF' ? 'Kitchen' : role.charAt(0) + role.slice(1).toLowerCase();

const emptyProduct: OwnerCatalogInput = {
  name: '',
  category: '',
  price: 0,
  description: '',
  unitOfMeasure: 'Each',
  costPrice: null,
};

function SectionHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#9a6710]">{eyebrow}</span>
        <h2 className="mt-1 text-2xl font-black tracking-[-0.035em] text-[#191914] sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#746d62]">{copy}</p>
      </div>
      {action}
    </header>
  );
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <article className="rounded-2xl border border-[#ded5c5] bg-white p-4 shadow-sm sm:p-5">
      <small className="font-bold text-[#777166]">{label}</small>
      <strong className="mt-2 block text-2xl font-black tracking-tight text-[#191914]">{value}</strong>
      {note && <span className="mt-1 block text-xs text-[#91897d]">{note}</span>}
    </article>
  );
}

export const OwnerPortalShell: React.FC<OwnerPortalShellProps> = ({
  businessId,
  branches,
  branchId,
  staffList,
  onSelectBranch,
  onSignOut,
}) => {
  const activeBranches = useMemo(() => branches.filter(branch => branch.isActive), [branches]);
  const activeBranch = activeBranches.find(branch => branch.id === branchId) || activeBranches[0];
  const selectedBranchId = activeBranch?.id || branchId || '';
  const branchName = activeBranch?.name || 'Branch';
  const [section, setSection] = useState<OwnerSection>('OVERVIEW');
  const [projection, setProjection] = useState<OwnerProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [staffDirectory, setStaffDirectory] = useState<StaffMember[]>(staffList);
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<UserRole>('CASHIER');
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffMessage, setStaffMessage] = useState<string | null>(null);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<OwnerCatalogInput>(emptyProduct);
  const [productSaving, setProductSaving] = useState(false);
  const [productMessage, setProductMessage] = useState<string | null>(null);

  useEffect(() => setStaffDirectory(staffList), [staffList]);

  const refresh = useCallback(async () => {
    if (!businessId || !selectedBranchId) return;
    setLoading(true);
    setWarning(null);
    try {
      setProjection(await loadOwnerProjection(businessId, selectedBranchId));
    } catch {
      setProjection(null);
      setWarning('Business records could not be refreshed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [businessId, selectedBranchId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const overview = projection ? summarizeOwnerProjection(projection) : null;
  const branchStaff = staffDirectory.filter(member => member.branchId === selectedBranchId && (member.status === undefined || member.status === 'ACTIVE'));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOrders = (projection?.orders || []).filter(order => {
    if (!normalizedQuery) return true;
    return [order.id, order.status, order.payment_status, order.cashier_name || ''].some(value => value.toLowerCase().includes(normalizedQuery));
  });
  const visibleProducts = (projection?.products || []).filter(product => {
    if (!normalizedQuery) return true;
    return [product.name, product.category, product.status].some(value => value.toLowerCase().includes(normalizedQuery));
  });

  const openNewProduct = () => {
    setEditingProductId(null);
    setProductDraft(emptyProduct);
    setProductMessage(null);
    setProductEditorOpen(true);
  };

  const openProduct = (product: OwnerProduct) => {
    setEditingProductId(product.id);
    setProductDraft({
      name: product.name,
      category: product.category,
      price: Number(product.price),
      description: product.description || '',
      unitOfMeasure: product.unit_of_measure || 'Each',
      costPrice: product.cost_price == null ? null : Number(product.cost_price),
    });
    setProductMessage(null);
    setProductEditorOpen(true);
  };

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedBranchId) return;
    setProductSaving(true);
    setProductMessage(null);
    try {
      if (editingProductId) {
        await updateOwnerCatalogProduct(businessId, selectedBranchId, editingProductId, productDraft);
        setProductMessage('Menu item updated.');
      } else {
        await createOwnerCatalogProduct(businessId, selectedBranchId, productDraft);
        setProductMessage('Menu item added. Stock starts from the synchronized inventory record; physical counts stay with the shop workflow.');
        setEditingProductId(null);
        setProductDraft(emptyProduct);
      }
      await refresh();
    } catch (error) {
      setProductMessage(error instanceof Error ? error.message : 'The menu item could not be saved.');
    } finally {
      setProductSaving(false);
    }
  };

  const toggleProduct = async (product: OwnerProduct) => {
    setProductMessage(null);
    try {
      await setOwnerCatalogProductActive(businessId, selectedBranchId, product.id, product.status !== 'ACTIVE');
      await refresh();
    } catch (error) {
      setProductMessage(error instanceof Error ? error.message : 'The menu item status could not be changed.');
    }
  };

  const addStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedBranchId) return;
    setStaffSaving(true);
    setStaffMessage(null);
    try {
      const created = await createOwnerStaffProfile(businessId, selectedBranchId, staffName, staffRole);
      setStaffDirectory(current => [...current.filter(member => member.id !== created.id), created]);
      setStaffName('');
      setStaffMessage(`${created.name} was added as ${roleLabel(created.role)}. Set up their PIN on the enrolled Cashier Hub before their first shift.`);
    } catch (error) {
      setStaffMessage(error instanceof Error ? error.message : 'The staff profile could not be created.');
    } finally {
      setStaffSaving(false);
    }
  };

  const captured = (projection?.orders || []).filter(capturedOrder);
  const revenue30 = captured.reduce((sum, order) => sum + Number(order.total_amount), 0);
  const pendingValue = (projection?.orders || []).filter(order => !capturedOrder(order) && order.status !== 'CANCELLED')
    .reduce((sum, order) => sum + Number(order.total_amount), 0);
  const averageOrder = captured.length ? revenue30 / captured.length : 0;
  const lastSevenDays = useMemo(() => {
    const days: Array<{ key: string; revenue: number; orders: number }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 86400000);
      const key = tradingDay(date);
      const orders = captured.filter(order => tradingDay(order.created_at) === key);
      days.push({ key, revenue: orders.reduce((sum, order) => sum + Number(order.total_amount), 0), orders: orders.length });
    }
    return days;
  }, [captured]);

  const renderSection = () => {
    if (section === 'OVERVIEW') return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Owner dashboard" title="Business overview" copy="A quick read of sales, orders, stock pressure, staff and devices for the branch you are managing." />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <Metric label="Sales today" value={overview ? money(overview.salesToday) : '—'} />
          <Metric label="Orders today" value={overview?.ordersToday ?? '—'} />
          <Metric label="Active team" value={branchStaff.length} />
          <Metric label="Active devices" value={overview?.activeDevices ?? '—'} />
          <Metric label="Low stock" value={overview?.lowStockProducts ?? '—'} note={overview ? `${overview.activeProducts} active menu items` : undefined} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[1.75rem] border border-[#ded5c5] bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><div><span className="text-[11px] font-black uppercase tracking-[0.16em] text-[#9a6710]">Recent orders</span><h3 className="mt-1 text-xl font-black">What just happened</h3></div><button type="button" onClick={() => setSection('ORDERS')} className="text-sm font-bold text-[#8c5a08]">View all</button></div>
            <div className="mt-5 space-y-2">
              {(projection?.orders || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6).map(order => (
                <div key={order.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#eee6da] p-3">
                  <div><strong className="block text-sm">#{order.id.slice(-8).toUpperCase()}</strong><small className="text-[#817a6f]">{order.cashier_name || 'Unassigned'} · {new Date(order.created_at).toLocaleString('en-ZA')}</small></div>
                  <div className="text-right"><strong className="block text-sm">{money(order.total_amount)}</strong><small className="text-[#817a6f]">{order.status}</small></div>
                </div>
              ))}
              {!projection?.orders.length && <p className="rounded-xl bg-[#f5efe4] p-4 text-sm text-[#777166]">No synchronized orders are available yet.</p>}
            </div>
          </section>
          <section className="rounded-[1.75rem] border border-[#ded5c5] bg-[#171714] p-5 text-white sm:p-6">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-[#f2aa25]">Needs attention</span>
            <h3 className="mt-1 text-xl font-black">Shop pulse</h3>
            <div className="mt-5 space-y-3">
              <button type="button" onClick={() => setSection('STOCK')} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 text-left"><span><strong className="block text-sm">Low stock</strong><small className="text-stone-400">Review synchronized quantities</small></span><ChevronRight className="h-4 w-4" /></button>
              <button type="button" onClick={() => setSection('TEAM')} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 text-left"><span><strong className="block text-sm">Team access</strong><small className="text-stone-400">Add profiles and recover PIN access</small></span><ChevronRight className="h-4 w-4" /></button>
              <button type="button" onClick={() => setSection('FINANCE')} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 text-left"><span><strong className="block text-sm">Business performance</strong><small className="text-stone-400">See sales and payment position</small></span><ChevronRight className="h-4 w-4" /></button>
            </div>
          </section>
        </div>
      </div>
    );

    if (section === 'ORDERS') return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Orders" title="Order dashboard" copy="Search and review synchronized orders. Operational status changes still happen through the authorized Cashier, Kitchen and Manager workspaces." />
        <label className="relative block max-w-xl"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8d867b]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search order, cashier, status or payment" className="w-full rounded-xl border border-[#d8cfbf] bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-[#d99012]" /></label>
        <div className="overflow-x-auto rounded-2xl border border-[#ded5c5] bg-white">
          <table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-[#e8e0d4] bg-[#faf7f1] text-xs uppercase tracking-wide text-[#777166]"><tr><th className="p-4">Order</th><th className="p-4">Cashier</th><th className="p-4">Status</th><th className="p-4">Payment</th><th className="p-4">Time</th><th className="p-4 text-right">Total</th></tr></thead><tbody className="divide-y divide-[#eee6da]">{visibleOrders.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(order => <tr key={order.id}><td className="p-4 font-bold">#{order.id.slice(-8).toUpperCase()}</td><td className="p-4">{order.cashier_name || '—'}</td><td className="p-4">{order.status}</td><td className="p-4">{order.payment_status}</td><td className="p-4 text-[#777166]">{new Date(order.created_at).toLocaleString('en-ZA')}</td><td className="p-4 text-right font-black">{money(order.total_amount)}</td></tr>)}{visibleOrders.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-[#777166]">No matching orders.</td></tr>}</tbody></table>
        </div>
      </div>
    );

    if (section === 'MENU') return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Menu" title="Products & pricing" copy="Add products, edit customer-facing details and archive items. Physical stock quantities are deliberately controlled by the shop inventory workflow." action={<button type="button" onClick={openNewProduct} className="inline-flex items-center gap-2 rounded-xl bg-[#171714] px-4 py-3 text-sm font-black text-white"><PackagePlus className="h-4 w-4" /> Add menu item</button>} />
        {productMessage && <p className="rounded-xl border border-[#ded5c5] bg-white p-4 text-sm text-[#625d53]" role="status">{productMessage}</p>}
        {productEditorOpen && <form onSubmit={saveProduct} className="grid gap-4 rounded-[1.75rem] border border-[#ded5c5] bg-white p-5 sm:grid-cols-2 sm:p-6">
          <div className="sm:col-span-2 flex items-center justify-between"><div><h3 className="font-black">{editingProductId ? 'Edit menu item' : 'Add menu item'}</h3><p className="text-xs text-[#777166]">Saved to the owner-authorized catalog.</p></div><button type="button" onClick={() => setProductEditorOpen(false)} className="text-sm font-bold text-[#777166]">Close</button></div>
          <label className="grid gap-1 text-xs font-bold text-[#625d53]">Name<input required value={productDraft.name} onChange={e=>setProductDraft(d=>({...d,name:e.target.value}))} className="rounded-xl border border-[#d8cfbf] px-3 py-3 text-sm font-normal text-[#191914]" /></label>
          <label className="grid gap-1 text-xs font-bold text-[#625d53]">Category<input required value={productDraft.category} onChange={e=>setProductDraft(d=>({...d,category:e.target.value}))} className="rounded-xl border border-[#d8cfbf] px-3 py-3 text-sm font-normal text-[#191914]" /></label>
          <label className="grid gap-1 text-xs font-bold text-[#625d53]">Selling price<input required type="number" min="0" step="0.01" value={productDraft.price} onChange={e=>setProductDraft(d=>({...d,price:Number(e.target.value)}))} className="rounded-xl border border-[#d8cfbf] px-3 py-3 text-sm font-normal text-[#191914]" /></label>
          <label className="grid gap-1 text-xs font-bold text-[#625d53]">Cost price <span className="font-normal text-[#91897d]">optional</span><input type="number" min="0" step="0.01" value={productDraft.costPrice ?? ''} onChange={e=>setProductDraft(d=>({...d,costPrice:e.target.value===''?null:Number(e.target.value)}))} className="rounded-xl border border-[#d8cfbf] px-3 py-3 text-sm font-normal text-[#191914]" /></label>
          <label className="grid gap-1 text-xs font-bold text-[#625d53]">Unit<input value={productDraft.unitOfMeasure} onChange={e=>setProductDraft(d=>({...d,unitOfMeasure:e.target.value}))} className="rounded-xl border border-[#d8cfbf] px-3 py-3 text-sm font-normal text-[#191914]" /></label>
          <label className="grid gap-1 text-xs font-bold text-[#625d53] sm:col-span-2">Description<textarea value={productDraft.description || ''} onChange={e=>setProductDraft(d=>({...d,description:e.target.value}))} rows={3} className="rounded-xl border border-[#d8cfbf] px-3 py-3 text-sm font-normal text-[#191914]" /></label>
          <div className="sm:col-span-2"><button type="submit" disabled={productSaving} className="rounded-xl bg-[#d99012] px-5 py-3 text-sm font-black text-[#171714] disabled:opacity-60">{productSaving ? 'Saving…' : editingProductId ? 'Save changes' : 'Add to menu'}</button></div>
        </form>}
        <label className="relative block max-w-xl"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8d867b]" /><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search menu" className="w-full rounded-xl border border-[#d8cfbf] bg-white py-3 pl-11 pr-4 text-sm" /></label>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleProducts.map(product => <article key={product.id} className="rounded-2xl border border-[#ded5c5] bg-white p-5"><div className="flex items-start justify-between gap-3"><div><small className="font-bold uppercase tracking-wide text-[#9a6710]">{product.category}</small><h3 className="mt-1 text-lg font-black">{product.name}</h3></div><button type="button" onClick={()=>openProduct(product)} className="rounded-lg border border-[#ded5c5] p-2" aria-label={`Edit ${product.name}`}><Pencil className="h-4 w-4" /></button></div><p className="mt-2 min-h-10 text-sm text-[#777166]">{product.description || 'No description yet.'}</p><div className="mt-4 flex items-end justify-between"><div><strong className="text-xl font-black">{money(product.price)}</strong><small className="block text-[#91897d]">{product.stock_quantity} {product.unit_of_measure} in stock</small></div><button type="button" onClick={()=>void toggleProduct(product)} className="text-xs font-bold text-[#8c5a08]">{product.status === 'ACTIVE' ? 'Archive' : 'Restore'}</button></div></article>)}</div>
      </div>
    );

    if (section === 'STOCK') return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Stock" title="Inventory visibility" copy="See the synchronized quantity for every product. Receipts, counts, corrections and waste remain physical Manager tasks so browser edits cannot overwrite shop truth." />
        <div className="grid gap-3 sm:grid-cols-3"><Metric label="Tracked items" value={(projection?.products || []).filter(p=>p.status==='ACTIVE').length} /><Metric label="Low stock (<10)" value={(projection?.products || []).filter(p=>p.status==='ACTIVE' && Number(p.stock_quantity)<10).length} /><Metric label="Out of stock" value={(projection?.products || []).filter(p=>p.status==='ACTIVE' && Number(p.stock_quantity)<=0).length} /></div>
        <div className="space-y-2">{(projection?.products || []).filter(p=>p.status==='ACTIVE').sort((a,b)=>Number(a.stock_quantity)-Number(b.stock_quantity)).map(product => <article key={product.id} className="flex flex-col gap-3 rounded-2xl border border-[#ded5c5] bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong>{product.name}</strong><small className="mt-1 block text-[#777166]">{product.category} · {product.unit_of_measure}</small></div><div className="sm:text-right"><strong className={`text-lg ${Number(product.stock_quantity)<10?'text-amber-700':'text-[#191914]'}`}>{Number(product.stock_quantity).toLocaleString('en-ZA')} {product.unit_of_measure}</strong><small className="block text-[#91897d]">{Number(product.stock_quantity)<=0?'Out of stock':Number(product.stock_quantity)<10?'Low stock':'In stock'}</small></div></article>)}</div>
      </div>
    );

    if (section === 'FINANCE') return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Finance" title="Business performance" copy="Sales and payment figures come from synchronized orders. ThePlugOS will not invent profit: exact historical COGS is unavailable until cost snapshots are recorded with each sale." />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Metric label="Captured sales · 30 days" value={money(revenue30)} /><Metric label="Captured orders" value={captured.length} /><Metric label="Average captured order" value={money(averageOrder)} /><Metric label="Open / unpaid value" value={money(pendingValue)} /></div>
        <section className="rounded-[1.75rem] border border-[#ded5c5] bg-white p-5 sm:p-6"><div className="flex items-center gap-3"><WalletCards className="h-5 w-5 text-[#b67608]" /><div><h3 className="font-black">Last 7 trading days</h3><p className="text-xs text-[#777166]">Captured sales only</p></div></div><div className="mt-5 space-y-2">{lastSevenDays.map(day => <div key={day.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-xl bg-[#f8f4ec] px-4 py-3 text-sm"><span>{new Date(`${day.key}T12:00:00+02:00`).toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'short'})}</span><span className="text-[#777166]">{day.orders} orders</span><strong>{money(day.revenue)}</strong></div>)}</div></section>
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">Cost price on the current menu is useful for planning, but it is not a historical cost ledger. Profit, tax liability and bank settlement are therefore not presented as verified financial results yet.</p>
      </div>
    );

    if (section === 'TEAM') return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Team & access" title="Staff profiles and PIN recovery" copy="Create the staff directory here. PINs are never entered or shown in the owner portal; first PIN setup and recovery finish securely on the enrolled Cashier Hub." />
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <form onSubmit={addStaff} className="rounded-[1.75rem] border border-[#ded5c5] bg-white p-5 sm:p-6"><h3 className="font-black">Add staff member</h3><p className="mt-1 text-xs leading-5 text-[#777166]">This creates a profile only. It does not create a PIN or operational session.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-xs font-bold text-[#625d53]">Name<input required value={staffName} onChange={e=>setStaffName(e.target.value)} className="rounded-xl border border-[#d8cfbf] px-3 py-3 text-sm font-normal" /></label><label className="grid gap-1 text-xs font-bold text-[#625d53]">Role<select value={staffRole} onChange={e=>setStaffRole(e.target.value as UserRole)} className="rounded-xl border border-[#d8cfbf] bg-white px-3 py-3 text-sm font-normal"><option value="CASHIER">Cashier</option><option value="KITCHEN_STAFF">Kitchen</option><option value="MANAGER">Manager</option></select></label><button type="submit" disabled={staffSaving} className="rounded-xl bg-[#171714] px-4 py-3 text-sm font-black text-white disabled:opacity-60">{staffSaving?'Adding…':'Add staff profile'}</button></div>{staffMessage&&<p className="mt-4 rounded-xl bg-[#f7f2e9] p-3 text-xs leading-5 text-[#625d53]" role="status">{staffMessage}</p>}</form>
            <section className="rounded-[1.75rem] border border-[#ded5c5] bg-white p-5 sm:p-6"><h3 className="font-black">Branch team</h3><div className="mt-4 space-y-2">{branchStaff.map(member=><div key={member.id} className="flex items-center justify-between rounded-xl border border-[#eee6da] p-3"><div><strong className="text-sm">{member.name}</strong><small className="block text-[#777166]">{roleLabel(member.role)}</small></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-800">{member.status || 'ACTIVE'}</span></div>)}{branchStaff.length===0&&<p className="rounded-xl bg-[#f5efe4] p-4 text-sm text-[#777166]">No active staff profiles yet.</p>}</div></section>
          </div>
          <NativeStaffCredentialResetControl businessId={businessId} branchId={selectedBranchId} staff={staffDirectory} />
        </div>
      </div>
    );

    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Devices & settings" title="Connect the shop" copy="Enroll the Cashier Hub and role-specific terminals from the owner control plane. Operational authority remains on the enrolled Android devices." />
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]"><NativeHubEnrollmentControl businessId={businessId} branchId={selectedBranchId} branchName={branchName} /><section className="rounded-[1.75rem] border border-[#ded5c5] bg-white p-5 sm:p-6"><div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-[#b67608]" /><div><h3 className="font-black">Branch context</h3><p className="text-xs text-[#777166]">Owner portal selection</p></div></div><dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-[#777166]">Branch</dt><dd className="font-bold">{branchName}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#777166]">Active devices</dt><dd className="font-bold">{projection?.deviceCount ?? '—'}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#777166]">Staff profiles</dt><dd className="font-bold">{branchStaff.length}</dd></div></dl></section></div>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#f7f2e9] text-[#191914]">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col lg:flex-row">
        <aside className="border-b border-[#ded5c5] bg-[#171714] text-white lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r lg:border-white/10">
          <div className="flex items-center justify-between gap-3 p-5 lg:block lg:p-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f2aa25] text-[#171714]"><Store className="h-5 w-5" /></span><div><strong className="block text-lg">ThePlugOS</strong><small className="text-stone-400">Owner workspace</small></div></div>{onSignOut&&<button type="button" onClick={onSignOut} className="rounded-xl border border-white/10 p-3 lg:hidden" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>}</div>
          <nav className="flex gap-2 overflow-x-auto px-4 pb-4 lg:block lg:space-y-1 lg:overflow-visible lg:px-4" aria-label="Owner workspace">{navItems.map(item=>{const Icon=item.icon;const active=item.id===section;return <button key={item.id} type="button" onClick={()=>{setSection(item.id);setQuery('');}} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold transition lg:w-full ${active?'bg-[#f2aa25] text-[#171714]':'text-stone-300 hover:bg-white/5 hover:text-white'}`}><Icon className="h-4 w-4" />{item.label}</button>;})}</nav>
          <div className="hidden p-4 lg:block">{onSignOut&&<button type="button" onClick={onSignOut} className="flex w-full items-center gap-3 rounded-xl border border-white/10 px-3 py-3 text-sm font-bold text-stone-300 hover:bg-white/5"><LogOut className="h-4 w-4" />Sign out</button>}</div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="border-b border-[#ded5c5] bg-[#fffdf8] px-4 py-4 sm:px-6 lg:px-8"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#9a6710]">Managing branch</span><h1 className="text-xl font-black">{branchName}</h1></div><div className="flex flex-wrap items-center gap-2">{activeBranches.length>1&&onSelectBranch&&<select value={selectedBranchId} onChange={event=>onSelectBranch(event.target.value)} className="rounded-xl border border-[#d8cfbf] bg-white px-3 py-2 text-sm font-bold">{activeBranches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>}<button type="button" onClick={()=>void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-[#d8cfbf] bg-white px-3 py-2 text-sm font-bold disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`} />Refresh</button></div></div>{warning&&<p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">{warning}</p>}</header>
          <div className="p-4 sm:p-6 lg:p-8">{renderSection()}</div>
        </div>
      </div>
    </main>
  );
};
