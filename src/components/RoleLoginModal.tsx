import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CircleCheck,
  LogOut,
  Package,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
  WalletCards,
} from 'lucide-react';
import { hasNativeHubHost, localHubRuntime } from '@plugos/core';
import type { NativeHubOperatorContext } from '@plugos/core';
import { Branch, StaffMember } from '../types';
import { supabase } from '../lib/supabase';
import { NativeHubEnrollmentControl } from './NativeHubEnrollmentControl';
import { NativeStaffCredentialResetControl } from './NativeStaffCredentialResetControl';

interface RoleLoginModalProps {
  staffList?: StaffMember[];
  branches?: Branch[];
  businessId?: string;
  branchId?: string;
  onSelectBranch?: (branchId: string) => void;
  onOpenNativeStation?: (role: NativeHubOperatorContext['role']) => void;
  onSignOut?: () => void;
}

interface OwnerOverview {
  salesToday: number;
  ordersToday: number;
  activeDevices: number;
  activeProducts: number;
  lowStockProducts: number;
}

const EMPTY_OVERVIEW: OwnerOverview = {
  salesToday: 0,
  ordersToday: 0,
  activeDevices: 0,
  activeProducts: 0,
  lowStockProducts: 0,
};

const OperatorMark = () => (
  <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#151512] shadow-sm" aria-hidden="true">
    <Store className="h-7 w-7 text-[#f2aa25]" strokeWidth={2.2} />
  </span>
);

const roleLabel = (role: StaffMember['role']) => {
  switch (role) {
    case 'KITCHEN_STAFF': return 'Kitchen';
    case 'MANAGER': return 'Manager';
    case 'CASHIER': return 'Cashier';
    case 'OWNER': return 'Owner';
    case 'ADMINISTRATOR': return 'Administrator';
    default: return role;
  }
};

