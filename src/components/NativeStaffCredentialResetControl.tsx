import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, ShieldAlert, Smartphone, Trash2 } from 'lucide-react';
import { localHubRuntime } from '@plugos/core';
import type { StaffMember } from '../types';
import { supabase } from '../lib/supabase';

interface NativeStaffCredentialResetControlProps {
  businessId: string;
  branchId: string;
  staff: StaffMember[];
  compact?: boolean;
}

interface CredentialResetCodeResponse {
  ok?: unknown;
  resetCode?: unknown;
  expiresAt?: unknown;
}

/**
 * Owner browser control for a native credential reset. It deliberately
 * selects only a cloud-directory staff record and obtains a one-time code;
 * neither a current nor replacement PIN exists in React state or a request.
 */
export const NativeStaffCredentialResetControl: React.FC<NativeStaffCredentialResetControlProps> = ({
  businessId,
  branchId,
  staff,
  compact = false,
}) => {
  const eligibleStaff = useMemo(
    () => staff.filter((member) => member.branchId === branchId && (member.status === undefined || member.status === 'ACTIVE')),
    [branchId, staff],
  );
  const [staffId, setStaffId] = useState('');
  const [resetCode, setResetCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [openingNative, setOpeningNative] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const next = eligibleStaff.some((member) => member.id === staffId) ? staffId : (eligibleStaff[0]?.id || '');
    setStaffId(next);
    setResetCode(null);
    setExpiresAt(null);
    setMessage(null);
  }, [branchId, eligibleStaff, staffId]);

  useEffect(() => {
    if (!resetCode || !expiresAt) return undefined;
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      setResetCode(null);
      setExpiresAt(null);
      setMessage('The recovery code expired and was removed from this browser screen. Issue a new code if required.');
    }, delay + 50);
    return () => window.clearTimeout(timer);
  }, [expiresAt, resetCode]);

  const issueCode = async () => {
    if (!staffId) return;
    setIssuing(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('hub-owner-enrollment', {
        body: {
          action: 'issue-staff-credential-reset-code',
          businessId,
          branchId,
          staffId,
        },
      });
      if (error) throw error;
      const result = data as CredentialResetCodeResponse | null;
      if (!result || result.ok !== true
        || typeof result.resetCode !== 'string'
        || !/^[A-Za-z0-9_-]{12}$/.test(result.resetCode)
        || typeof result.expiresAt !== 'string'
        || Number.isNaN(Date.parse(result.expiresAt))) {
        throw new Error('The credential-recovery receiver returned an invalid result.');
      }
      setResetCode(result.resetCode);
      setExpiresAt(result.expiresAt);
      setMessage('Enter this one-time recovery code directly on the enrolled Android Cashier Hub. The Hub will collect and confirm the new PIN natively.');
    } catch {
      setResetCode(null);
      setExpiresAt(null);
      setMessage('A recovery code could not be issued. An active enrolled Hub, owner session, and deployed cloud recovery service are required.');
    } finally {
      setIssuing(false);
    }
  };

  const openNativeReset = async () => {
    setOpeningNative(true);
    setMessage(null);
    try {
      await localHubRuntime.openNativeStaffCredentialReset();
      setMessage('Native credential reset opened. Enter the owner recovery code and new PIN only on the Android screen.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The native credential-reset screen could not be opened.');
    } finally {
      setOpeningNative(false);
    }
  };

  const selectedStaff = eligibleStaff.find((member) => member.id === staffId);
  const sectionClass = 'rounded-2xl border border-slate-800 bg-slate-950 ' + (compact ? 'p-4' : 'p-5') + ' space-y-4';

  return (
    <section className={sectionClass} aria-labelledby="credential-reset-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-2 text-violet-200"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h3 id="credential-reset-title" className="text-sm font-bold text-slate-100">Native staff credential reset</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Owner authorization is issued here; the recovery code and replacement PIN are entered only on the enrolled Android Cashier Hub.</p>
        </div>
      </div>

      {eligibleStaff.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">No active staff records are available for this branch. No credential action can be issued.</p>
      ) : (
        <label className="grid gap-1 text-xs font-semibold text-slate-300">
          Staff member to recover
          <select value={staffId} onChange={(event) => setStaffId(event.target.value)} disabled={issuing || openingNative} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-normal text-slate-100 outline-none focus:border-violet-300 disabled:opacity-60">
            {eligibleStaff.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role.replace('_', ' ')}</option>)}
          </select>
        </label>
      )}

      {resetCode && expiresAt && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" aria-live="polite">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">One-time native recovery code</span>
          <strong className="mt-1 block font-mono text-2xl tracking-[0.2em] text-amber-100">{resetCode}</strong>
          <small className="mt-2 block text-xs text-amber-100/80">For {selectedStaff?.name || 'the selected staff member'} · expires {new Date(expiresAt).toLocaleTimeString()} on this device. Do not save or forward it.</small>
        </div>
      )}

      {message && <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs leading-relaxed text-slate-300" role="status">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void issueCode()} disabled={!staffId || issuing || openingNative} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-white disabled:opacity-60">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {issuing ? 'Issuing recovery code…' : resetCode ? 'Issue replacement code' : 'Issue native recovery code'}
        </button>
        <button type="button" onClick={() => void openNativeReset()} disabled={openingNative || issuing} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-slate-800 disabled:opacity-60">
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          {openingNative ? 'Opening native reset…' : 'Open native reset'}
        </button>
        {resetCode && <button type="button" onClick={() => { setResetCode(null); setExpiresAt(null); setMessage('The recovery code was removed from this browser screen.'); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Discard code
        </button>}
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-500">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        The browser never receives a PIN, verifier, device proof, staff session, or recovery completion secret. A successful reset revokes branch staff sessions and requires Hub authority reconciliation.
      </p>
    </section>
  );
};
