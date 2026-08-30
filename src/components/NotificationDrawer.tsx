import React from 'react';
import { NotificationItem } from '../types';
import { 
  Bell, 
  X, 
  Check, 
  AlertTriangle, 
  Info, 
  CheckCircle2, 
  XCircle 
} from 'lucide-react';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onMarkAsRead: (id: string) => void;
  onClearAll: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAsRead,
  onClearAll
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
      
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-400" />
          <h3 className="font-bold text-white text-base">Kernel Alerts & Logs</h3>
        </div>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && (
            <button
              onClick={onClearAll}
              className="text-xs text-slate-400 hover:text-white"
            >
              Clear All
            </button>
          )}
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {notifications.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-12">
            <Bell className="w-10 h-10 stroke-1 mb-2 text-slate-600" />
            <p className="text-xs font-semibold">No active notifications</p>
          </div>
        ) : (
          notifications.map(item => (
            <div
              key={item.id}
              className={`p-3.5 rounded-xl border text-xs space-y-1 transition-all ${
                item.read ? 'bg-slate-950/60 border-slate-800/80 text-slate-400' : 'bg-slate-950 border-amber-500/40 text-slate-200 shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-bold text-white block">{item.title}</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-slate-300">{item.message}</p>

              {!item.read && (
                <button
                  onClick={() => onMarkAsRead(item.id)}
                  className="mt-2 text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <Check className="w-3 h-3" /> Mark as Read
                </button>
              )}
            </div>
          ))
        )}
      </div>

    </div>
  );
};
