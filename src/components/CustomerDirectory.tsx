import React, { useState } from 'react';
import { CustomerRecord } from '../types';
import { 
  Users, 
  Search, 
  Phone, 
  ShoppingBag, 
  DollarSign, 
  Calendar, 
  Star, 
  TrendingUp, 
  Award,
  Plus,
  X,
  CheckCircle2,
  Heart
} from 'lucide-react';

interface CustomerDirectoryProps {
  customers: CustomerRecord[];
  onUpdateCustomers?: (customers: CustomerRecord[]) => void;
  kernel?: any;
}

export const CustomerDirectory: React.FC<CustomerDirectoryProps> = ({
  customers,
  onUpdateCustomers,
  kernel
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'VIP' | 'RETURNING' | 'NEW'>('ALL');
  
  // New Customer Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('+27');
  const [newName, setNewName] = useState('');

  const filteredCustomers = customers.filter(c => {
    if (filterType === 'VIP' && c.lifetimeSpend < 1000 && c.visits < 10) return false;
    if (filterType === 'RETURNING' && c.visits < 3) return false;
    if (filterType === 'NEW' && c.visits > 2) return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        c.phone.includes(q) ||
        (c.name && c.name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const totalCustomers = customers.length;
  const totalLifetimeRevenue = customers.reduce((sum, c) => sum + (c.lifetimeSpend || 0), 0);
  const avgCLV = totalCustomers > 0 ? totalLifetimeRevenue / totalCustomers : 0;
  const vipCount = customers.filter(c => c.lifetimeSpend >= 1000 || c.visits >= 10).length;

  const handleAddCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone || newPhone.trim() === '+27') return;

    const newCustomerRecord: CustomerRecord = {
      id: `cust-${Date.now().toString().slice(-4)}`,
      phone: newPhone.trim(),
      name: newName.trim() || 'Walk-in Customer',
      visits: 1,
      lifetimeSpend: 0,
      avgBasket: 0,
      lastVisit: new Date().toISOString().split('T')[0],
      favouriteProducts: [],
      createdAt: new Date().toISOString().split('T')[0]
    };

    const updated = [newCustomerRecord, ...customers];
    onUpdateCustomers?.(updated);

    kernel?.events?.publish?.('CUSTOMER_CREATED', {
      customerId: newCustomerRecord.id,
      phone: newCustomerRecord.phone,
      name: newCustomerRecord.name,
      timestamp: new Date().toISOString()
    });

    setIsAddModalOpen(false);
    setNewPhone('+27');
    setNewName('');
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Total CRM Customers</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-black text-white font-mono">{totalCustomers}</p>
          <p className="text-[10px] text-emerald-400 font-mono">Captured via Cashier POS</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Total CRM Lifetime Revenue</span>
            <DollarSign className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-2xl font-black text-white font-mono">R{totalLifetimeRevenue.toFixed(2)}</p>
          <p className="text-[10px] text-purple-400 font-mono">Tracked customer purchases</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Avg Customer Value (CLV)</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-2xl font-black text-white font-mono">R{avgCLV.toFixed(2)}</p>
          <p className="text-[10px] text-blue-400 font-mono">Per active phone profile</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>VIP Customers</span>
            <Award className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-black text-amber-400 font-mono">{vipCount}</p>
          <p className="text-[10px] text-amber-400/80 font-mono">High-spend township loyalists</p>
        </div>
      </div>

      {/* Control Bar: Search, Filters & Add */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search by phone or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar w-full sm:w-auto">
          {(['ALL', 'VIP', 'RETURNING', 'NEW'] as const).map((ft) => (
            <button
              key={ft}
              onClick={() => setFilterType(ft)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold font-mono transition-all whitespace-nowrap touch-btn ${
                filterType === ft
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              {ft === 'ALL' ? 'All Profiles' : ft}
            </button>
          ))}

          {onUpdateCustomers && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl transition-all shadow-md flex items-center gap-1.5 whitespace-nowrap touch-btn ml-auto"
            >
              <Plus className="w-4 h-4" /> Add Profile
            </button>
          )}
        </div>

      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 font-mono">
        {filteredCustomers.length === 0 ? (
          <div className="col-span-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 space-y-2">
            <Users className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-sm">No customer records found.</p>
          </div>
        ) : (
          filteredCustomers.map((cust) => {
            const isVip = cust.lifetimeSpend >= 1000 || cust.visits >= 10;

            return (
              <div
                key={cust.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 hover:border-slate-700 transition-all flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-white text-sm">{cust.name || 'Customer'}</h3>
                        {isVip && (
                          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] px-1.5 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> VIP
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-emerald-400 flex items-center gap-1 pt-0.5">
                        <Phone className="w-3 h-3" /> {cust.phone}
                      </p>
                    </div>

                    <a
                      href={`https://wa.me/${cust.phone.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 px-2 py-1 rounded-lg font-bold hover:bg-emerald-600/30 touch-btn"
                    >
                      WhatsApp
                    </a>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-1 text-center bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Visits</span>
                      <span className="text-xs font-bold text-white">{cust.visits}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Lifetime Spend</span>
                      <span className="text-xs font-bold text-emerald-400">R{cust.lifetimeSpend.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Avg Basket</span>
                      <span className="text-xs font-bold text-purple-300">R{cust.avgBasket.toFixed(2)}</span>
                    </div>
                  </div>

                  {cust.favouriteProducts && cust.favouriteProducts.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Heart className="w-3 h-3 text-rose-400" /> Favorite Products:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {cust.favouriteProducts.map((fav, i) => (
                          <span key={i} className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700">
                            {fav}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500">
                  <span>Last Visit: {cust.lastVisit}</span>
                  <span>Registered: {cust.createdAt}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-mono">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-2xl p-6 shadow-2xl relative space-y-4">
            <button
              onClick={() => setIsAddModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Users className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">Create Customer Profile</h3>
            </div>

            <form onSubmit={handleAddCustomer} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400">Customer Phone Number *</label>
                <input
                  type="text"
                  required
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+27821234567"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Customer Name (Optional)</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Mama Zanele"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
