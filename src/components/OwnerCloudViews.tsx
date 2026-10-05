import React, {useMemo, useState} from 'react';
import {Download, Package, ReceiptText, Search} from 'lucide-react';
import {capturedOrder, tradingDay, type OwnerProjection} from '../lib/owner-projection';
import {EmptyState, MerchantAction, SectionCard, SectionTitle} from './MerchantStationPrimitives';

const money = new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'});
const date = (value: string) => new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export function OwnerCloudViews({data}: {data: OwnerProjection | null}) {
  const [tab,setTab] = useState<'ORDERS'|'MENU'|'REPORTS'>('ORDERS');
  const [search,setSearch] = useState('');
  const daily = useMemo(() => {
    const days = new Map<string,{day:string;orders:number;sales:number}>();
    for(const order of data?.orders ?? []) {
      if(!capturedOrder(order))continue;
      const day=tradingDay(order.created_at);
      const row=days.get(day) ?? {day,orders:0,sales:0};
      row.orders++;row.sales+=Number(order.total_amount);days.set(day,row);
    }
    return [...days.values()].sort((a,b)=>b.day.localeCompare(a.day));
  },[data]);
  const exportSales = () => {
    const csv=['Day,Confirmed paid orders,Sales ZAR',...daily.map(row=>`${row.day},${row.orders},${row.sales.toFixed(2)}`)].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    const link=document.createElement('a');link.href=url;link.download='theplugos-branch-sales.csv';link.click();URL.revokeObjectURL(url);
  };
  const orders = [...(data?.orders ?? [])].sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const products = (data?.products ?? []).filter(product => `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
  return <SectionCard>
    <nav className="mb-6 flex flex-wrap gap-2" aria-label="Business records">
      {(['ORDERS','MENU','REPORTS'] as const).map(value=><button key={value} type="button" aria-pressed={tab===value} onClick={()=>setTab(value)} className={`rounded-xl border px-5 py-3 text-sm font-bold ${tab===value?'border-[#191914] bg-[#191914] text-white':'border-[#ded5c5] bg-white text-[#625d53]'}`}>{value==='ORDERS'?'Orders':value==='MENU'?'Menu & stock':'Reports'}</button>)}
    </nav>
    {!data ? <p className="text-sm text-[#777166]">Business records are unavailable. Refresh to try again.</p> : tab==='ORDERS' ? <>
      <SectionTitle title="Recent orders" description="Last 30 South African trading dates · latest orders first" />
      {orders.length ? <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{orders.slice(0,60).map(order=><article key={order.id} className="rounded-2xl border border-[#ded5c5] bg-white p-4">
        <div className="flex flex-wrap justify-between gap-2"><strong title={order.id}>#{order.id.slice(-8)}</strong><strong>{money.format(Number(order.total_amount))}</strong></div>
        <p className="mt-2 text-xs text-[#777166]">{date(order.created_at)} · {order.cashier_name || 'Cashier'}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-lg bg-[#f1eadc] px-2 py-1">{order.status.replaceAll('_',' ')}</span><span className={`rounded-lg px-2 py-1 ${capturedOrder(order)?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-900'}`}>{order.payment_status.replaceAll('_',' ')}</span></div>
      </article>)}</div> : <EmptyState title="No orders in this period" detail="Orders appear here after the shop devices synchronize." icon={ReceiptText} />}
      {orders.length>60&&<p className="mt-4 text-xs text-[#777166]">Showing the latest 60 of {orders.length} orders. Reports include the full loaded period.</p>}
    </> : tab==='MENU' ? <>
      <SectionTitle title="Menu and stock" description="Your branch catalog and last synchronized stock quantities" />
      <label className="mt-5 flex items-center gap-2 rounded-xl border border-[#ded5c5] bg-white px-4"><Search className="h-4 w-4 text-[#777166]"/><input aria-label="Search menu and stock" placeholder="Find a product or category" value={search} onChange={event=>setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /></label>
      {products.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{products.map(product=><article key={product.id} className="rounded-2xl border border-[#ded5c5] bg-white p-4">
        <strong>{product.name}</strong><p className="mt-1 text-xs text-[#777166]">{product.category} · {product.status.toLowerCase()}</p>
        <div className="mt-4 flex justify-between gap-3"><strong>{money.format(Number(product.price))}</strong><span className={Number(product.stock_quantity)<10?'text-amber-800':'text-[#625d53]'}>{Number(product.stock_quantity).toLocaleString('en-ZA')} {product.unit_of_measure}</span></div>
      </article>)}</div> : <EmptyState title="No matching products" detail="Try another search or check this branch's catalog." icon={Package} />}
    </> : <>
      <SectionTitle title="Branch sales" description="Confirmed payments grouped by the order's creation date, in South African time. Cancelled and unpaid orders are excluded." trailing={<MerchantAction onClick={exportSales} disabled={!daily.length} secondary tone="slate"><Download className="h-4 w-4"/> Export sales</MerchantAction>} />
      {daily.length ? <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-[#777166]"><tr><th className="p-3">Day</th><th className="p-3 text-right">Paid orders</th><th className="p-3 text-right">Sales</th></tr></thead><tbody>{daily.map(row=><tr className="border-t border-[#ded5c5]" key={row.day}><td className="p-3">{row.day}</td><td className="p-3 text-right">{row.orders}</td><td className="p-3 text-right font-bold">{money.format(row.sales)}</td></tr>)}</tbody></table></div> : <p className="mt-5 text-sm text-[#777166]">No confirmed paid orders in the last 30 trading dates.</p>}
    </>}
    {data&&<p className="mt-6 text-xs text-[#777166]">Last refreshed {date(data.loadedAt)}. Cloud records may lag behind shop devices.</p>}
  </SectionCard>;
}
