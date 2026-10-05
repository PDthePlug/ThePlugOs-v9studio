import React, { useState } from 'react';
import { ProductItem, DomainType } from '../types';
import { sdk } from '@plugos/sdk';
import { 
  UtensilsCrossed, 
  Plus, 
  Edit, 
  Trash2, 
  CheckCircle2, 
  Search, 
  DollarSign, 
  Tag, 
  Package, 
  Eye, 
  EyeOff, 
  Sparkles,
  X
} from 'lucide-react';

interface MenuManagementProps {
  products: ProductItem[];
  onUpdateProducts: (updated: ProductItem[]) => void;
  kernel: any;
  domain?: DomainType;
  branchId?: string;
}

export const MenuManagement: React.FC<MenuManagementProps> = ({
  products,
  onUpdateProducts,
  kernel,
  domain = 'fastfood-domain',
  branchId
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [itemDomain, setItemDomain] = useState<DomainType>('fastfood-domain');
  const [category, setCategory] = useState('Spatlo / Kotas');
  const [price, setPrice] = useState<number>(35.00);
  const [description, setDescription] = useState('');
  const [stock, setStock] = useState<number>(50);
  const [unit, setUnit] = useState('servings');

  // Derive unique categories
  const categories = Array.from(new Set(products.map(p => p.category)));

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = selectedCategory === 'ALL' || p.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setName('');
    setItemDomain(domain || 'fastfood-domain');
    setCategory(categories[0] || 'Spatlo / Kotas');
    setPrice(35.00);
    setDescription('');
    setStock(50);
    setUnit('servings');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (p: ProductItem) => {
    setEditingProduct(p);
    setName(p.name);
    setItemDomain(p.domain || 'fastfood-domain');
    setCategory(p.category);
    setPrice(p.price);
    setDescription(p.description);
    setStock(p.stock);
    setUnit(p.unit);
    setIsModalOpen(true);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || price <= 0) {
      alert('Please provide a valid product name and positive price.');
      return;
    }

    if (editingProduct) {
      const priceChanged = editingProduct.price !== price;
      const updatedItem = {
        ...editingProduct,
        name,
        domain: itemDomain,
        category,
        price,
        description,
        stock,
        unit
      };
      
      const updated = products.map(p => p.id === editingProduct.id ? updatedItem : p);
      onUpdateProducts(updated);

      sdk.events.publish('MENU_ITEM_UPDATED', {
        itemId: updatedItem.id,
        name: updatedItem.name,
        branchId: branchId || '',
        priceChanged
      });

      if (priceChanged) {
        kernel?.events?.publish?.('PRICE_CHANGED', {
          productId: editingProduct.id,
          oldPrice: editingProduct.price,
          newPrice: price,
          timestamp: new Date().toISOString()
        });
      }

      kernel?.events?.publish?.('MENU_ITEM_UPDATED', {
        productId: editingProduct.id,
        name,
        price,
        category,
        timestamp: new Date().toISOString()
      });

      setNotification(`Updated product "${name}" (R${price.toFixed(2)})`);
    } else {
      const newProduct: ProductItem = {
        id: `prod-${Date.now()}`,
        name,
        category,
        price,
        domain: itemDomain,
        description,
        stock,
        unit
      };
      onUpdateProducts([...products, newProduct]);

      kernel?.events?.publish?.('MENU_ITEM_ADDED', {
        productId: newProduct.id,
        name,
        price,
        category,
        timestamp: new Date().toISOString()
      });

      setNotification(`Added new product "${name}" to menu!`);
    }

    setIsModalOpen(false);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleDeleteProduct = (p: ProductItem) => {
    if (confirm(`Are you sure you want to delete "${p.name}" from the menu?`)) {
      const updated = products.filter(item => item.id !== p.id);
      onUpdateProducts(updated);

      kernel?.events?.publish?.('MENU_ITEM_DELETED', {
        productId: p.id,
        name: p.name,
        timestamp: new Date().toISOString()
      });

      setNotification(`Deleted "${p.name}" from the menu`);
      setTimeout(() => setNotification(null), 3500);
    }
  };

  const handleToggleStock = (p: ProductItem) => {
    const newStock = p.stock > 0 ? 0 : 50;
    const updated = products.map(item => item.id === p.id ? { ...item, stock: newStock } : item);
    onUpdateProducts(updated);

    kernel?.events?.publish?.('MENU_ITEM_AVAILABILITY_TOGGLED', {
      productId: p.id,
      name: p.name,
      isAvailable: newStock > 0,
      timestamp: new Date().toISOString()
    });

    setNotification(`Marked "${p.name}" as ${newStock > 0 ? 'In Stock' : 'Out of Stock'}`);
    setTimeout(() => setNotification(null), 3500);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5 text-slate-100">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-xl">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Menu & Catalog Management ({products.length})
            </h2>
            <p className="text-xs text-slate-400">
              Create menu items, adjust prices, manage categories & kitchen routing
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAdd}
          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-lg"
        >
          <Plus className="w-4 h-4" /> Add Menu Item
        </button>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-xl flex items-center gap-2 text-xs font-semibold animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          {notification}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search menu items..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className="w-full sm:w-auto bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
        >
          <option value="ALL">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredProducts.map(p => {
          const isOutOfStock = p.stock <= 0;

          return (
            <div
              key={p.id}
              className={`p-4 bg-slate-950 border rounded-xl flex flex-col justify-between space-y-3 transition ${
                isOutOfStock ? 'border-red-500/30 opacity-75' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                    {p.category}
                  </span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">
                    R {p.price.toFixed(2)}
                  </span>
                </div>

                <h3 className="text-xs font-bold text-white">{p.name}</h3>
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {p.description || 'No description provided.'}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Package className="w-3.5 h-3.5 text-slate-500" />
                  <span className={isOutOfStock ? 'text-red-400 font-bold' : 'text-slate-300'}>
                    {isOutOfStock ? 'OUT OF STOCK' : `${p.stock} ${p.unit}`}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleStock(p)}
                    title={isOutOfStock ? "Mark In Stock" : "Mark Out of Stock"}
                    className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg transition"
                  >
                    {isOutOfStock ? <Eye className="w-3.5 h-3.5 text-emerald-400" /> : <EyeOff className="w-3.5 h-3.5 text-amber-400" />}
                  </button>

                  <button
                    onClick={() => handleOpenEdit(p)}
                    title="Edit Item"
                    className="p-1.5 bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-800 rounded-lg transition"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDeleteProduct(p)}
                    title="Delete Item"
                    className="p-1.5 bg-slate-900 hover:bg-slate-800 text-red-400 border border-slate-800 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Add / Edit */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 p-4 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UtensilsCrossed className="w-4 h-4 text-emerald-500" />
                {editingProduct ? 'Edit Menu Item' : 'Add New Menu Item'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Russian & Chips Combo or Airtime Voucher"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Product group</label>
                <select
                  value={itemDomain}
                  onChange={e => setItemDomain(e.target.value as DomainType)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500 font-semibold"
                >
                  <option value="fastfood-domain">🍔 Fast Food</option>
                  <option value="store-items">🛒 Store Items</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Category</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Spatlo / Kotas"
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Selling Price (ZAR)</label>
                  <input
                    type="number"
                    step="0.50"
                    required
                    value={price}
                    onChange={e => setPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Ingredients, preparation description..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Current Stock Qty</label>
                  <input
                    type="number"
                    value={stock}
                    onChange={e => setStock(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Unit</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-lg"
                >
                  {editingProduct ? 'Save Changes' : 'Add to Menu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
