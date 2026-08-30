import React, { useState } from 'react';
import { SupplierRecord } from '../types';
import { 
  Truck, 
  Plus, 
  Edit3, 
  Trash2, 
  Search, 
  Phone, 
  MessageSquare, 
  Mail, 
  Calendar, 
  DollarSign, 
  CheckCircle2, 
  X, 
  AlertCircle,
  Building2
} from 'lucide-react';

interface SupplierManagementProps {
  suppliers: SupplierRecord[];
  onUpdateSuppliers: (suppliers: SupplierRecord[]) => void;
  kernel?: any;
  userId?: string;
}

export const SupplierManagement: React.FC<SupplierManagementProps> = ({
  suppliers,
  onUpdateSuppliers,
  kernel,
  userId
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<SupplierRecord>>({
    name: '',
    representative: '',
    phone: '',
    whatsapp: '',
    email: '',
    deliveryDays: 'Mon, Wed, Fri',
    minOrder: 500,
    paymentTerms: 'COD / 7 Days',
    status: 'ACTIVE',
    notes: ''
  });

  const [notification, setNotification] = useState<string | null>(null);

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.representative.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.phone.includes(searchTerm)
  );

  const handleOpenAdd = () => {
    setEditingSupplier(null);
    setFormData({
      name: '',
      representative: '',
      phone: '+27',
      whatsapp: '+27',
      email: '',
      deliveryDays: 'Mon, Wed, Fri',
      minOrder: 500,
      paymentTerms: 'COD / 7 Days',
      status: 'ACTIVE',
      notes: ''
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (supplier: SupplierRecord) => {
    setEditingSupplier(supplier);
    setFormData(supplier);
    setIsAddModalOpen(true);
  };

  const handleSaveSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) return;

    let updatedList: SupplierRecord[];
    if (editingSupplier) {
      updatedList = suppliers.map(s => s.id === editingSupplier.id ? { ...s, ...formData } as SupplierRecord : s);
      setNotification(`Supplier '${formData.name}' updated successfully.`);
      kernel?.events?.publish?.('SUPPLIER_UPDATED', {
        supplierId: editingSupplier.id,
        supplierName: formData.name,
        updatedBy: userId,
        timestamp: new Date().toISOString()
      });
    } else {
      const newSupplier: SupplierRecord = {
        id: `sup-${Date.now().toString().slice(-4)}`,
        name: formData.name || 'New Supplier',
        representative: formData.representative || 'N/A',
        phone: formData.phone || '',
        whatsapp: formData.whatsapp || formData.phone || '',
        email: formData.email || '',
        deliveryDays: formData.deliveryDays || 'Mon, Wed, Fri',
        minOrder: Number(formData.minOrder) || 0,
        paymentTerms: formData.paymentTerms || 'COD',
        status: (formData.status as 'ACTIVE' | 'INACTIVE') || 'ACTIVE',
        notes: formData.notes || ''
      };
      updatedList = [newSupplier, ...suppliers];
      setNotification(`Supplier '${newSupplier.name}' added to database.`);
      kernel?.events?.publish?.('SUPPLIER_CREATED', {
        supplierId: newSupplier.id,
        supplierName: newSupplier.name,
        createdBy: userId,
        timestamp: new Date().toISOString()
      });
    }

    onUpdateSuppliers(updatedList);
    setIsAddModalOpen(false);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleDeleteSupplier = (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete supplier '${name}'?`)) return;

    const updated = suppliers.filter(s => s.id !== id);
    onUpdateSuppliers(updated);
    setNotification(`Deleted supplier '${name}'`);
    kernel?.events?.publish?.('SUPPLIER_DELETED', {
      supplierId: id,
      supplierName: name,
      deletedBy: userId,
      timestamp: new Date().toISOString()
    });
    setTimeout(() => setNotification(null), 4000);
  };

  return (
    <div className="space-y-6">
      
      {/* Header controls & stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Inventory Supplier Directory</h2>
            <p className="text-xs text-slate-400 font-mono">
              {suppliers.length} Registered Wholesalers & Distributors
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAdd}
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 touch-btn"
        >
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      {notification && (
        <div className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 p-3 rounded-xl text-xs font-mono flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Search & Filter */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
        <input
          type="text"
          placeholder="Search suppliers by name, representative, or phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
        />
      </div>

      {/* Supplier Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSuppliers.map((supplier) => (
          <div 
            key={supplier.id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 hover:border-slate-700 transition-all flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
                  <h3 className="font-bold text-white text-sm line-clamp-1">{supplier.name}</h3>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                  supplier.status === 'ACTIVE'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                }`}>
                  {supplier.status}
                </span>
              </div>

              <div className="text-xs text-slate-300 space-y-1 font-mono pt-1">
                <p className="text-slate-400 flex items-center gap-1.5">
                  <span className="text-slate-500">Rep:</span> {supplier.representative}
                </p>
                <p className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{supplier.phone}</span>
                </p>
                {supplier.whatsapp && (
                  <p className="flex items-center gap-1.5 text-emerald-400">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                    <span>WhatsApp: {supplier.whatsapp}</span>
                  </p>
                )}
                {supplier.email && (
                  <p className="flex items-center gap-1.5 text-slate-400">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{supplier.email}</span>
                  </p>
                )}
              </div>

              <div className="border-t border-slate-800/80 pt-2 grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                <div>
                  <span className="block text-[10px] text-slate-500">Delivery Days</span>
                  <span className="text-slate-200 font-bold">{supplier.deliveryDays}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500">Min Order</span>
                  <span className="text-slate-200 font-bold">R{supplier.minOrder}</span>
                </div>
              </div>

              {supplier.notes && (
                <p className="text-[10px] text-slate-400 italic bg-slate-950 p-2 rounded-lg border border-slate-800/60 line-clamp-2">
                  "{supplier.notes}"
                </p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
              <a
                href={`https://wa.me/${supplier.whatsapp?.replace(/[^0-9]/g, '') || supplier.phone.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 text-xs px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 touch-btn"
              >
                <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
              </a>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleOpenEdit(supplier)}
                  className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg touch-btn"
                  title="Edit Supplier"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteSupplier(supplier.id, supplier.name)}
                  className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-500/10 rounded-lg touch-btn"
                  title="Delete Supplier"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsAddModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Building2 className="w-5 h-5 text-blue-400" />
              <h3 className="text-base font-bold text-white">
                {editingSupplier ? 'Edit Supplier Record' : 'Register New Inventory Supplier'}
              </h3>
            </div>

            <form onSubmit={handleSaveSupplier} className="space-y-4 font-mono text-xs">
              <div className="space-y-1">
                <label className="text-slate-400">Supplier Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Fresh Wholesalers & Grains"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Representative Contact</label>
                  <input
                    type="text"
                    value={formData.representative || ''}
                    onChange={(e) => setFormData({ ...formData, representative: e.target.value })}
                    placeholder="e.g. Sipho Khumalo"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Telephone *</label>
                  <input
                    type="text"
                    required
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+27821234567"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">WhatsApp Number</label>
                  <input
                    type="text"
                    value={formData.whatsapp || ''}
                    onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                    placeholder="+27821234567"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Email Address</label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="orders@supplier.co.za"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Delivery Days</label>
                  <input
                    type="text"
                    value={formData.deliveryDays || ''}
                    onChange={(e) => setFormData({ ...formData, deliveryDays: e.target.value })}
                    placeholder="Mon, Wed, Fri"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Min Order (R)</label>
                  <input
                    type="number"
                    value={formData.minOrder || 0}
                    onChange={(e) => setFormData({ ...formData, minOrder: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Payment Terms</label>
                  <input
                    type="text"
                    value={formData.paymentTerms || ''}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    placeholder="COD / Net 30"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Supplier Notes</label>
                <textarea
                  rows={2}
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Key products supplied, special discount terms..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
