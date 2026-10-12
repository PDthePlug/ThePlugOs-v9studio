import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleCheck, ShieldCheck, Store } from 'lucide-react';
import { hasNativeHubHost, localHubRuntime } from '@plugos/core';
import type { NativeHubOperatorContext } from '@plugos/core';
import type { Branch, StaffMember } from '../types';
import { OwnerPortalShell } from './OwnerPortalShell';

interface RoleLoginModalProps {
  staffList?: StaffMember[];
  branches?: Branch[];
  businessId?: string;
  branchId?: string;
  onSelectBranch?: (branchId: string) => void;
  onOpenNativeStation?: (role: NativeHubOperatorContext['role']) => void;
  onSignOut?: () => void;
}

const OperatorMark = () => (
  <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#151512] shadow-sm" aria-hidden="true">
    <Store className="h-7 w-7 text-[#f2aa25]" strokeWidth={2.2} />
  </span>
);

/**
 * Owner browsers and operational Android stations deliberately split here.
 * The browser receives the owner control plane. Staff PIN capture and role
 * routing remain native and enter React only after a verified operator context
 * exists on an enrolled Android host.
 *
 * OwnerPortalShell owns the sectioned control plane, including
 * NativeStaffCredentialResetControl inside Team & access. Keeping that control
 * out of this routing boundary prevents the entry component becoming the old
 * all-in-one owner page again.
 */
