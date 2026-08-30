import React, { useState } from 'react';
import { UserSession, OrderRecord, ProductItem, PaymentType, CustomerRecord, ShiftInfo } from '../types';
import { ReceiptModal } from '../components/ReceiptModal';
import { 
  ShoppingCart, 
  CreditCard, 
  Banknote, 
  QrCode, 
  Printer, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Minus, 
  Trash2, 
  Search,
  Bell,
  FileCheck2,
  DollarSign,
  X,
  Lock,
  RefreshCw,
  RotateCcw,
  FileText,
  AlertTriangle,
  History
} from 'lucide-react';

interface CashierWorkspaceProps {
  session: UserSession;
  kernel: any;
  orders: OrderRecord[];
  products?: ProductItem[];
  onPlaceOrder: (order: OrderRecord) => void;
  onUpdateOrderStatus: (orderId: string, status: OrderRecord['status']) => void;
  onVoidOrder?: (orderId: string, refundedBy: string) => void;
  vatConfig?: { enabled: boolean; rate: number };
  customers?: CustomerRecord[];
  onUpdateCustomers?: (customers: CustomerRecord[]) => void;
}

export const CashierWorkspace: React.FC<CashierWorkspaceProps> = ({
  session,
  kernel,
  orders,
  products = [],
  onPlaceOrder,
  onUpdateOrderStatus,
  onVoidOrder,
  vatConfig = { enabled: false, rate: 15 },
  customers = [],
  onUpdateCustomers
}) => {
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Basket State & Cash Drawer (Phase 8)
  const [basket, setBasket] = useState<{ product: ProductItem; quantity: number; notes?: string }[]>([]);
  const [selectedPaymentType, setSelectedPaymentType] = useState<PaymentType>('CASH');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [cashTenderedInput, setCashTenderedInput] = useState<string>('');

  const [receiptOrder, setReceiptOrder] = useState<OrderRecord | null>(null);
  
  // Receipt Search & Reprint Panel (Phase 7)
  const [receiptSearch, setReceiptSearch] = useState<string>('');
  const [showHistoryPanel, setShowHistoryPanel] = useState<boolean>(false);

  // Shift Management State (Phase 9)
  const [activeShift, setActiveShift] = useState<ShiftInfo>({
    id: session.shiftId || 'SHIFT-003',
    branchId: session.branchId,
    branchName: session.branchName,
    operatorId: session.userId,
    operatorName: session.userName,
    role: session.role,
    openingFloat: 500,
    openedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    status: 'OPEN'
  });
  const [isShiftModalOpen, setIsShiftModalOpen] = useState<boolean>(false);
  const [actualCashInput, setActualCashInput] = useState<string>('');
  const [managerPin, setManagerPin] = useState<string>('');
  const [shiftNotes, setShiftNotes] = useState<string>('');

  // Active Ready Orders for Collection
  const readyOrders = orders.filter(o => o.status === 'READY');

  const availableProducts = products.filter(p => {
    const matchesDomain = selectedDomain === 'ALL' || p.domain === selectedDomain;
    const matchesCat = selectedCategory === 'ALL' || p.category === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDomain && matchesCat && matchesSearch;
  });

  const categories = ['ALL', ...Array.from(new Set(
    (selectedDomain === 'ALL' ? products : products.filter(p => p.domain === selectedDomain)).map(p => p.category)
  ))];

  const addToBasket = (product: ProductItem) => {
    setBasket(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromBasket = (productId: string) => {
    setBasket(prev => prev.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setBasket(prev => {
      return prev.map(item => {
        if (item.product.id === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      }).filter(Boolean) as { product: ProductItem; quantity: number }[];
    });
  };

  const calculateSubtotal = () => basket.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  const calculateTax = () => (vatConfig.enabled ? calculateSubtotal() * (vatConfig.rate / 100) : 0);
  const calculateTotal = () => calculateSubtotal() + calculateTax();

  // Shift financial calculations
  const shiftCashOrders = orders.filter(o => 
    o.cashierId === session.userId && 
    o.status !== 'CANCELLED' && 
    (o.paymentType === 'CASH' || o.paymentMethod === 'CASH')
  );
  const shiftTotalCashSales = shiftCashOrders.reduce((sum, o) => sum + (o.totalAmount || o.total || 0), 0);
  const expectedCashInDrawer = activeShift.openingFloat + shiftTotalCashSales;

  const handleCheckoutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (basket.length === 0) return;

    const subtotal = calculateSubtotal();
    const tax = calculateTax();
    const total = calculateTotal();
    const orderId = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;

    const tenderedVal = selectedPaymentType === 'CASH' 
      ? (parseFloat(cashTenderedInput) || total) 
      : total;
    const changeDueVal = Math.max(0, tenderedVal - total);

    const newOrder: OrderRecord = {
      id: orderId,
      businessId: session.businessId,
      // A browser-generated device ID is not operational authority. This
      // compatibility workspace is gated until a native session bridge supplies
      // the verified device ID, so never manufacture one from local storage.
      deviceId: session.deviceId,
      domain: selectedDomain,
      branchId: session.branchId,
      cashierId: session.userId,
      cashierName: session.userName,
      items: basket.map(b => ({
        productId: b.product.id,
        name: b.product.name,
        price: b.product.price,
        quantity: b.quantity,
        domain: b.product.domain,
        notes: b.notes || undefined,
      })),
      subtotal,
      tax,
      total,
      totalAmount: total,
      paymentMethod: selectedPaymentType,
      paymentType: selectedPaymentType,
      cashTendered: tenderedVal,
      changeDue: changeDueVal,
      status: 'SUBMITTED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      customerPhone: customerPhone || undefined,
    };

    onPlaceOrder(newOrder);
    setReceiptOrder(newOrder);

    // Reset Basket & Cash Input
    setBasket([]);
    setCustomerPhone('');
    setCashTenderedInput('');
  };

  // Close shift handler
  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    const actualCount = parseFloat(actualCashInput) || 0;
    const diff = actualCount - expectedCashInDrawer;

    const closed: ShiftInfo = {
      ...activeShift,
      status: 'CLOSED',
      closedAt: new Date().toISOString(),
      closingCashCount: actualCount,
      expectedCashTotal: expectedCashInDrawer,
      variance: diff,
      managerApproved: true,
      notes: shiftNotes || `Shift closed by ${session.userName}.`
    };

    setActiveShift(closed);
    setIsShiftModalOpen(false);

    kernel?.events?.publish?.('SHIFT_CLOSED', {
      shiftId: closed.id,
      branchId: closed.branchId,
      cashierName: closed.operatorName,
      openingFloat: closed.openingFloat,
      expectedCash: closed.expectedCashTotal,
      actualCash: closed.closingCashCount,
      variance: closed.variance,
      timestamp: new Date().toISOString()
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Domain Switcher, Search, Item Grid */}
        <div className="lg:col-span-7 space-y-4">
          
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto no-scrollbar">
            <button
              onClick={() => { setSelectedDomain('ALL'); setSelectedCategory('ALL'); }}
              className={`px-3 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                selectedDomain === 'ALL'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              All items
            </button>
            <button
              onClick={() => { setSelectedDomain('fastfood-domain'); setSelectedCategory('ALL'); }}
              className={`px-3 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                selectedDomain === 'fastfood-domain'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              🍔 Fast Food
            </button>
            <button
              onClick={() => { setSelectedDomain('store-items'); setSelectedCategory('ALL'); }}
              className={`px-3 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                selectedDomain === 'store-items'
                  ? 'bg-emerald-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              🛒 Store Items
            </button>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search menu item or barcode..."
                className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition-all ${
                    selectedCategory === cat
                      ? 'bg-slate-800 text-amber-400 border-amber-500/50'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Items Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {availableProducts.map(product => (
              <div
                key={product.id}
                onClick={() => addToBasket(product)}
                className="bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-4 cursor-pointer transition-all hover:scale-[1.01] flex flex-col justify-between space-y-3 group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">
                      {product.name}
                    </h3>
                    <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                      R{product.price.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">
                    {product.description}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] text-slate-500 font-mono">
                    Stock: {product.stock} {product.unit}
                  </span>
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-lg group-hover:bg-amber-500 group-hover:text-slate-950 transition-all">
                    <Plus className="w-3.5 h-3.5" /> Add
                  </span>
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* Right Column: Active Cart & Checkout */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">Current order</h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {basket.reduce((a, b) => a + b.quantity, 0)} Items
              </span>
            </div>

            {basket.length === 0 ? (
              <div className="py-12 text-center text-slate-500 space-y-2">
                <ShoppingCart className="w-10 h-10 mx-auto opacity-30" />
                <p className="text-xs">No items added yet.</p>
                <p className="text-[10px] text-slate-600">Tap an item to begin the order.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                {basket.map(({ product, quantity }) => (
                  <div key={product.id} className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-200 truncate">{product.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">R{product.price.toFixed(2)} each</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(product.id, -1)}
                        className="p-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-mono font-bold text-amber-400 px-1">{quantity}</span>
                      <button
                        onClick={() => updateQuantity(product.id, 1)}
                        className="p-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => removeFromBasket(product.id)}
                        className="p-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg ml-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {basket.length > 0 && (
            <form onSubmit={handleCheckoutSubmit} className="space-y-4 pt-3 border-t border-slate-800">

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType('CASH')}
                    className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                      selectedPaymentType === 'CASH'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Banknote className="w-4 h-4" /> Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType('CARD')}
                    className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                      selectedPaymentType === 'CARD'
                        ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" /> Card POS
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType('SPAZAPAY_QR')}
                    className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                      selectedPaymentType === 'SPAZAPAY_QR'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <QrCode className="w-4 h-4" /> SpazaPay QR
                  </button>
                </div>
              </div>

              {selectedPaymentType === 'CASH' && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <label className="text-slate-300 font-bold">Cash Received (Tendered):</label>
                    <div className="relative w-32">
                      <span className="absolute left-2.5 top-2 text-slate-500 font-bold">R</span>
                      <input
                        type="number"
                        step="0.50"
                        placeholder={calculateTotal().toFixed(2)}
                        value={cashTenderedInput}
                        onChange={(e) => setCashTenderedInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-2 py-1.5 text-right font-bold text-amber-400 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                  {cashTenderedInput && (
                    <div className="flex justify-between items-center pt-1.5 border-t border-slate-800 font-bold">
                      <span className="text-slate-400">Change Due:</span>
                      <span className="text-emerald-400 text-sm">
                        R{Math.max(0, (parseFloat(cashTenderedInput) || 0) - calculateTotal()).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5 font-mono">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Subtotal</span>
                  <span>R{calculateSubtotal().toFixed(2)}</span>
                </div>
                {vatConfig.enabled && (
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>VAT ({vatConfig.rate}% SA)</span>
                    <span>R{calculateTax().toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-white pt-1.5 border-t border-slate-800">
                  <span>TOTAL DUE</span>
                  <span className="text-amber-400 text-base">R{calculateTotal().toFixed(2)}</span>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20 cursor-pointer"
              >
                <Printer className="w-4 h-4" /> Process Payment & Dispatch Order
              </button>

            </form>
          )}
        </div>

      </div>

      {/* Ready Orders Counter */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Order Collection Counter (Ready from Kitchen)</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">{readyOrders.length} Ready</span>
        </div>

        {readyOrders.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No orders pending customer pickup right now.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {readyOrders.map(order => (
              <div key={order.id} className="bg-slate-950 border border-emerald-500/40 p-3.5 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-black font-mono text-emerald-400">{order.id}</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">READY</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 font-semibold">{order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}</p>
                </div>

                <button
                  onClick={() => onUpdateOrderStatus(order.id, 'COMPLETED')}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all"
                >
                  <FileCheck2 className="w-4 h-4" /> Handover to Customer
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shift End Reconciliation Modal (Phase 9) */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl relative space-y-4 font-mono text-xs">
            <button
              onClick={() => setIsShiftModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Lock className="w-5 h-5 text-purple-400" />
              <div>
                <h3 className="text-base font-bold text-white">Shift Reconciliation & Drawer Close</h3>
                <p className="text-xs text-slate-400 font-mono">Shift ID: {activeShift.id}</p>
              </div>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-4">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>Opening Cash Float:</span>
                  <span className="font-bold text-white">R{activeShift.openingFloat.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold block">Actual Counted Cash in Drawer (R):</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 500.00"
                  value={actualCashInput}
                  onChange={(e) => setActualCashInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-base focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Manager Approval PIN (Optional):</label>
                <input
                  type="password"
                  maxLength={4}
                  placeholder="Manager PIN"
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Shift Closing Notes:</label>
                <input
                  type="text"
                  placeholder="e.g. End of day shift reconciled successfully."
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsShiftModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-1.5"
                >
                  <Lock className="w-4 h-4" /> Close Shift & Lock Drawer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ReceiptModal 
        order={receiptOrder} 
        onClose={() => setReceiptOrder(null)} 
        vatConfig={vatConfig}
      />

    </div>
  );
};
