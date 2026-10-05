import React, { useState } from 'react';
import { RestockRequest, ProductItem, UserRole, SupplierRecord } from '../types';
import { 
  FileText, 
  CheckCircle2, 
  XCircle, 
  PackageCheck, 
  Clock, 
  Building2, 
  User, 
  MessageSquare, 
  Search, 
  Filter, 
  ArrowRight,
  AlertTriangle,
  X,
  Printer,
  TrendingUp,
  DollarSign
} from 'lucide-react';

interface PurchaseOrderEngineProps {
  requests: RestockRequest[];
  onUpdateRequestStatus?: (updatedRequests: RestockRequest[]) => void;
  onUpdateRequests?: (updatedRequests: RestockRequest[]) => void;
  products: ProductItem[];
  onUpdateProducts: (updatedProducts: ProductItem[]) => void;
  userRole: UserRole;
  userName: string;
  kernel?: any;
  suppliers?: SupplierRecord[];
}

export const PurchaseOrderEngine: React.FC<PurchaseOrderEngineProps> = ({
  requests,
  onUpdateRequestStatus,
  onUpdateRequests,
  products,
  onUpdateProducts,
  userRole,
  userName,
  kernel,
  suppliers = []
}) => {
  const updateRequests = onUpdateRequests || onUpdateRequestStatus || (() => {});
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedRequest, setSelectedRequest] = useState<RestockRequest | null>(null);
  
  // Receive Delivery Modal
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receivingQuantities, setReceivingQuantities] = useState<{ [productId: string]: number }>({});
  const [deliveryNotes, setDeliveryNotes] = useState<string>('');
  const [notification, setNotification] = useState<string | null>(null);

  const filteredRequests = requests.filter(req => {
    if (filterStatus !== 'ALL' && req.status !== filterStatus) return false;
    if (searchTerm) {
      const query = searchTerm.toLowerCase();
      return (
        req.id.toLowerCase().includes(query) ||
        req.branchName.toLowerCase().includes(query) ||
        req.managerName.toLowerCase().includes(query) ||
        (req.supplierName && req.supplierName.toLowerCase().includes(query))
      );
    }
    return true;
  });

  // Owner Approve
  const handleApprove = (req: RestockRequest) => {
    const updated = requests.map(r => 
      r.id === req.id 
        ? { ...r, status: 'APPROVED' as const, approvedAt: new Date().toISOString() } 
        : r
    );
    updateRequests(updated);
    setNotification(`Purchase Order #${req.id} APPROVED by Owner.`);

    kernel?.events?.publish?.('PURCHASE_APPROVED', {
      requestId: req.id,
      branchId: req.branchId,
      supplierName: req.supplierName,
      approvedBy: userName,
      timestamp: new Date().toISOString()
    });

    setTimeout(() => setNotification(null), 4000);
  };

  // Owner Reject
  const handleReject = (req: RestockRequest) => {
    const updated = requests.map(r => 
      r.id === req.id 
        ? { ...r, status: 'REJECTED' as const } 
        : r
    );
    updateRequests(updated);
    setNotification(`Purchase Order #${req.id} REJECTED.`);

    kernel?.events?.publish?.('PURCHASE_REJECTED', {
      requestId: req.id,
      rejectedBy: userName,
      timestamp: new Date().toISOString()
    });

    setTimeout(() => setNotification(null), 4000);
  };

  // Open Receive Delivery Modal
  const handleOpenReceive = (req: RestockRequest) => {
    setSelectedRequest(req);
    const initialQty: { [productId: string]: number } = {};
    req.items.forEach(item => {
      initialQty[item.productId] = item.quantity;
    });
    setReceivingQuantities(initialQty);
    setDeliveryNotes('');
    setIsReceiveModalOpen(true);
  };

  // Execute Stock Intake
  const handleConfirmIntake = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;

    // 1. Update product stock
    const updatedProducts = products.map(product => {
      const intakeQty = receivingQuantities[product.id] || 0;
      if (intakeQty > 0) {
        return {
          ...product,
          stock: product.stock + intakeQty
        };
      }
      return product;
    });

    onUpdateProducts(updatedProducts);

    // 2. Update Request Status to DELIVERED
    const updatedRequests = requests.map(r => 
      r.id === selectedRequest.id 
        ? { 
            ...r, 
            status: 'DELIVERED' as const, 
            deliveredAt: new Date().toISOString(),
            notes: deliveryNotes ? `Delivery Notes: ${deliveryNotes}` : r.notes
          } 
        : r
    );

    updateRequests(updatedRequests);

    // 3. Kernel Events
    kernel?.events?.publish?.('PURCHASE_RECEIVED', {
      requestId: selectedRequest.id,
      branchId: selectedRequest.branchId,
      receivedBy: userName,
      deliveredAt: new Date().toISOString(),
      items: selectedRequest.items
    });

    selectedRequest.items.forEach(item => {
      const added = receivingQuantities[item.productId] || item.quantity;
      kernel?.events?.publish?.('INVENTORY_RESTOCKED', {
        productId: item.productId,
        productName: item.name,
        addedQuantity: added,
        receivedBy: userName,
        requestId: selectedRequest.id,
        timestamp: new Date().toISOString()
      });
    });

    setNotification(`Stock intake completed for PO #${selectedRequest.id}. Inventory updated.`);
    setIsReceiveModalOpen(false);
    setTimeout(() => setNotification(null), 4000);
  };

  const getStatusBadge = (status: RestockRequest['status']) => {
    switch (status) {
      case 'PENDING_APPROVAL':
        return <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"><Clock className="w-3 h-3" /> PENDING OWNER APPROVAL</span>;
      case 'APPROVED':
        return <span className="bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> APPROVED (AWAITING DELIVERY)</span>;
      case 'PARTIALLY_APPROVED':
        return <span className="bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold">PARTIALLY APPROVED</span>;
      case 'DELIVERED':
        return <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"><PackageCheck className="w-3 h-3 text-emerald-400" /> STOCK INTAKE COMPLETE</span>;
      case 'REJECTED':
        return <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1"><XCircle className="w-3 h-3 text-rose-400" /> REJECTED</span>;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Purchase orders & stock intake</h2>
            <p className="text-xs text-slate-400 font-mono">
              Manager restock requests, owner approval workflows, and stock intake verification.
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto no-scrollbar">
          {['ALL', 'PENDING_APPROVAL', 'APPROVED', 'DELIVERED', 'REJECTED'].map(st => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-btn ${
                filterStatus === st ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              {st === 'ALL' ? 'All Orders' : st.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {notification && (
        <div className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 p-3 rounded-xl text-xs font-mono flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
        <input
          type="text"
          placeholder="Search requests by PO ID, branch, manager, or supplier..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
        />
      </div>

      {/* Purchase Orders List */}
      <div className="space-y-4">
        {filteredRequests.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 space-y-2 font-mono">
            <PackageCheck className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-sm">No restock requests match the current filter.</p>
          </div>
        ) : (
          filteredRequests.map(req => (
            <div 
              key={req.id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 hover:border-slate-700 transition-all"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-white text-base">{req.id}</span>
                  {getStatusBadge(req.status)}
                </div>

                <span className="text-xs text-slate-400 font-mono">
                  Date: {req.date}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono text-slate-300">
                <div>
                  <span className="text-slate-500 text-[10px] block">Branch & Manager</span>
                  <span className="font-bold text-white">{req.branchName}</span>
                  <p className="text-slate-400 text-[11px]">Requested by: {req.managerName}</p>
                </div>

                <div>
                  <span className="text-slate-500 text-[10px] block">Supplier</span>
                  <span className="font-bold text-white">{req.supplierName || 'General Supplier'}</span>
                  {req.supplierPhone && (
                    <p className="text-emerald-400 text-[11px]">WhatsApp: {req.supplierPhone}</p>
                  )}
                </div>

                <div>
                  <span className="text-slate-500 text-[10px] block">Est. Cost & Reason</span>
                  <span className="font-bold text-emerald-400 text-sm">
                    R{req.totalEstimatedCost ? req.totalEstimatedCost.toFixed(2) : '0.00'}
                  </span>
                  <p className="text-slate-400 text-[11px] truncate">Reason: {req.reason}</p>
                </div>
              </div>

              {/* Required Items Table */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 font-mono text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Requested Items Breakdown ({req.items.length})
                </span>
                <div className="divide-y divide-slate-800/60">
                  {req.items.map((item, idx) => (
                    <div key={idx} className="py-1.5 flex items-center justify-between text-slate-200">
                      <span>{item.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-purple-300">{item.quantity} {item.unit || 'units'}</span>
                        {item.costPrice && (
                          <span className="text-slate-400 text-[11px]">
                            @ R{item.costPrice.toFixed(2)} = R{(item.costPrice * item.quantity).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {req.notes && (
                <p className="text-xs text-slate-400 italic bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  Notes: {req.notes}
                </p>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <a
                    href={`https://wa.me/${req.supplierPhone?.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                      `RESTOCK PURCHASE REQUEST\nPO #: ${req.id}\nBranch: ${req.branchName}\nManager: ${req.managerName}\n\nItems:\n${req.items.map(i => `- ${i.quantity}x ${i.name}`).join('\n')}\n\nReason: ${req.reason}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 text-xs px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 touch-btn"
                  >
                    <MessageSquare className="w-4 h-4" /> Send via WhatsApp
                  </a>
                </div>

                <div className="flex items-center gap-2">
                  {/* Owner Approval buttons */}
                  {req.status === 'PENDING_APPROVAL' && (userRole === 'OWNER' || userRole === 'ADMINISTRATOR' || userRole === 'MANAGER') && (
                    <>
                      <button
                        onClick={() => handleReject(req)}
                        className="bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 text-xs px-3 py-2 rounded-xl font-bold flex items-center gap-1 touch-btn"
                      >
                        <XCircle className="w-4 h-4" /> Reject Request
                      </button>
                      <button
                        onClick={() => handleApprove(req)}
                        className="bg-purple-600 hover:bg-purple-500 text-white text-xs px-4 py-2 rounded-xl font-bold shadow-lg flex items-center gap-1.5 touch-btn"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve Purchase Request
                      </button>
                    </>
                  )}

                  {/* Manager / Staff Receive Delivery Button */}
                  {(req.status === 'APPROVED' || req.status === 'PARTIALLY_APPROVED') && (
                    <button
                      onClick={() => handleOpenReceive(req)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2.5 rounded-xl font-bold shadow-lg flex items-center gap-2 touch-btn"
                    >
                      <PackageCheck className="w-4 h-4" /> Receive Stock Delivery
                    </button>
                  )}
                </div>
              </div>

            </div>
          ))
        )}
      </div>

      {/* Receive Delivery Modal */}
      {isReceiveModalOpen && selectedRequest && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsReceiveModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <PackageCheck className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-base font-bold text-white">Receive delivery — PO #{selectedRequest.id}</h3>
                <p className="text-xs text-slate-400 font-mono">{selectedRequest.branchName}</p>
              </div>
            </div>

            <form onSubmit={handleConfirmIntake} className="space-y-4 font-mono text-xs">
              <p className="text-slate-300">
                Check the delivered quantities below. Confirming adds the received items to stock.
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-3">
                {selectedRequest.items.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between gap-3 border-b border-slate-800/60 pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="font-bold text-white">{item.name}</p>
                      <p className="text-[10px] text-slate-400">Requested: {item.quantity} {item.unit}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-slate-400">Delivered:</label>
                      <input
                        type="number"
                        min="0"
                        value={receivingQuantities[item.productId] ?? item.quantity}
                        onChange={(e) => setReceivingQuantities({
                          ...receivingQuantities,
                          [item.productId]: Math.max(0, parseInt(e.target.value) || 0)
                        })}
                        className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-emerald-400 font-bold text-right focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Delivery Notes / Delivery Note #</label>
                <input
                  type="text"
                  placeholder="e.g. DN-88192 - All items received in good condition"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-2"
                >
                  <PackageCheck className="w-4 h-4" /> Confirm Stock Intake
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