export const RoleLoginModal: React.FC<RoleLoginModalProps> = ({
  staffList = [],
  branches = [],
  businessId,
  branchId,
  onSelectBranch,
  onOpenNativeStation,
  onSignOut,
}) => {
  const nativeHost = hasNativeHubHost();
  // Keep inactive branches out of the owner control plane before any device
  // pairing or access control is rendered. OwnerPortalShell repeats this filter
  // defensively when it builds its branch selector.
  const ownerBranches = branches.filter((branch) => branch.isActive);
  const [message, setMessage] = useState<string | null>(null);
  const [openingSignIn, setOpeningSignIn] = useState(false);
  const awaitingNativeReturn = useRef(false);
  const routingNativeSession = useRef(false);

  const routeVerifiedNativeSession = useCallback(async (silent = false) => {
    if (!nativeHost || !onOpenNativeStation || routingNativeSession.current) return;
    routingNativeSession.current = true;
    try {
      const context = await localHubRuntime.getNativeOperatorContext();
      awaitingNativeReturn.current = false;
      setMessage(null);
      onOpenNativeStation(context.role);
    } catch {
      if (!silent && awaitingNativeReturn.current) {
        setMessage('Sign-in is not complete yet. Choose your name and enter your PIN on this device.');
      }
    } finally {
      routingNativeSession.current = false;
    }
  }, [nativeHost, onOpenNativeStation]);

  useEffect(() => {
    if (!nativeHost || !onOpenNativeStation) return undefined;

    const resume = () => {
      if (awaitingNativeReturn.current) void routeVerifiedNativeSession(true);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') resume();
    };

    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visibility);
    const poll = window.setInterval(() => {
      if (awaitingNativeReturn.current && document.visibilityState === 'visible') {
        void routeVerifiedNativeSession(true);
      }
    }, 700);
    void routeVerifiedNativeSession(true);

    return () => {
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visibility);
      window.clearInterval(poll);
    };
  }, [nativeHost, onOpenNativeStation, routeVerifiedNativeSession]);

  const openStaffSignIn = async () => {
    if (!nativeHost) return;
    setOpeningSignIn(true);
    setMessage(null);
    awaitingNativeReturn.current = true;
    try {
      await localHubRuntime.openNativeStaffSignIn();
      setMessage('Choose your name and enter your PIN. Your workspace will open automatically after sign-in.');
    } catch {
      awaitingNativeReturn.current = false;
      setMessage('Staff sign-in could not be opened on this device. Check that the device is enrolled and try again.');
    } finally {
      setOpeningSignIn(false);
    }
  };

  if (!nativeHost) {
    if (!businessId) {
      return (
        <main className="min-h-screen bg-[#f7f2e9] p-6 text-[#191914]">
          <section className="mx-auto max-w-xl rounded-3xl border border-[#ded5c5] bg-white p-6">
            <h1 className="text-xl font-black">Owner business unavailable</h1>
            <p className="mt-2 text-sm text-[#777166]">A verified owner business is required before the management workspace can open.</p>
            {onSignOut && <button type="button" onClick={onSignOut} className="mt-5 rounded-xl bg-[#171714] px-4 py-3 text-sm font-bold text-white">Sign out</button>}
          </section>
        </main>
      );
    }
    return (
      <OwnerPortalShell
        businessId={businessId}
        branches={ownerBranches}
        branchId={branchId}
        staffList={staffList}
        onSelectBranch={onSelectBranch}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f2e9] px-4 py-8 text-[#191914] sm:px-6 sm:py-12">
      <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-[2rem] border border-[#ded5c5] bg-[#fffdf8] shadow-[0_24px_80px_rgba(40,32,15,0.10)]">
        <div className="grid md:grid-cols-[0.9fr_1.1fr]">
          <aside className="border-b border-[#e4dccf] bg-[#f1eadc] p-7 md:border-b-0 md:border-r md:p-10">
            <div className="flex items-center gap-4">
              <OperatorMark />
              <div>
                <strong className="block text-xl font-black tracking-tight">ThePlugOS</strong>
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#777166]">Staff access</span>
              </div>
            </div>

            <div className="mt-12">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-[#b67608]">Start your shift</span>
              <h1 className="mt-3 text-4xl font-black leading-[1.04] tracking-[-0.04em] sm:text-5xl">Who’s working this station?</h1>
              <p className="mt-5 max-w-md text-sm leading-6 text-[#6f695e]">
                Sign in with your staff PIN. ThePlugOS will open only the tools assigned to your role.
              </p>
            </div>

            <div className="mt-10 space-y-3 text-sm">
              <div className="flex items-center gap-3 rounded-2xl border border-[#ded5c5] bg-white/60 p-4">
                <ShieldCheck className="h-5 w-5 text-[#b67608]" />
                <span><strong className="block">Private staff PIN</strong><small className="text-[#777166]">Your PIN stays on this enrolled device.</small></span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-[#ded5c5] bg-white/60 p-4">
                <CircleCheck className="h-5 w-5 text-emerald-700" />
                <span><strong className="block">Role-specific workspace</strong><small className="text-[#777166]">Cashier, Kitchen and Manager tools stay separate.</small></span>
              </div>
            </div>
          </aside>

          <div className="flex min-h-[470px] flex-col justify-center p-7 md:p-10">
            <span className="inline-flex w-fit rounded-full border border-[#eed29a] bg-[#fff3d6] px-3 py-1 text-xs font-bold text-[#8e5d08]">Enrolled shop device</span>
            <h2 className="mt-5 text-2xl font-black tracking-tight">Staff sign in</h2>
            <p className="mt-2 text-sm leading-6 text-[#777166]">Tap below, choose your name, then enter your PIN. Your correct workspace opens automatically.</p>

            <button
              type="button"
              onClick={() => void openStaffSignIn()}
              disabled={openingSignIn}
              className="mt-8 flex w-full items-center justify-between rounded-2xl bg-[#171714] px-5 py-4 text-left text-white shadow-lg transition hover:bg-black disabled:opacity-60"
            >
              <span>
                <small className="block text-[11px] font-bold uppercase tracking-[0.16em] text-[#d7d0c4]">Secure staff access</small>
                <strong className="mt-1 block text-base">{openingSignIn ? 'Opening sign in…' : 'Choose profile & enter PIN'}</strong>
              </span>
              <ArrowRight className="h-5 w-5 text-[#f2aa25]" />
            </button>

            {message && (
              <p className="mt-4 rounded-2xl border border-[#ded5c5] bg-[#f7f2e9] p-4 text-sm leading-6 text-[#625d53]" role="status" aria-live="polite">{message}</p>
            )}

            <button type="button" onClick={() => void routeVerifiedNativeSession(false)} className="mt-5 self-start text-xs font-bold text-[#8e5d08] underline decoration-[#d7b56d] underline-offset-4">
              Already signed in? Open my workspace
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};
