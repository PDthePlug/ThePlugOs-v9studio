import React from 'react';
import { PackagePlus, Trash2 } from 'lucide-react';
import type { NativeHubCommandRequest, NativeHubInventoryProduct } from '@plugos/core';
import { EmptyState, MerchantAction, MerchantNotice, SectionTitle, StatusBadge } from '../components/MerchantStationPrimitives';

export type ManagerInventoryReceiptRequest = NativeHubCommandRequest & { receiptId: string };

interface ManagerInventoryReceiptPanelProps {
  products: NativeHubInventoryProduct[];
  selectedProductId: string;
  quantity: string;
  draftLines: Record<string, string>;
  pendingRequests: Record<string, ManagerInventoryReceiptRequest>;
  receivingReceiptId: string | null;
  submitting: boolean;
  onSelectedProductChange: (productId: string) => void;
  onQuantityChange: (quantity: string) => void;
  onAddLine: () => void;
  onRemoveLine: (productId: string) => void;
  onSubmit: () => void;
  onRetry: (receiptId: string) => void;
  onAbandon: (receiptId: string) => void;
}

/* R011 compatibility: Record counted receipt locally. Supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable. */
export const ManagerInventoryReceiptPanel: React.FC<ManagerInventoryReceiptPanelProps> = ({
  products, selectedProductId, quantity, draftLines, pendingRequests, receivingReceiptId, submitting,
  onSelectedProductChange, onQuantityChange, onAddLine, onRemoveLine, onSubmit, onRetry, onAbandon,
}) => {
  const productById = new Map(products.map((product) => [product.id, product]));
  const draftEntries = Object.entries(draftLines)
    .map(([productId, lineQuantity]) => ({ product: productById.get(productId), productId, quantity: lineQuantity }))
    .filter((entry): entry is { product: NativeHubInventoryProduct; productId: string; quantity: string } => Boolean(entry.product));
  const pendingEntries = Object.entries(pendingRequests);
  const hasPending = pendingEntries.length > 0;

  return (
    <div className="rounded-[1.35rem] border border-violet-200 bg-violet-50/55 p-4 sm:p-5">
      <SectionTitle eyebrow="Stock in" title="Receive stock" description="Count what physically arrived, then record those quantities." trailing={<StatusBadge label={`${draftEntries.length} line${draftEntries.length === 1 ? '' : 's'}`} tone="slate" icon={PackagePlus} />} />

      {products.length === 0 ? (
        <div className="mt-4"><EmptyState icon={PackagePlus} title="No stock products available" detail="Refresh the shop state or check the active product list." /></div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
            <label className="text-sm font-bold text-[#4f493f]">Product
              <select value={selectedProductId} disabled={submitting || hasPending} onChange={(event) => onSelectedProductChange(event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-sm outline-none focus:border-violet-400 disabled:opacity-50">
                {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQuantity.toFixed(3)} {product.unit}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-[#4f493f]">Quantity received
              <input value={quantity} inputMode="decimal" disabled={submitting || hasPending} onChange={(event) => onQuantityChange(event.target.value)} placeholder="0.000" className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-sm outline-none focus:border-violet-400 disabled:opacity-50" />
            </label>
            <MerchantAction onClick={onAddLine} disabled={submitting || hasPending || !selectedProductId || !quantity.trim()} secondary tone="sky">Add item</MerchantAction>
          </div>

          {draftEntries.length ? (
            <div className="space-y-2 rounded-2xl border border-[#e4dccf] bg-white p-3">
              {draftEntries.map(({ product, productId, quantity: lineQuantity }) => (
                <div key={productId} className="flex items-center justify-between gap-3 rounded-xl bg-[#fbf7ef] px-3 py-2.5">
                  <div><strong className="block text-sm">{product.name}</strong><span className="text-xs text-[#777166]">Current: {product.stockQuantity.toFixed(3)} {product.unit}</span></div>
                  <div className="flex items-center gap-2"><strong className="text-sm text-violet-800">+{lineQuantity} {product.unit}</strong><button type="button" disabled={submitting || hasPending} onClick={() => onRemoveLine(productId)} className="flex h-10 w-10 items-center justify-center rounded-xl text-[#777166] hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${product.name}`}><Trash2 className="h-4 w-4" /></button></div>
                </div>
              ))}
              <MerchantAction onClick={onSubmit} disabled={submitting || hasPending} tone="sky" className="w-full"><PackagePlus className="h-4 w-4" /> Record stock received</MerchantAction>
            </div>
          ) : null}
        </div>
      )}

      {pendingEntries.length ? (
        <div className="mt-4 space-y-2">
          <MerchantNotice tone="amber">An earlier stock-receipt action was interrupted. Retry that same action before starting another.</MerchantNotice>
          {pendingEntries.map(([receiptId]) => (
            <div key={receiptId} className="rounded-2xl border border-amber-200 bg-white p-3">
              <strong className="text-sm">Receipt {receiptId.slice(0, 8)}</strong>
              <MerchantAction onClick={() => onRetry(receiptId)} disabled={submitting} tone="amber" className="mt-2 w-full">{receivingReceiptId === receiptId ? 'Recording…' : 'Retry same receipt'}</MerchantAction>
              <MerchantAction onClick={() => onAbandon(receiptId)} disabled={submitting} secondary tone="amber" className="mt-2 w-full">Clear only if it never completed</MerchantAction>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
