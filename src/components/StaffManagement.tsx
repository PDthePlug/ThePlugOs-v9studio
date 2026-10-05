import React, { useMemo, useState } from 'react';
import type { Branch, StaffMember } from '../types';
import { AlertTriangle, Building2, LockKeyhole, Search, ShieldCheck, Users } from 'lucide-react';

interface StaffManagementProps {
  staffList: StaffMember[];
  /** Retained for the future native command-backed administration screen. */
  onUpdateStaff: (updated: StaffMember[]) => void;
  kernel: any;
  branches?: Branch[];
  businessId?: string;
}

/**
 * A directory is safe to display from the owner-authorized cloud foundation;
 * staff creation, suspension, transfer, and PIN reset are not. The former
 * component mixed browser Auth sign-up, direct R001 writes, and plaintext PIN
 * display, so this replacement is intentionally read-only until those actions
 * are implemented as authenticated native Hub commands.
 */
export const StaffManagement: React.FC<StaffManagementProps> = ({ staffList, branches = [] }) => {
  const [query, setQuery] = useState('');
  const visibleStaff = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? staffList.filter((staff) => staff.name.toLowerCase().includes(normalized)) : staffList;
  }, [query, staffList]);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5 text-slate-100" aria-labelledby="staff-directory-title">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-xl"><Users className="w-5 h-5" /></div>
          <div>
            <h2 id="staff-directory-title" className="text-base font-bold text-white">Staff directory</h2>
            <p className="text-xs text-slate-400">Owner-authorized cloud read · no browser staff authority</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-400">
          <LockKeyhole className="w-4 h-4" /> Native administration pending
        </span>
      </header>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3 text-xs leading-relaxed text-amber-100" role="status">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <span>Adding staff, changing a role or branch, suspending access, and resetting a PIN require a staged cloud authority plus an authenticated native Hub command. This page will not create an Auth account, reveal a PIN, or update a local-only list.</span>
      </div>

      <label className="relative block">
        <span className="sr-only">Search staff directory</span>
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visible staff" className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500" />
      </label>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
            <tr><th className="p-3">Staff member</th><th className="p-3">Role</th><th className="p-3">Branch</th><th className="p-3">Availability</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {visibleStaff.map((staff) => {
              const branch = branches.find((item) => item.id === staff.branchId);
              return (
                <tr key={staff.id}>
                  <td className="p-3"><strong className="text-white">{staff.name}</strong><small className="mt-1 block font-mono text-[11px] text-slate-500">{staff.id}</small></td>
                  <td className="p-3"><span className="rounded-full border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-200">{staff.role}</span></td>
                  <td className="p-3 text-slate-300"><span className="inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-slate-500" />{branch?.name || 'Unresolved branch'}</span></td>
                  <td className="p-3 text-slate-400">{staff.activeShift ? 'Reported active from cloud' : 'No active shift reported'}</td>
                </tr>
              );
            })}
            {visibleStaff.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-sm text-slate-500">No staff directory records match this search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="w-4 h-4 text-emerald-400" /> PINs and credential hashes are deliberately not included in this response.</p>
    </section>
  );
};
