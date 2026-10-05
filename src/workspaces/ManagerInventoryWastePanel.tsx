import React from 'react';
import { Trash2 } from 'lucide-react';
import type { NativeHubCommandRequest, NativeHubInventoryProduct } from '@plugos/core';
import { EmptyState, MerchantAction, MerchantNotice, SectionTitle, StatusBadge } from '../components/MerchantStationPrimitives';

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

/* R013 compatibility: Record waste locally. Waste, supplier, purchase-order, cost, cash, approval, and cloud acknowledgement are unavailable. */
export const ManagerInventoryWastePanel: React.FC<ManagerInventoryWastePanelProps> = ({
  products, selectedProductId, quantity, reason, draftLines, pendingRequests, wastingWasteId, submitting,
  onSelectedProductChange, onQuantityChange, onReasonChange, onAddLine, onRemoveLine, onSubmit, onRetry, onAbandon,
}) => {
  const productById = new Map(products.map((product) => [product.id, product]));
  const draftEntries = Object.entries(draftLines)
    .map(([productId, lineQuantity]) => ({ product: productById.get(productId), productId, quantity: lineQuantity }))
    .filter((entry): entry is { product: NativeHubInventoryProduct; productId: string; quantity: string } => Boolean(entry.product));
  const pendingEntries = Object.entries(pendingRequests);
  const hasPending = pendingEntries.length > 0;
  const reasonLabel: Record<ManagerInventoryWasteReason, string> = { SPOILAGE: 'Spoilage', DAMAGE: 'Damage', EXPIRED: 'Expired' };

  return (
    <div className="rounded-[1.35rem] border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
      <SectionTitle eyebrow="Stock out" title="Record waste" description="Remove unusable stock with a clear physical reason." trailing={<StatusBadge label={`${draftEntries.length} line${draftEntries.length === 1 ? '' : 's'}`} tone="amber" icon={Trash2} />} />
      {products.length === 0 ? <div className="mt-4"><EmptyState icon={Trash2} title="No stock products available" detail="Refresh the shop state or check the active product list." /></div> : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:items-end">
            <label className="text-sm font-bold text-[#4f493f]">Product
              <select value={selectedProductId} disabled={submitting || hasPending} onChange={(event) => onSelectedProductChange(event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-sm outline-none focus:border-amber-400 disabled:opacity-50">
                {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQuantity.toFixed(3)} {product.unit}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-[#4f493f]">Reason
              <select value={reason} disabled={submitting || hasPending || draftEntries.length > 0} onChange={(event) => onReasonChange(event.target.value as ManagerInventoryWasteReason)} className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-sm outline-none focus:border-amber-400 disabled:opacity-50">
                {INVENTORY_WASTE_REASONS.map((value) => <option key={value} value={value}>{reasonLabel[value]}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-[#4f493f]">Quantity
              <input value={quantity} inputMode="decimal" disabled={submitting || hasPending} onChange={(event) => onQuantityChange(event.target.value)} placeholder="0.000" className="mt-2 w-full rounded-2xl border border-[#d8cebd] bg-white px-3 py-3 text-sm outline-none focus:border-amber-400 disabled:opacity-50" />
            </label>
          </div>
          <MerchantAction onClick={onAddLine} disabled={submitting || hasPending || !selectedProductId || !quantity.trim()} secondary tone="amber" className="w-full">Add waste item</MerchantAction>
          {draftEntries.length ? (
            <div className="space-y-2 rounded-2xl border border-[#e4dccf] bg-white p-3">
              <strong className="text-sm">{reasonLabel[reason]}</strong>
              {draftEntries.map(({ product, productId, quantity: lineQuantity }) => (
                <div key={productId} className="flex items-center justify-between gap-3 rounded-xl bg-[#fbf7ef] px-3 py-2.5">
                  <div><strong className="block text-sm">{product.name}</strong><span className="text-xs text-[#777166]">Current: {product.stockQuantity.toFixed(3)} {product.unit}</span></div>
                  <div className="flex items-center gap-2"><strong className="text-sm text-amber-900">−{lineQuantity} {product.unit}</strong><button type="button" disabled={submitting || hasPending} onClick={() => onRemoveLine(productId)} className="flex h-10 w-10 items-center justify-center rounded-xl text-[#777166] hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${product.name}`}><Trash2 className="h-4 w-4" /></button></div>
                </div>
              ))}
              <MerchantAction onClick={onSubmit} disabled={submitting || hasPending} tone="amber" className="w-full"><Trash2 className="h-4 w-4" /> Record waste</MerchantAction>
            </div>
          ) : null}
        </div>
      )}
      {pendingEntries.length ? (
        <div className="mt-4 space-y-2">
          <MerchantNotice tone="amber">An earlier waste action was interrupted. Retry that same action before starting another.</MerchantNotice>
          {pendingEntries.map(([wasteId]) => (
            <div key={wasteId} className="rounded-2xl border border-amber-200 bg-white p-3">
              <strong className="text-sm">Waste {wasteId.slice(0, 8)}</strong>
              <MerchantAction onClick={() => onRetry(wasteId)} disabled={submitting} tone="amber" className="mt-2 w-full">{wastingWasteId === wasteId ? 'Recording…' : 'Retry same waste record'}</MerchantAction>
              <MerchantAction onClick={() => onAbandon(wasteId)} disabled={submitting} secondary tone="amber" className="mt-2 w-full">Clear only if it never completed</MerchantAction>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
