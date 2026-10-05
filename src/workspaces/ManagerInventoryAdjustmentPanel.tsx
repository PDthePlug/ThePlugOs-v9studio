import React from 'react';
import { ClipboardPenLine, Trash2 } from 'lucide-react';
import type { NativeHubCommandRequest, NativeHubInventoryProduct } from '@plugos/core';
import { EmptyState, MerchantAction, MerchantNotice, SectionTitle, StatusBadge } from '../components/MerchantStationPrimitives';

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

/* R012 compatibility: Record count correction locally. Waste, supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable. */
export const ManagerInventoryAdjustmentPanel: React.FC<ManagerInventoryAdjustmentPanelProps> = ({
  products, selectedProductId, stockAfter, draftLines, pendingRequests, adjustingAdjustmentId, submitting,
  onSelectedProductChange, onStockAfterChange, onAddLine, onRemoveLine, onSubmit, onRetry, onAbandon,
}) => {
  const productById = new Map(products.map((product) => [product.id, product]));
  const draftEntries = Object.entries(draftLines)
    .map(([productId, lineStockAfter]) => ({ product: productById.get(productId), productId, stockAfter: lineStockAfter }))
    .filter((entry): entry is { product: NativeHubInventoryProduct; productId: string; stockAfter: string } => Boolean(entry.product));
  const pendingEntries = Object.entries(pendingRequests);
  const hasPending = pendingEntries.length > 0;

  return (
    <div className="rounded-[1.35rem] border border-sky-200 bg-sky-50/55 p-4 sm:p-5">
      <SectionTitle eyebrow="Stock count" title="Correct a physical count" description="Enter what you actually counted on the shelf. The difference is calculated when the correction is accepted." trailing={<StatusBadge label={`${draftEntries.length} count${draftEntries.length === 1 ? '' : 's'}`} tone="sky" icon={ClipboardPenLine} />} />
      {products.length === 0 ? <div className="mt-4"><EmptyState icon={ClipboardPenLine} title="No stock products available" detail="Refresh the shop state or check the active product list." /></div> : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
            <label className="text-sm font-bold text-[#4f493f]">Product
              <select value={selectedProductId} disabled={submitting || hasPending} onChange={(event) => onSelectedProductChange(event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-sm outline-none focus:border-sky-400 disabled:opacity-50">
                {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQuantity.toFixed(3)} {product.unit}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-[#4f493f]">Counted balance
              <input value={stockAfter} inputMode="decimal" disabled={submitting || hasPending} onChange={(event) => onStockAfterChange(event.target.value)} placeholder="0.000" className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-sm outline-none focus:border-sky-400 disabled:opacity-50" />
            </label>
            <MerchantAction onClick={onAddLine} disabled={submitting || hasPending || !selectedProductId || !stockAfter.trim()} secondary tone="sky">Add count</MerchantAction>
          </div>
          {draftEntries.length ? (
            <div className="space-y-2 rounded-2xl border border-[#e4dccf] bg-white p-3">
              {draftEntries.map(({ product, productId, stockAfter: lineStockAfter }) => (
                <div key={productId} className="flex items-center justify-between gap-3 rounded-xl bg-[#fbf7ef] px-3 py-2.5">
                  <div><strong className="block text-sm">{product.name}</strong><span className="text-xs text-[#777166]">Current: {product.stockQuantity.toFixed(3)} {product.unit}</span></div>
                  <div className="flex items-center gap-2"><strong className="text-sm text-sky-800">Counted {lineStockAfter}</strong><button type="button" disabled={submitting || hasPending} onClick={() => onRemoveLine(productId)} className="flex h-10 w-10 items-center justify-center rounded-xl text-[#777166] hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${product.name}`}><Trash2 className="h-4 w-4" /></button></div>
                </div>
              ))}
              <MerchantAction onClick={onSubmit} disabled={submitting || hasPending} tone="sky" className="w-full"><ClipboardPenLine className="h-4 w-4" /> Save stock correction</MerchantAction>
            </div>
          ) : null}
        </div>
      )}
      {pendingEntries.length ? (
        <div className="mt-4 space-y-2">
          <MerchantNotice tone="amber">An earlier stock-count action was interrupted. Retry that same action before starting another.</MerchantNotice>
          {pendingEntries.map(([adjustmentId]) => (
            <div key={adjustmentId} className="rounded-2xl border border-amber-200 bg-white p-3">
              <strong className="text-sm">Count {adjustmentId.slice(0, 8)}</strong>
              <MerchantAction onClick={() => onRetry(adjustmentId)} disabled={submitting} tone="amber" className="mt-2 w-full">{adjustingAdjustmentId === adjustmentId ? 'Recording…' : 'Retry same correction'}</MerchantAction>
              <MerchantAction onClick={() => onAbandon(adjustmentId)} disabled={submitting} secondary tone="amber" className="mt-2 w-full">Clear only if it never completed</MerchantAction>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
