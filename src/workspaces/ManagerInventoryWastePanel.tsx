import React from 'react';
import { Trash2 } from 'lucide-react';
import type { NativeHubCommandRequest, NativeHubInventoryProduct } from '@plugos/core';

export const INVENTORY_WASTE_REASONS = ['SPOILAGE', 'DAMAGE', 'EXPIRED'] as const;
export type ManagerInventoryWasteReason = (typeof INVENTORY_WASTE_REASONS)[number];
export type ManagerInventoryWasteRequest = NativeHubCommandRequest & { wasteId: string };

interface ManagerInventoryWastePanelProps {
  products: NativeHubInventoryProduct[];
  selectedProductId: string;
  quantity: string;
  reason: ManagerInventoryWasteReason;
  draftLines: Record<string, string>;
  pendingRequests: Record<string, ManagerInventoryWasteRequest>;
  wastingWasteId: string | null;
  submitting: boolean;
  onSelectedProductChange: (productId: string) => void;
  onQuantityChange: (quantity: string) => void;
  onReasonChange: (reason: ManagerInventoryWasteReason) => void;
  onAddLine: () => void;
  onRemoveLine: (productId: string) => void;
  onSubmit: () => void;
  onRetry: (wasteId: string) => void;
  onAbandon: (wasteId: string) => void;
}

/** A Manager can record a bounded physical stock loss without exposing cost,
 * cash, supplier, approval, or financial-loss controls in the browser. */
export const ManagerInventoryWastePanel: React.FC<ManagerInventoryWastePanelProps> = ({
  products,
  selectedProductId,
  quantity,
  reason,
  draftLines,
  pendingRequests,
  wastingWasteId,
  submitting,
  onSelectedProductChange,
  onQuantityChange,
  onReasonChange,
  onAddLine,
  onRemoveLine,
  onSubmit,
  onRetry,
  onAbandon,
}) => {
  const productById = new Map(products.map((product) => [product.id, product]));
  const draftEntries = Object.entries(draftLines)
    .map(([productId, lineQuantity]) => ({ product: productById.get(productId), productId, quantity: lineQuantity }))
    .filter((entry): entry is { product: NativeHubInventoryProduct; productId: string; quantity: string } => Boolean(entry.product));
  const pendingEntries = Object.entries(pendingRequests);
  const hasPendingRequest = pendingEntries.length > 0;

  return (
    <section className="space-y-4 rounded-3xl border border-amber-500/30 bg-slate-900 p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-200"><Trash2 className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-200">Physical stock waste</p>
          <h2 className="mt-1 text-xl font-black">Record unusable stock locally</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">Choose a bounded waste reason and quantity for an active signed product. Native code verifies the available balance and commits one immutable waste record and stock movement.</p>
        </div>
      </div>

      {products.length === 0 ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">No active signed inventory products are available for a waste record. Refresh the measured Hub state or renew its authorized catalog after its outbox is empty.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:items-end">
            <label className="block text-sm font-semibold text-slate-200">Product<select value={selectedProductId} disabled={submitting || hasPendingRequest} onChange={(event) => onSelectedProductChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-50">{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQuantity.toFixed(3)} {product.unit}</option>)}</select></label>
            <label className="block text-sm font-semibold text-slate-200">Reason<select value={reason} disabled={submitting || hasPendingRequest || draftEntries.length > 0} onChange={(event) => onReasonChange(event.target.value as ManagerInventoryWasteReason)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-50">{INVENTORY_WASTE_REASONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="block text-sm font-semibold text-slate-200">Quantity<input value={quantity} inputMode="decimal" disabled={submitting || hasPendingRequest} onChange={(event) => onQuantityChange(event.target.value)} placeholder="0.000" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50" /></label>
          </div>
          <button type="button" disabled={submitting || hasPendingRequest || !selectedProductId || !quantity.trim()} onClick={onAddLine} className="flex w-full items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-black text-amber-100 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50">Add waste line</button>
          <p className="text-xs leading-relaxed text-slate-500">A waste line is a positive physical quantity and cannot exceed the current signed balance. Native code checks the balance again at commit time; this preview is not an inventory or financial fact.</p>

          {draftEntries.length > 0 ? (
            <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-100">Waste lines · {reason}</strong><span className="text-xs text-slate-500">{draftEntries.length} item{draftEntries.length === 1 ? '' : 's'}</span></div>
              {draftEntries.map(({ product, productId, quantity: lineQuantity }) => (
                <div key={productId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
                  <div><strong className="block text-sm text-slate-100">{product.name}</strong><span className="text-xs text-slate-500">Current signed balance: {product.stockQuantity.toFixed(3)} {product.unit}</span></div>
                  <div className="flex items-center gap-3"><strong className="text-sm text-amber-100">Remove: {lineQuantity} {product.unit}</strong><button type="button" disabled={submitting || hasPendingRequest} onClick={() => onRemoveLine(productId)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Remove ${product.name} from waste record`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div>
                </div>
              ))}
              <button type="button" disabled={submitting || hasPendingRequest} onClick={onSubmit} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden="true" />Record waste locally</button>
            </div>
          ) : null}
        </>
      )}

      {pendingEntries.length > 0 ? (
        <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Exact request recovery</p><p className="mt-1 text-sm leading-relaxed text-amber-100">A local waste request has no measured waste record yet. Retry its exact native request or abandon only after native confirmation; never create a replacement waste ID.</p></div>
          {pendingEntries.map(([wasteId]) => (
            <div key={wasteId} className="rounded-xl border border-amber-500/30 bg-slate-950 p-3">
              <div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-100">Waste {wasteId.slice(0, 8)}</strong><span className="text-xs font-semibold text-amber-100">REVIEW</span></div>
              <button type="button" disabled={submitting} onClick={() => onRetry(wasteId)} className="mt-3 flex w-full items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-black text-amber-100 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50">{wastingWasteId === wasteId ? 'Recording locally…' : 'Retry the same waste record'}</button>
              <button type="button" disabled={submitting} onClick={() => onAbandon(wasteId)} className="mt-2 w-full text-xs font-semibold text-amber-100 hover:text-amber-50 disabled:cursor-not-allowed disabled:opacity-50">Abandon only if native confirms it never committed</button>
            </div>
          ))}
        </div>
      ) : null}

      <p className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-400"><strong className="text-slate-200">Waste, supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable.</strong> This records a bounded local stock movement only; it does not calculate a financial loss, supplier claim, tax adjustment, disposal certificate, refund, or delivery result.</p>
    </section>
  );
};
