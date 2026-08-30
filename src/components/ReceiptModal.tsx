import React, { useState } from 'react';
import { OrderRecord } from '../types';
import { 
  Printer, 
  X, 
  CheckCircle2, 
  QrCode, 
  Layers, 
  Share2,
  Download,
  MessageSquare,
  Copy,
  Check,
  RotateCcw
} from 'lucide-react';

interface ReceiptModalProps {
  order: OrderRecord | null;
  onClose: () => void;
  branchName?: string;
  vatConfig?: { enabled: boolean; rate: number };
  onVoidOrder?: (orderId: string, refundedBy: string) => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ order, onClose, branchName, vatConfig, onVoidOrder }) => {
  const [copied, setCopied] = useState(false);
  const [sharedStatus, setSharedStatus] = useState<string | null>(null);

  if (!order) return null;

  const resolvedBranch = order.branchName || branchName || 'Branch not configured';

  const hasVat = (order.tax && order.tax > 0) || vatConfig?.enabled;
  const vatAmount = order.tax || 0;

  const receiptSummaryText = `
=== ThePlugOS Terminal ===
${hasVat ? 'Tax Invoice & Official Receipt' : 'Official Sales Receipt'}
Order ID: ${order.id}
Branch: ${resolvedBranch}
${hasVat ? 'VAT Reg: 4820193881\n' : ''}Date: ${new Date(order.createdAt).toLocaleString()}
Customer: ${order.customerName}
------------------------------
${order.items.map(i => `${i.quantity}x ${i.name} - R ${(i.price * i.quantity).toFixed(2)}`).join('\n')}
------------------------------
Subtotal: R ${(order.subtotal || order.totalAmount || order.total).toFixed(2)}
${hasVat ? `VAT: R ${vatAmount.toFixed(2)}\n` : ''}TOTAL: R ${(order.totalAmount || order.total).toFixed(2)}
Payment: ${order.paymentMethod ? order.paymentMethod.toUpperCase() : 'CASH'}
Thank you for supporting Local Business!
  `.trim();

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(receiptSummaryText);
    const targetPhone = order.customerPhone ? order.customerPhone.replace(/[^0-9]/g, '') : '';
    const url = targetPhone ? `https://wa.me/${targetPhone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
    setSharedStatus(`WhatsApp receipt dispatched${targetPhone ? ` to ${order.customerPhone}` : ''}!`);
    setTimeout(() => setSharedStatus(null), 3000);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Receipt #${order.id} - ThePlugOS`,
          text: receiptSummaryText,
        });
        setSharedStatus('Receipt shared successfully!');
      } catch (err) {
        console.log('Share canceled or failed', err);
      }
    } else {
      handleCopyText();
    }
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(receiptSummaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadReceipt = () => {
    const element = document.createElement("a");
    const file = new Blob([receiptSummaryText], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `Receipt_${order.id}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    setSharedStatus('Downloaded to device');
    setTimeout(() => setSharedStatus(null), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white text-slate-900 w-full max-w-sm rounded-2xl p-6 shadow-2xl relative font-mono text-xs border border-slate-200 my-auto max-h-[90vh] overflow-y-auto">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-800 p-1 rounded-lg touch-btn flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Store Brand Header */}
        <div className="text-center pb-4 border-b border-dashed border-slate-300">
          <div className="flex items-center justify-center gap-1.5 font-sans font-black text-slate-950 text-base mb-1">
            <Layers className="w-4 h-4 text-amber-500" />
            ThePlugOS Terminal
          </div>
          <p className="text-[10px] text-slate-500 font-sans">
            Branch: {resolvedBranch} {hasVat ? '• VAT Reg: 4820193881' : ''}
          </p>
          <p className="text-[10px] text-slate-400 font-mono mt-1">
            Date: {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>

        {/* Order Details Header */}
        <div className="py-3 border-b border-dashed border-slate-300 space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Order ID:</span>
            <span className="font-bold text-slate-900">{order.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Cashier:</span>
            <span>{order.cashierId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Customer:</span>
            <span className="font-semibold">{order.customerName}</span>
          </div>
        </div>

        {/* Line Items */}
        <div className="py-3 border-b border-dashed border-slate-300 space-y-2">
          {order.items.map((item, idx) => (
            <div key={idx} className="flex justify-between items-start">
              <span className="flex-1 pr-2">
                {item.quantity}× {item.name}
              </span>
              <span className="font-bold">R {(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* Financial Summary */}
        <div className="py-3 border-b border-dashed border-slate-300 space-y-1">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal:</span>
            <span>R {(order.subtotal || order.totalAmount || order.total).toFixed(2)}</span>
          </div>
          {hasVat && (
            <div className="flex justify-between text-slate-500">
              <span>VAT:</span>
              <span>R {vatAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-slate-950 pt-1 border-t border-slate-200">
            <span>TOTAL:</span>
            <span>R {(order.totalAmount || order.total).toFixed(2)}</span>
          </div>
        </div>

        {/* Tendered & Change */}
        <div className="py-3 border-b border-dashed border-slate-300 space-y-1 text-slate-600">
          <div className="flex justify-between">
            <span>Payment Method:</span>
            <span className="font-bold text-slate-900 uppercase">{order.paymentMethod}</span>
          </div>
          {order.paymentMethod === 'CASH' && (
            <>
              <div className="flex justify-between">
                <span>Tendered:</span>
                <span>R {(order.cashTendered || order.total).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900">
                <span>Change Due:</span>
                <span>R {(order.changeDue || 0).toFixed(2)}</span>
              </div>
            </>
          )}
        </div>

        {/* Feedback Alert */}
        {sharedStatus && (
          <div className="my-2 p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-center font-sans font-bold text-[11px] flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {sharedStatus}
          </div>
        )}

        {/* QR Code & Footer */}
        <div className="pt-3 text-center space-y-3">
          <div className="flex justify-center">
            <QrCode className="w-12 h-12 text-slate-800" />
          </div>
          <p className="text-[9px] text-slate-400 font-sans">
            Thank you for supporting Local Business!
          </p>

          {/* Action Grid */}
          <div className="grid grid-cols-2 gap-2 pt-1 font-sans">
            <button
              onClick={() => window.print()}
              className="bg-slate-900 text-white font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 hover:bg-slate-800 text-xs transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>

            <button
              onClick={handleShareWhatsApp}
              className="bg-emerald-600 text-white font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 hover:bg-emerald-500 text-xs transition-all"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              WhatsApp
            </button>

            <button
              onClick={handleNativeShare}
              className="bg-slate-100 border border-slate-300 text-slate-800 font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 hover:bg-slate-200 text-xs transition-all"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>

            <button
              onClick={handleDownloadReceipt}
              className="bg-slate-100 border border-slate-300 text-slate-800 font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 hover:bg-slate-200 text-xs transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Save TXT
            </button>
          </div>

          {onVoidOrder && order.status !== 'CANCELLED' && (
            <button
              onClick={() => {
                if (confirm(`Are you sure you want to void/refund Order #${order.id}? Raw inventory will be returned to stock.`)) {
                  onVoidOrder(order.id, order.cashierId || 'Manager');
                  onClose();
                }
              }}
              className="w-full mt-2 bg-rose-50 border border-rose-200 text-rose-700 font-sans font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 hover:bg-rose-100 text-xs transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
              Void / Refund This Transaction
            </button>
          )}

          <button
            onClick={handleCopyText}
            className="w-full text-[11px] text-slate-500 hover:text-slate-800 font-sans font-medium flex items-center justify-center gap-1 py-1"
          >
            {copied ? (
              <span className="text-emerald-600 font-bold flex items-center gap-1">
                <Check className="w-3 h-3" /> Copied Text Receipt
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Copy className="w-3 h-3" /> Copy Raw Receipt Text
              </span>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

