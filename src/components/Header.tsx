import React from 'react';
import { 
  DomainType, 
  UserRole, 
  ShiftInfo, 
  NotificationItem 
} from '../types';
import { 
  Utensils, 
  Pill, 
  Wifi, 
  WifiOff, 
  Bell, 
  ShieldCheck, 
  User, 
  LogOut, 
  Activity, 
  Layers, 
  FileSpreadsheet, 
  ShoppingBag,
  Store,
  RefreshCw
} from 'lucide-react';

interface HeaderProps {
  currentDomain: DomainType;
  onDomainChange: (domain: DomainType) => void;
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  activeTab: 'pos' | 'kds' | 'dashboard' | 'inspector';
  onTabChange: (tab: 'pos' | 'kds' | 'dashboard' | 'inspector') => void;
  isOnline: boolean;
  onToggleNetwork: () => void;
  outboxCount: number;
  onFlushOutbox: () => void;
  shiftInfo: ShiftInfo | null;
  onOpenShiftClose: () => void;
  notifications: NotificationItem[];
  onToggleNotifications: () => void;
  unreadCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentDomain,
  onDomainChange,
  currentRole,
  onRoleChange,
  activeTab,
  onTabChange,
  isOnline,
  onToggleNetwork,
  outboxCount,
  onFlushOutbox,
  shiftInfo,
  onOpenShiftClose,
  onToggleNotifications,
  unreadCount
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Logo & Operating System Identifier */}
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 text-slate-950 p-2 rounded-xl font-bold flex items-center justify-center shadow-md shadow-amber-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight text-amber-400">ThePlugOS</span>
                <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Kernel v1.0
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium truncate hidden sm:block">
                Internal Intelligence OS • {shiftInfo?.branchName || 'Branch not configured'}
              </p>
            </div>
          </div>

          {/* Center Domain & Operating Tab Switcher */}
          <div className="hidden md:flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => onTabChange('pos')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'pos'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              Cashier POS
            </button>

            <button
              onClick={() => onTabChange('kds')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'kds'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              {currentDomain === 'fastfood-domain' ? (
                <Utensils className="w-4 h-4" />
              ) : (
                <Pill className="w-4 h-4" />
              )}
              {currentDomain === 'fastfood-domain' ? 'Kitchen KDS' : 'Dispensing Station'}
            </button>

            <button
              onClick={() => onTabChange('dashboard')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Manager Intelligence
            </button>

            <button
              onClick={() => onTabChange('inspector')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'inspector'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Activity className="w-4 h-4" />
              Kernel Ledger
            </button>
          </div>

          {/* Right Status Controls & Role Selectors */}
          <div className="flex items-center gap-3">
            
            {/* Domain Switcher */}
            <div className="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-800">
              <button
                onClick={() => onDomainChange('fastfood-domain')}
                title="Switch to FastFood Domain"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  currentDomain === 'fastfood-domain'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Utensils className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">FastFood</span>
              </button>
              <button
                onClick={() => onDomainChange('pharmacy-domain')}
                title="Switch to Pharmacy Domain"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  currentDomain === 'pharmacy-domain'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Pill className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Pharmacy</span>
              </button>
            </div>

            {/* Role Dropdown */}
            <div className="relative">
              <select
                value={currentRole}
                onChange={(e) => onRoleChange(e.target.value as UserRole)}
                className="bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer font-medium"
              >
                <option value="CASHIER">Role: Cashier</option>
                <option value="KITCHEN_STAFF">Role: Kitchen / Staff</option>
                <option value="MANAGER">Role: Manager</option>
                <option value="SYSTEM_AUDITOR">Role: Auditor</option>
              </select>
            </div>

            {/* Offline / Online Network Toggle */}
            <button
              onClick={onToggleNetwork}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                isOnline
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20 animate-pulse'
              }`}
              title={isOnline ? 'Network Online - Real-time Sync Active' : 'Offline Mode - Queueing Events to Outbox'}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-rose-400" />}
              <span className="hidden sm:inline font-mono">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </button>

            {/* Outbox Badge & Sync Button */}
            {outboxCount > 0 && (
              <button
                onClick={onFlushOutbox}
                className="bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all"
                title="Pending Outbox Events to Sync"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span className="font-mono">{outboxCount} Outbox</span>
              </button>
            )}

            {/* Notification Bell */}
            <button
              onClick={onToggleNotifications}
              className="relative p-2 text-slate-400 hover:text-white bg-slate-950 rounded-lg border border-slate-800 transition-all"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Shift End / Close Button */}
            <button
              onClick={onOpenShiftClose}
              className="bg-slate-950 border border-slate-800 text-slate-300 hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-400 p-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
              title="Shift Reconciliation & Store Close"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* Mobile View Navigation Tab Bar */}
        <div className="flex md:hidden items-center justify-around py-2 border-t border-slate-800 text-xs">
          <button
            onClick={() => onTabChange('pos')}
            className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg ${
              activeTab === 'pos' ? 'text-amber-400 font-bold' : 'text-slate-400'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            POS
          </button>
          <button
            onClick={() => onTabChange('kds')}
            className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg ${
              activeTab === 'kds' ? 'text-amber-400 font-bold' : 'text-slate-400'
            }`}
          >
            {currentDomain === 'fastfood-domain' ? <Utensils className="w-4 h-4" /> : <Pill className="w-4 h-4" />}
            {currentDomain === 'fastfood-domain' ? 'KDS' : 'Dispense'}
          </button>
          <button
            onClick={() => onTabChange('dashboard')}
            className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg ${
              activeTab === 'dashboard' ? 'text-amber-400 font-bold' : 'text-slate-400'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => onTabChange('inspector')}
            className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg ${
              activeTab === 'inspector' ? 'text-amber-400 font-bold' : 'text-slate-400'
            }`}
          >
            <Activity className="w-4 h-4" />
            Ledger
          </button>
        </div>

      </div>
    </header>
  );
};