/**
 * Merchant-facing entry surface.
 *
 * Staff PINs never enter React. On an enrolled Android host, React can only ask
 * the native sign-in screen to open and later read a role-minimized operator
 * context. That verified native role is the only input used to route a staff
 * member into an operational workspace.
 *
 * In a normal owner browser this component is a read-only command centre. It
 * may read owner-authorized business projections and request bounded device or
 * credential-recovery actions, but it never becomes a staff station.
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
  const activeBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches]);
  const activeBranch = activeBranches.find((branch) => branch.id === branchId) || activeBranches[0];
  const branchName = activeBranch?.name || 'Branch';

  const [message, setMessage] = useState<string | null>(null);
  const [openingSignIn, setOpeningSignIn] = useState(false);
  const [ownerOverview, setOwnerOverview] = useState<OwnerOverview>(EMPTY_OVERVIEW);
  const [ownerOverviewLoading, setOwnerOverviewLoading] = useState(false);
  const [ownerOverviewWarning, setOwnerOverviewWarning] = useState<string | null>(null);
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

    // A valid native session may already exist after an app resume. If so,
    // route immediately without requiring another PIN prompt.
    void routeVerifiedNativeSession(true);

    return () => {
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visibility);
      window.clearInterval(poll);
    };
  }, [nativeHost, onOpenNativeStation, routeVerifiedNativeSession]);

  const loadOwnerOverview = useCallback(async () => {
    if (nativeHost || !businessId) return;
    setOwnerOverviewLoading(true);
    setOwnerOverviewWarning(null);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const todayIso = start.toISOString();

      const [ordersResult, productsResult, devicesResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id, total_amount, status')
          .eq('business_id', businessId)
          .gte('created_at', todayIso),
        supabase
          .from('catalog_products')
          .select('id, stock_quantity, status')
          .eq('business_id', businessId),
        supabase
          .from('devices')
          .select('id, status')
          .eq('business_id', businessId),
      ]);

      if (ordersResult.error || productsResult.error || devicesResult.error) {
        throw new Error('Owner overview could not be refreshed.');
      }

      const liveOrders = (ordersResult.data || []).filter((order) => order.status !== 'CANCELLED');
      const products = productsResult.data || [];
      const devices = devicesResult.data || [];
      setOwnerOverview({
        salesToday: liveOrders.reduce((total, order) => total + Number(order.total_amount || 0), 0),
        ordersToday: liveOrders.length,
        activeDevices: devices.filter((device) => device.status === 'ACTIVE').length,
        activeProducts: products.filter((product) => product.status === 'ACTIVE').length,
        lowStockProducts: products.filter((product) => product.status === 'ACTIVE' && Number(product.stock_quantity || 0) < 10).length,
      });
    } catch {
      setOwnerOverviewWarning('Live business figures are temporarily unavailable. Staff and access controls remain available.');
    } finally {
      setOwnerOverviewLoading(false);
    }
  }, [businessId, nativeHost]);

  useEffect(() => {
    if (nativeHost || !businessId) return;
    void loadOwnerOverview();
  }, [businessId, nativeHost, loadOwnerOverview]);

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

  if (nativeHost) {
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
                  <span><strong className="block">Role-specific workspace</strong><small className="text-[#777166]">Cashier, kitchen and manager tools stay separate.</small></span>
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
  }

  const activeStaff = staffList.filter((staff) => staff.status === undefined || staff.status === 'ACTIVE');
  const cashiers = activeStaff.filter((staff) => staff.role === 'CASHIER').length;
  const kitchen = activeStaff.filter((staff) => staff.role === 'KITCHEN_STAFF').length;
  const managers = activeStaff.filter((staff) => staff.role === 'MANAGER').length;
  const controlBranchId = activeBranch?.id || branchId || '';

  return (
    <main className="min-h-screen bg-[#f7f2e9] px-4 py-6 text-[#191914] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-5 rounded-[2rem] border border-[#ded5c5] bg-[#fffdf8] p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="flex items-center gap-4">
            <OperatorMark />
            <div>
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#8e5d08]">Owner dashboard</span>
              <h1 className="mt-1 text-3xl font-black tracking-[-0.04em]">Business heartbeat</h1>
              <p className="mt-1 text-sm text-[#777166]">{branchName} · live owner view</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void loadOwnerOverview()} disabled={ownerOverviewLoading} className="inline-flex items-center gap-2 rounded-xl border border-[#d8cfbf] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#faf6ee] disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${ownerOverviewLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {onSignOut && (
              <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 rounded-xl bg-[#171714] px-4 py-2.5 text-sm font-bold text-white hover:bg-black">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            )}
          </div>
        </header>

        {activeBranches.length > 1 && onSelectBranch && (
          <section className="rounded-2xl border border-[#ded5c5] bg-[#fffdf8] p-4 sm:p-5">
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-[#777166]">
              Branch to manage
              <select
                value={activeBranch?.id || branchId}
                onChange={(event) => onSelectBranch(event.target.value)}
                className="rounded-xl border border-[#d8cfbf] bg-white px-4 py-3 text-sm font-semibold normal-case tracking-normal text-[#191914] outline-none focus:border-[#e7a124]"
              >
                {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
          </section>
        )}

        {ownerOverviewWarning && <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="status">{ownerOverviewWarning}</p>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <article className="rounded-2xl border border-[#ded5c5] bg-[#fffdf8] p-4 sm:p-5">
            <WalletCards className="h-5 w-5 text-[#b67608]" />
            <small className="mt-4 block font-bold text-[#777166]">Sales today</small>
            <strong className="mt-1 block text-xl font-black sm:text-2xl">R{ownerOverview.salesToday.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </article>
          <article className="rounded-2xl border border-[#ded5c5] bg-[#fffdf8] p-4 sm:p-5">
            <Building2 className="h-5 w-5 text-[#b67608]" />
            <small className="mt-4 block font-bold text-[#777166]">Orders today</small>
            <strong className="mt-1 block text-xl font-black sm:text-2xl">{ownerOverview.ordersToday}</strong>
          </article>
          <article className="rounded-2xl border border-[#ded5c5] bg-[#fffdf8] p-4 sm:p-5">
            <Users className="h-5 w-5 text-[#b67608]" />
            <small className="mt-4 block font-bold text-[#777166]">Active team</small>
            <strong className="mt-1 block text-xl font-black sm:text-2xl">{activeStaff.length}</strong>
          </article>
          <article className="rounded-2xl border border-[#ded5c5] bg-[#fffdf8] p-4 sm:p-5">
            <Smartphone className="h-5 w-5 text-[#b67608]" />
            <small className="mt-4 block font-bold text-[#777166]">Active devices</small>
            <strong className="mt-1 block text-xl font-black sm:text-2xl">{ownerOverview.activeDevices}</strong>
          </article>
          <article className="col-span-2 rounded-2xl border border-[#ded5c5] bg-[#fffdf8] p-4 sm:p-5 lg:col-span-1">
            <Package className="h-5 w-5 text-[#b67608]" />
            <small className="mt-4 block font-bold text-[#777166]">Low stock</small>
            <strong className="mt-1 block text-xl font-black sm:text-2xl">{ownerOverview.lowStockProducts}</strong>
            <span className="text-xs text-[#777166]">of {ownerOverview.activeProducts} active products</span>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-[2rem] border border-[#ded5c5] bg-[#fffdf8] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#8e5d08]">Team</span>
                <h2 className="mt-1 text-xl font-black">Who can work here</h2>
              </div>
              <Users className="h-5 w-5 text-[#b67608]" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-[#f5efe4] p-3"><strong className="block text-xl">{cashiers}</strong><small className="text-[#777166]">Cashiers</small></div>
              <div className="rounded-2xl bg-[#f5efe4] p-3"><strong className="block text-xl">{kitchen}</strong><small className="text-[#777166]">Kitchen</small></div>
              <div className="rounded-2xl bg-[#f5efe4] p-3"><strong className="block text-xl">{managers}</strong><small className="text-[#777166]">Managers</small></div>
            </div>
            <div className="mt-5 max-h-72 space-y-2 overflow-y-auto pr-1">
              {activeStaff.length ? activeStaff.map((staff) => (
                <div key={staff.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#e5ddd0] bg-white p-3">
                  <div><strong className="block text-sm">{staff.name}</strong><small className="text-[#777166]">{roleLabel(staff.role)}</small></div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">Active</span>
                </div>
              )) : <p className="rounded-xl bg-[#f5efe4] p-4 text-sm text-[#777166]">No active staff have been added to this branch yet.</p>}
            </div>
          </div>

          <div className="space-y-4">
            {businessId && controlBranchId ? (
              <>
                <section className="rounded-[2rem] border border-[#ded5c5] bg-[#fffdf8] p-5 sm:p-6">
                  <div className="mb-4">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#8e5d08]">Devices & access</span>
                    <h2 className="mt-1 text-xl font-black">Add a shop device</h2>
                    <p className="mt-1 text-sm text-[#777166]">Create a short-lived invite for a cashier, kitchen or manager device.</p>
                  </div>
                  <NativeHubEnrollmentControl businessId={businessId} branchId={controlBranchId} branchName={branchName} compact />
                </section>
                <section className="rounded-[2rem] border border-[#ded5c5] bg-[#fffdf8] p-5 sm:p-6">
                  <div className="mb-4">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#8e5d08]">Staff access</span>
                    <h2 className="mt-1 text-xl font-black">Reset a staff PIN</h2>
                    <p className="mt-1 text-sm text-[#777166]">Issue a one-time recovery step without exposing staff credentials in the owner portal.</p>
                  </div>
                  <NativeStaffCredentialResetControl businessId={businessId} branchId={controlBranchId} staff={staffList} compact />
                </section>
              </>
            ) : (
              <section className="rounded-[2rem] border border-[#ded5c5] bg-[#fffdf8] p-6 text-sm text-[#777166]">Choose an active branch before managing devices or staff access.</section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};