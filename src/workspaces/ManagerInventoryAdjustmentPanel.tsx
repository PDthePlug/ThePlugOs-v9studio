import React from 'react';
import { ClipboardPenLine, Trash2 } from 'lucide-react';
import type { NativeHubCommandRequest, NativeHubInventoryProduct } from '@plugos/core';

export type ManagerInventoryAdjustmentRequest = NativeHubCommandRequest & { adjustmentId: string };

interface ManagerInventoryAdjustmentPanelProps {
  products: NativeHubInventoryProduct[];
  selectedProductId: string;
  stockAfter: string;
  draftLines: Record<string, string>;
  pendingRequests: Record<string, ManagerInventoryAdjustmentRequest>;
  adjustingAdjustmentId: string | null;
  submitting: boolean;
  onSelectedProductChange: (productId: string) => void;
  onStockAfterChange: (stockAfter: string) => void;
  onAddLine: () => void;
  onRemoveLine: (productId: string) => void;
  onSubmit: () => void;
  onRetry: (adjustmentId: string) => void;
  onAbandon: (adjustmentId: string) => void;
}

/** A Manager can correct a physical count without receiving price, supplier,
 * cost, cash, approval, or stock-loss authority in the browser layer. */
export const ManagerInventoryAdjustmentPanel: React.FC<ManagerInventoryAdjustmentPanelProps> = ({
  products,
  selectedProductId,
  stockAfter,
  draftLines,
  pendingRequests,
  adjustingAdjustmentId,
  submitting,
  onSelectedProductChange,
  onStockAfterChange,
  onAddLine,
  onRemoveLine,
  onSubmit,
  onRetry,
  onAbandon,
}) => {
  const productById = new Map(products.map((product) => [product.id, product]));
  const draftEntries = Object.entries(draftLines)
    .map(([productId, lineStockAfter]) => ({ product: productById.get(productId), productId, stockAfter: lineStockAfter }))
    .filter((entry): entry is { product: NativeHubInventoryProduct; productId: string; stockAfter: string } => Boolean(entry.product));
  const pendingEntries = Object.entries(pendingRequests);
  const hasPendingRequest = pendingEntries.length > 0;

  return (
    <section className="space-y-4 rounded-3xl border border-sky-500/30 bg-slate-900 p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 text-sky-200"><ClipboardPenLine className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-sky-200">Physical count correction</p>
          <h2 className="mt-1 text-xl font-black">Record a measured stock balance locally</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">Enter the quantity physically counted for an active signed product. Native code derives the stock difference and commits one count-correction record atomically.</p>
        </div>
      </div>

      {products.length === 0 ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">No active signed inventory products are available for a count correction. Refresh the measured Hub state or renew its authorized catalog after its outbox is empty.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
            <label className="block text-sm font-semibold text-slate-200">Product<select value={selectedProductId} disabled={submitting || hasPendingRequest} onChange={(event) => onSelectedProductChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-50">{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQuantity.toFixed(3)} {product.unit}</option>)}</select></label>
            <label className="block text-sm font-semibold text-slate-200">Counted balance<input value={stockAfter} inputMode="decimal" disabled={submitting || hasPendingRequest} onChange={(event) => onStockAfterChange(event.target.value)} placeholder="0.000" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50" /></label>
            <button type="button" disabled={submitting || hasPendingRequest || !selectedProductId || !stockAfter.trim()} onClick={onAddLine} className="flex h-[46px] items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 text-xs font-black text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50">Add count</button>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">A matching balance is not recorded as a no-op. The preview is not an inventory fact; the Hub checks the current signed balance and derives the difference again at commit time.</p>

          {draftEntries.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-100">Measured balances</strong><span className="text-xs text-slate-500">{draftEntries.length} item{draftEntries.length === 1 ? '' : 's'}</span></div>
              {draftEntries.map(({ product, productId, stockAfter: lineStockAfter }) => (
                <div key={productId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
                  <div><strong className="block text-sm text-slate-100">{product.name}</strong><span className="text-xs text-slate-500">Current signed balance: {product.stockQuantity.toFixed(3)} {product.unit}</span></div>
                  <div className="flex items-center gap-3"><strong className="text-sm text-sky-100">Counted: {lineStockAfter} {product.unit}</strong><button type="button" disabled={submitting || hasPendingRequest} onClick={() => onRemoveLine(productId)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Remove ${product.name} from count correction`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div>
                </div>
              ))}
              <button type="button" disabled={submitting || hasPendingRequest} onClick={onSubmit} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"><ClipboardPenLine className="h-4 w-4" aria-hidden="true" />Record count correction locally</button>
            </div>
          )}
        </>
      )}

      {pendingEntries.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Exact request recovery</p><p className="mt-1 text-sm leading-relaxed text-amber-100">A local count-correction request has no measured correction yet. Retry its exact native request or abandon only after native confirmation; never create a replacement adjustment ID.</p></div>
          {pendingEntries.map(([adjustmentId]) => (
            <div key={adjustmentId} className="rounded-xl border border-amber-500/30 bg-slate-950 p-3">
              <div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-100">Correction {adjustmentId.slice(0, 8)}</strong><span className="text-xs font-semibold text-amber-100">REVIEW</span></div>
              <button type="button" disabled={submitting} onClick={() => onRetry(adjustmentId)} className="mt-3 flex w-full items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs font-black text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50">{adjustingAdjustmentId === adjustmentId ? 'Recording locally…' : 'Retry the same count correction'}</button>
              <button type="button" disabled={submitting} onClick={() => onAbandon(adjustmentId)} className="mt-2 w-full text-xs font-semibold text-amber-100 hover:text-amber-50 disabled:cursor-not-allowed disabled:opacity-50">Abandon only if native confirms it never committed</button>
            </div>
          ))}
        </div>
      )}

      <p className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-400"><strong className="text-slate-200">Waste, supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable.</strong> This correction records only a measured final product balance and its native-derived quantity difference.</p>
    </section>
  );
};
