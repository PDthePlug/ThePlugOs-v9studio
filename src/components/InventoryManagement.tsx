import React, { useState } from 'react';
import { ProductItem, SupplierRecord, RestockRequest, RestockItem } from '../types';
import { 
  Package, 
  AlertTriangle, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  Truck, 
  FileSpreadsheet, 
  TrendingDown, 
  RefreshCw,
  Search,
  X,
  Edit3,
  Copy,
  Archive,
  RotateCcw,
  MessageSquare,
  Download,
  Share2,
  Building2,
  DollarSign,
  Tag,
  Barcode,
  Layers
} from 'lucide-react';

interface InventoryManagementProps {
  products: ProductItem[];
  onUpdateProducts: (updated: ProductItem[]) => void;
  suppliers?: SupplierRecord[];
  restockRequests?: RestockRequest[];
  onAddRestockRequest?: (request: RestockRequest) => void;
  kernel?: any;
  branchId?: string;
  branchName?: string;
  userId?: string;
  userName?: string;
}

export const InventoryManagement: React.FC<InventoryManagementProps> = ({
  products,
  onUpdateProducts,
  suppliers = [],
  restockRequests = [],
  onAddRestockRequest,
  kernel,
  branchId,
  branchName,
  userId,
  userName
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED' | 'LOW_STOCK'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Item Add/Edit Modal
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProductItem | null>(null);
  const [itemFormData, setItemFormData] = useState<Partial<ProductItem>>({
    name: '',
    category: 'Spatlo / Kotas',
    price: 0,
    domain: 'fastfood-domain',
    description: '',
    stock: 20,
    unit: 'loaves',
    supplier: 'Fresh Wholesalers & Grains',
    purchaseUnit: 'Loaves (Pack of 10)',
    sellingUnit: 'Single Loaf',
    minQuantity: 10,
    reorderQuantity: 30,
    costPrice: 0,
    supplierNotes: '',
    storageLocation: 'Main Dry Store A1',
    barcode: '',
    status: 'ACTIVE'
  });

  // Restock Purchase Request Builder Modal
  const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
  const [selectedRestockProduct, setSelectedRestockProduct] = useState<ProductItem | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [restockQty, setRestockQty] = useState<number>(30);
  const [restockReason, setRestockReason] = useState<string>('Low Stock Threshold Reached');
  const [copiedText, setCopiedText] = useState<boolean>(false);

  // Waste Recording Modal
  const [isWasteModalOpen, setIsWasteModalOpen] = useState(false);
  const [selectedWasteProduct, setSelectedWasteProduct] = useState<ProductItem | null>(null);
  const [wasteQty, setWasteQty] = useState<number>(1);
  const [wasteReason, setWasteReason] = useState<string>('EXPIRED');

  const [notification, setNotification] = useState<string | null>(null);

  const categories = ['ALL', ...Array.from(new Set(products.map(p => p.category)))];

  const filteredProducts = products.filter(p => {
    // Status filter
    if (statusFilter === 'ACTIVE' && p.status === 'ARCHIVED') return false;
    if (statusFilter === 'ARCHIVED' && p.status !== 'ARCHIVED') return false;
    if (statusFilter === 'LOW_STOCK' && p.stock > (p.minQuantity || 10)) return false;

    // Category filter
    if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;

    // Search query
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.supplier && p.supplier.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.includes(q))
      );
    }
    return true;
  });

  const lowStockCount = products.filter(p => p.stock <= (p.minQuantity || 10)).length;

  // --- CRUD HANDLERS ---
  const handleOpenAdd = () => {
    setEditingItem(null);
    setItemFormData({
      name: '',
      category: 'Spatlo / Kotas',
      price: 45,
      domain: 'fastfood-domain',
      description: '',
      stock: 20,
      unit: 'loaves',
      supplier: suppliers[0]?.name || 'Fresh Wholesalers & Grains',
      purchaseUnit: 'Loaves',
      sellingUnit: 'Unit',
      minQuantity: 10,
      reorderQuantity: 30,
      costPrice: 25,
      supplierNotes: '',
      storageLocation: 'Shelf A1',
      barcode: `800${Math.floor(Math.random() * 89999 + 10000)}`,
      status: 'ACTIVE'
    });
    setIsItemModalOpen(true);
  };

  const handleOpenEdit = (product: ProductItem) => {
    setEditingItem(product);
    setItemFormData(product);
    setIsItemModalOpen(true);
  };

  const handleSaveItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemFormData.name || itemFormData.price === undefined) return;

    let updatedProducts: ProductItem[];
    if (editingItem) {
      updatedProducts = products.map(p => p.id === editingItem.id ? { ...p, ...itemFormData } as ProductItem : p);
      setNotification(`Updated inventory item '${itemFormData.name}'`);
      kernel?.events?.publish?.('INVENTORY_UPDATED', {
        productId: editingItem.id,
        productName: itemFormData.name,
        updatedBy: userId,
        timestamp: new Date().toISOString()
      });
    } else {
      const newItem: ProductItem = {
        id: `inv-${Date.now().toString().slice(-4)}`,
        name: itemFormData.name || 'New Item',
        category: itemFormData.category || 'General',
        price: Number(itemFormData.price) || 0,
        domain: itemFormData.domain || 'fastfood-domain',
        description: itemFormData.description || '',
        stock: Number(itemFormData.stock) || 0,
        unit: itemFormData.unit || 'units',
        supplier: itemFormData.supplier || '',
        purchaseUnit: itemFormData.purchaseUnit || itemFormData.unit || 'units',
        sellingUnit: itemFormData.sellingUnit || 'unit',
        minQuantity: Number(itemFormData.minQuantity) || 10,
        reorderQuantity: Number(itemFormData.reorderQuantity) || 30,
        costPrice: Number(itemFormData.costPrice) || 0,
        supplierNotes: itemFormData.supplierNotes || '',
        storageLocation: itemFormData.storageLocation || 'Store Room',
        barcode: itemFormData.barcode || '',
        status: (itemFormData.status as 'ACTIVE' | 'ARCHIVED') || 'ACTIVE'
      };
      updatedProducts = [newItem, ...products];
      setNotification(`Created new inventory item '${newItem.name}'`);
      kernel?.events?.publish?.('INVENTORY_CREATED', {
        productId: newItem.id,
        productName: newItem.name,
        createdBy: userId,
        timestamp: new Date().toISOString()
      });
    }

    onUpdateProducts(updatedProducts);
    setIsItemModalOpen(false);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleDuplicateItem = (product: ProductItem) => {
    const duplicated: ProductItem = {
      ...product,
      id: `inv-${Date.now().toString().slice(-4)}`,
      name: `${product.name} (Copy)`,
      status: 'ACTIVE'
    };
    const updated = [duplicated, ...products];
    onUpdateProducts(updated);
    setNotification(`Duplicated item '${product.name}'`);
    kernel?.events?.publish?.('INVENTORY_CREATED', {
      productId: duplicated.id,
      productName: duplicated.name,
      createdBy: userId,
      timestamp: new Date().toISOString()
    });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleToggleArchive = (product: ProductItem) => {
    const newStatus: 'ACTIVE' | 'ARCHIVED' = product.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
    const updated = products.map(p => p.id === product.id ? { ...p, status: newStatus } : p);
    onUpdateProducts(updated);
    setNotification(`${newStatus === 'ARCHIVED' ? 'Archived' : 'Reactivated'} item '${product.name}'`);
    kernel?.events?.publish?.(newStatus === 'ARCHIVED' ? 'INVENTORY_ARCHIVED' : 'INVENTORY_UPDATED', {
      productId: product.id,
      productName: product.name,
      status: newStatus,
      updatedBy: userId,
      timestamp: new Date().toISOString()
    });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleDeleteItem = (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete inventory item '${name}'?`)) return;
    const updated = products.filter(p => p.id !== id);
    onUpdateProducts(updated);
    setNotification(`Deleted item '${name}'`);
    kernel?.events?.publish?.('INVENTORY_DELETED', {
      productId: id,
      productName: name,
      deletedBy: userId,
      timestamp: new Date().toISOString()
    });
    setTimeout(() => setNotification(null), 4000);
  };

  // --- RESTOCK REQUEST WORKFLOW ---
  const handleOpenRestock = (product?: ProductItem) => {
    if (product) {
      setSelectedRestockProduct(product);
      setRestockQty(product.reorderQuantity || 30);
    } else {
      setSelectedRestockProduct(null);
      setRestockQty(50);
    }
    setRestockReason('Low Stock Threshold Reached');
    setIsRestockModalOpen(true);
  };

  const selectedSupplierObj = suppliers.find(s => s.id === selectedSupplierId || s.name === selectedSupplierId) || suppliers[0];

  const buildRestockRequestText = () => {
    const targetItems = selectedRestockProduct
      ? [{ name: selectedRestockProduct.name, qty: restockQty, unit: selectedRestockProduct.unit, cost: selectedRestockProduct.costPrice || selectedRestockProduct.price * 0.6 }]
      : products.filter(p => p.stock <= (p.minQuantity || 10)).map(p => ({
          name: p.name,
          qty: p.reorderQuantity || 30,
          unit: p.unit,
          cost: p.costPrice || p.price * 0.6
        }));

    const totalEst = targetItems.reduce((sum, item) => sum + (item.cost * item.qty), 0);

    return `
RESTOCK PURCHASE REQUEST
Branch: ${branchName}
Manager: ${userName}
Date: ${new Date().toISOString().split('T')[0]}
Supplier: ${selectedSupplierObj?.name || 'Wholesale Supplier'}

Items Required:
${targetItems.map(i => `- ${i.qty} ${i.unit} x ${i.name} (@ R${i.cost.toFixed(2)})`).join('\n')}

Total Estimated Cost: R${totalEst.toFixed(2)}
Reason: ${restockReason}

Generated automatically by ThePlugOS.
    `.trim();
  };

  const handleSendWhatsAppRestock = () => {
    const msg = buildRestockRequestText();
    const phone = selectedSupplierObj?.whatsapp || selectedSupplierObj?.phone || '+27825550192';
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    
    // Also save request locally
    handleSaveRestockRequestRecord();
  };

  const handleCopyRestockText = () => {
    navigator.clipboard.writeText(buildRestockRequestText());
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  const handleDownloadRestockText = () => {
    const element = document.createElement("a");
    const file = new Blob([buildRestockRequestText()], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `Restock_Request_${Date.now()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleSaveRestockRequestRecord = () => {
    const targetItems: RestockItem[] = selectedRestockProduct
      ? [{
          productId: selectedRestockProduct.id,
          name: selectedRestockProduct.name,
          quantity: restockQty,
          costPrice: selectedRestockProduct.costPrice || selectedRestockProduct.price * 0.6,
          unit: selectedRestockProduct.unit
        }]
      : products.filter(p => p.stock <= (p.minQuantity || 10)).map(p => ({
          productId: p.id,
          name: p.name,
          quantity: p.reorderQuantity || 30,
          costPrice: p.costPrice || p.price * 0.6,
          unit: p.unit
        }));

    const totalCost = targetItems.reduce((sum, i) => sum + ((i.costPrice || 0) * i.quantity), 0);

    const newRequest: RestockRequest = {
      id: `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 899 + 100)}`,
      branchId,
      branchName,
      managerId: userId,
      managerName: userName,
      date: new Date().toISOString().split('T')[0],
      supplierId: selectedSupplierObj?.id,
      supplierName: selectedSupplierObj?.name || 'Wholesale Supplier',
      supplierPhone: selectedSupplierObj?.whatsapp || selectedSupplierObj?.phone,
      items: targetItems,
      reason: restockReason,
      status: 'PENDING_APPROVAL',
      totalEstimatedCost: totalCost
    };

    onAddRestockRequest?.(newRequest);

    kernel?.events?.publish?.('RESTOCK_REQUESTED', {
      requestId: newRequest.id,
      branchId,
      supplierName: newRequest.supplierName,
      itemsCount: targetItems.length,
      requestedBy: userName,
      timestamp: new Date().toISOString()
    });

    setNotification(`Purchase Restock Request #${newRequest.id} dispatched to Owner & Supplier.`);
    setIsRestockModalOpen(false);
    setTimeout(() => setNotification(null), 4000);
  };

  // --- WASTE RECORDING ---
  const handleOpenWaste = (product: ProductItem) => {
    setSelectedWasteProduct(product);
    setWasteQty(1);
    setWasteReason('EXPIRED');
    setIsWasteModalOpen(true);
  };

  const handleExecuteWaste = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWasteProduct || wasteQty <= 0) return;

    const updated = products.map(p => p.id === selectedWasteProduct.id ? { ...p, stock: Math.max(0, p.stock - wasteQty) } : p);
    onUpdateProducts(updated);

    kernel?.events?.publish?.('STOCK_WASTE_RECORDED', {
      productId: selectedWasteProduct.id,
      productName: selectedWasteProduct.name,
      wasteQuantity: wasteQty,
      reason: wasteReason,
      managerId: userId,
      timestamp: new Date().toISOString()
    });

    setNotification(`Recorded waste: -${wasteQty} ${selectedWasteProduct.unit} for ${selectedWasteProduct.name}`);
    setIsWasteModalOpen(false);
    setTimeout(() => setNotification(null), 4000);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Control Panel */}
      <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">Stock Control & Inventory Admin</h2>
              {lowStockCount > 0 && (
                <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {lowStockCount} Low Stock
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Complete inventory CRUD, stock intake, supplier linkages & WhatsApp purchase requests.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => handleOpenRestock()}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-all shadow-md flex items-center gap-1.5 touch-btn"
          >
            <Truck className="w-4 h-4" /> Build Restock Request
          </button>
          <button
            onClick={handleOpenAdd}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-all shadow-md flex items-center gap-1.5 touch-btn"
          >
            <Plus className="w-4 h-4" /> Add Inventory Item
          </button>
        </div>
      </div>

      {notification && (
        <div className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 p-3 rounded-xl text-xs font-mono flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Filter & Search Toolbar */}
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search items by name, category, supplier, or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
          />
        </div>

        {/* Filter Badges */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar font-mono text-xs">
          {(['ALL', 'ACTIVE', 'LOW_STOCK', 'ARCHIVED'] as const).map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap touch-btn ${
                statusFilter === st ? 'bg-amber-500 text-slate-950 font-black shadow-md' : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              {st === 'ALL' ? 'All Items' : st === 'LOW_STOCK' ? `⚠️ Low Stock (${lowStockCount})` : st}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Table / Cards */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden font-mono">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Item Details</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Stock Level</th>
                <th className="py-3 px-4">Cost / Selling</th>
                <th className="py-3 px-4">Supplier</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No inventory items match the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredProducts.map(p => {
                  const isLow = p.stock <= (p.minQuantity || 10);
                  const isArchived = p.status === 'ARCHIVED';

                  return (
                    <tr key={p.id} className={`hover:bg-slate-850 transition-colors ${isArchived ? 'opacity-50 bg-slate-950/40' : ''}`}>
                      <td className="py-3 px-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">{p.name}</span>
                            {isArchived && (
                              <span className="bg-slate-800 text-slate-400 text-[9px] px-1.5 py-0.5 rounded">ARCHIVED</span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500">
                            Unit: {p.unit} • Loc: {p.storageLocation || 'Store'} {p.barcode ? `• Barcode: ${p.barcode}` : ''}
                          </p>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg text-slate-300 font-bold">
                          {p.category}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-base font-black ${
                            p.stock === 0 ? 'text-rose-500' : isLow ? 'text-rose-400' : 'text-emerald-400'
                          }`}>
                            {p.stock}
                          </span>
                          <span className="text-slate-500 text-[10px]">{p.unit}</span>
                          {isLow && !isArchived && (
                            <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                              LOW
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-500">Min: {p.minQuantity || 10} • Reorder: {p.reorderQuantity || 30}</p>
                      </td>

                      <td className="py-3 px-4 font-bold">
                        <div className="text-white">R{p.price.toFixed(2)}</div>
                        <div className="text-[10px] text-slate-500">Cost: R{(p.costPrice || 0).toFixed(2)}</div>
                      </td>

                      <td className="py-3 px-4 text-slate-300 text-[11px]">
                        {p.supplier || 'General Supplier'}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenRestock(p)}
                            className="bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 px-2 py-1 rounded-lg text-[11px] font-bold touch-btn flex items-center gap-1"
                            title="Request Restock"
                          >
                            <Truck className="w-3.5 h-3.5" /> Restock
                          </button>
                          <button
                            onClick={() => handleOpenWaste(p)}
                            className="bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20 px-2 py-1 rounded-lg text-[11px] font-bold touch-btn flex items-center gap-1"
                            title="Record Waste"
                          >
                            <TrendingDown className="w-3.5 h-3.5" /> Waste
                          </button>
                          <button
                            onClick={() => handleOpenEdit(p)}
                            className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg touch-btn"
                            title="Edit Item"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDuplicateItem(p)}
                            className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg touch-btn"
                            title="Duplicate Item"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleArchive(p)}
                            className="p-1.5 text-amber-400 hover:text-amber-300 bg-amber-500/10 rounded-lg touch-btn"
                            title={isArchived ? "Reactivate Item" : "Archive Item"}
                          >
                            {isArchived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDeleteItem(p.id, p.name)}
                            className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-500/10 rounded-lg touch-btn"
                            title="Delete Item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Item Add / Edit Modal */}
      {isItemModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-mono">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <button
              onClick={() => setIsItemModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Package className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">
                {editingItem ? 'Edit Inventory Item' : 'Add New Inventory Item'}
              </h3>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Item Name *</label>
                  <input
                    type="text"
                    required
                    value={itemFormData.name || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, name: e.target.value })}
                    placeholder="e.g. Flour 10kg Bag"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Category *</label>
                  <input
                    type="text"
                    required
                    value={itemFormData.category || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, category: e.target.value })}
                    placeholder="e.g. Raw Ingredients / Spatlo / Beverages"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Current Stock *</label>
                  <input
                    type="number"
                    required
                    value={itemFormData.stock ?? 0}
                    onChange={(e) => setItemFormData({ ...itemFormData, stock: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Min Quantity (Alert)</label>
                  <input
                    type="number"
                    value={itemFormData.minQuantity ?? 10}
                    onChange={(e) => setItemFormData({ ...itemFormData, minQuantity: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Reorder Quantity</label>
                  <input
                    type="number"
                    value={itemFormData.reorderQuantity ?? 30}
                    onChange={(e) => setItemFormData({ ...itemFormData, reorderQuantity: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Cost Price (R)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={itemFormData.costPrice ?? 0}
                    onChange={(e) => setItemFormData({ ...itemFormData, costPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Selling Price (R) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={itemFormData.price ?? 0}
                    onChange={(e) => setItemFormData({ ...itemFormData, price: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Unit of Measure *</label>
                  <select
                    value={itemFormData.unit || 'Each'}
                    onChange={(e) => setItemFormData({ ...itemFormData, unit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="Each">Each</option>
                    <option value="Kg">Kg</option>
                    <option value="Gram">Gram</option>
                    <option value="Litre">Litre</option>
                    <option value="Millilitre">Millilitre</option>
                    <option value="Pack">Pack</option>
                    <option value="Box">Box</option>
                    <option value="Tray">Tray</option>
                    <option value="Portion">Portion</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Supplier</label>
                  <select
                    value={itemFormData.supplier || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, supplier: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    {suppliers.map(s => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                    <option value="General Wholesalers">General Wholesalers</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Storage Location</label>
                  <input
                    type="text"
                    value={itemFormData.storageLocation || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, storageLocation: e.target.value })}
                    placeholder="Dry Store A1"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Barcode (Optional)</label>
                  <input
                    type="text"
                    value={itemFormData.barcode || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, barcode: e.target.value })}
                    placeholder="e.g. 600123456789"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Product group</label>
                  <select
                    value={itemFormData.domain || 'fastfood-domain'}
                    onChange={(e) => setItemFormData({ ...itemFormData, domain: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="fastfood-domain">🍔 Food & takeaway</option>
                    <option value="pharmacy-domain">💊 Pharmacy & health</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsItemModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> Save Inventory Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Restock Purchase Request Builder Modal */}
      {isRestockModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-mono">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <button
              onClick={() => setIsRestockModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Truck className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-base font-bold text-white">Purchase Request Workflow</h3>
                <p className="text-[11px] text-slate-400">Generate formatted restock request for Owner & Supplier</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-slate-400">Target Supplier</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                >
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>
                  ))}
                  <option value="general">Fresh Wholesalers & Grains (+27825550192)</option>
                </select>
              </div>

              {selectedRestockProduct ? (
                <div className="space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="flex justify-between font-bold text-white">
                    <span>{selectedRestockProduct.name}</span>
                    <span className="text-rose-400">Stock: {selectedRestockProduct.stock} {selectedRestockProduct.unit}</span>
                  </div>
                  <div className="pt-2 flex items-center justify-between">
                    <label className="text-slate-400">Quantity to Request:</label>
                    <input
                      type="number"
                      value={restockQty}
                      onChange={(e) => setRestockQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-emerald-400 font-bold text-right"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="font-bold text-amber-400 text-xs">Bulk Low-Stock Restock Mode</span>
                  <p className="text-slate-400 text-[11px]">
                    Includes all {lowStockCount} items currently below minimum threshold.
                  </p>
                </div>
              )}

              {/* Formatted Request Document Preview */}
              <div className="space-y-1">
                <label className="text-slate-400">Document Preview</label>
                <textarea
                  readOnly
                  rows={9}
                  value={buildRestockRequestText()}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 font-mono text-[11px] leading-relaxed focus:outline-none"
                />
              </div>

              {/* Dispatch Action Buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleSendWhatsAppRestock}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1 text-[11px] touch-btn shadow-md col-span-2 sm:col-span-1"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
                </button>
                <button
                  type="button"
                  onClick={handleCopyRestockText}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1 text-[11px] touch-btn"
                >
                  {copiedText ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedText ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadRestockText}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1 text-[11px] touch-btn"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button
                  type="button"
                  onClick={handleSaveRestockRequestRecord}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1 text-[11px] touch-btn shadow-md"
                >
                  Submit PO
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Waste Recording Modal */}
      {isWasteModalOpen && selectedWasteProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-mono text-xs">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl relative space-y-4">
            <button
              onClick={() => setIsWasteModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <TrendingDown className="w-5 h-5 text-rose-400" />
              <h3 className="text-base font-bold text-white">Record Waste — {selectedWasteProduct.name}</h3>
            </div>

            <form onSubmit={handleExecuteWaste} className="space-y-3">
              <div className="space-y-1">
                <label className="text-slate-400">Waste Quantity ({selectedWasteProduct.unit})</label>
                <input
                  type="number"
                  min="1"
                  max={selectedWasteProduct.stock}
                  value={wasteQty}
                  onChange={(e) => setWasteQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Reason</label>
                <select
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="EXPIRED">EXPIRED / SPOILED</option>
                  <option value="DAMAGED">DAMAGED PACKAGING</option>
                  <option value="THEFT_SHRINKAGE">SHRINKAGE / UNACCOUNTED</option>
                  <option value="PREP_WASTE">KITCHEN PREP WASTE</option>
                </select>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsWasteModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-1.5"
                >
                  <TrendingDown className="w-4 h-4" /> Record Waste
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
