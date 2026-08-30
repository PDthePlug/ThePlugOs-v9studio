import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { hasNativeHubHost, localHubRuntime } from '@plugos/core';
import type { NativeHubOperatorContext, NetworkHealth } from '@plugos/core';
import type { Branch, StaffMember } from './types';
import { WelcomeScreen, type BusinessAuthSession, type OwnerAccessIdentity } from './screens/WelcomeScreen';
import { supabase } from './lib/supabase';
import { mapBranchRowToBranch, mapStaffRowToStaffMember } from './lib/mappers';

const FirstTimeSetupWizard = lazy(() =>
  import('./screens/FirstTimeSetupWizard').then((module) => ({ default: module.FirstTimeSetupWizard }))
);
const RoleLoginModal = lazy(() =>
  import('./components/RoleLoginModal').then((module) => ({ default: module.RoleLoginModal }))
);
const NativeCashierStation = lazy(() =>
  import('./workspaces/NativeCashierStation').then((module) => ({ default: module.NativeCashierStation }))
);
const NativeManagerStation = lazy(() =>
  import('./workspaces/NativeManagerStation').then((module) => ({ default: module.NativeManagerStation }))
);
const NativeKitchenStation = lazy(() =>
  import('./workspaces/NativeKitchenStation').then((module) => ({ default: module.NativeKitchenStation }))
);
const NativeAuthorityStatusStation = lazy(() =>
  import('./workspaces/NativeAuthorityStatusStation').then((module) => ({ default: module.NativeAuthorityStatusStation }))
);

const OperatingSurfaceLoading = () => (
  <div className="plug-surface-loading" role="status" aria-live="polite">
    <span aria-hidden="true" />
    <div>
      <strong>Preparing your workspace</strong>
      <small>Checking the approved operating context…</small>
    </div>
  </div>
);

const OwnerAccessProblem = ({ message, onSignOut }: { message: string; onSignOut: () => void }) => (
  <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-slate-100">
    <section className="max-w-xl rounded-3xl border border-rose-500/30 bg-slate-900 p-7 shadow-2xl space-y-5" role="alert">
      <span className="inline-flex rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">Owner access unavailable</span>
      <div>
        <h1 className="text-xl font-bold">This browser cannot establish a safe business context.</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{message}</p>
      </div>
      <p className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-400">
        Browser access is limited to an authenticated owner and read-only cloud foundation data. Station, staff, and device authority remain inside the enrolled Android Cashier Hub.
      </p>
      <button type="button" onClick={onSignOut} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-white">
        Sign out safely
      </button>
    </section>
  </main>
);

interface OwnerBusinessChoice {
  id: string;
  name: string;
}

const OwnerBusinessSelector = ({
  businesses,
  onChoose,
  onSignOut,
}: {
  businesses: OwnerBusinessChoice[];
  onChoose: (businessId: string) => void;
  onSignOut: () => void;
}) => (
  <main className="min-h-screen bg-slate-950 p-6 text-slate-100 sm:flex sm:items-center sm:justify-center">
    <section className="mx-auto w-full max-w-xl space-y-6 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8" aria-labelledby="owner-business-choice-title">
      <div>
        <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">Owner context</span>
        <h1 id="owner-business-choice-title" className="mt-4 text-2xl font-black tracking-tight">Choose the business to manage</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">This browser loads one owner business foundation at a time. Your station, staff, and device authority remain inside the enrolled Android Cashier Hub.</p>
      </div>
      <div className="space-y-3">
        {businesses.map((business) => (
          <button key={business.id} type="button" onClick={() => onChoose(business.id)} className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-amber-400 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400">
            <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Owner business</span>
            <strong className="mt-1 block text-base text-white">{business.name}</strong>
          </button>
        ))}
      </div>
      <button type="button" onClick={onSignOut} className="text-sm font-semibold text-slate-400 hover:text-slate-100">Sign out safely</button>
    </section>
  </main>
);

interface OwnerContext {
  business: { id: string; name: string; onboarding_status: string; owner_id: string };
  branches: Branch[];
  staff: StaffMember[];
}

/** Routes a role only after the Android Hub returns a verified native
 * operator context. This shell is intentionally reusable without Owner cloud
 * authentication for the installed Capacitor host. */
function NativeStationAccess({
  staffList = [],
  branches = [],
  businessId,
  branchId,
  onSelectBranch,
  onBrowserSignOut,
}: {
  staffList?: StaffMember[];
  branches?: Branch[];
  businessId?: string;
  branchId?: string;
  onSelectBranch?: (branchId: string) => void;
  onBrowserSignOut?: () => void;
}) {
  const [showNativeStation, setShowNativeStation] = useState(false);
  const [nativeStationRole, setNativeStationRole] = useState<NativeHubOperatorContext['role'] | null>(null);

  const exitNativeStation = useCallback(() => {
    setShowNativeStation(false);
    setNativeStationRole(null);
  }, []);

  const endNativeStaffSession = useCallback(async () => {
    await localHubRuntime.endNativeStaffSession();
    exitNativeStation();
  }, [exitNativeStation]);

  if (showNativeStation) {
    return (
      <Suspense fallback={<OperatingSurfaceLoading />}>
        {nativeStationRole === 'MANAGER' ? (
          <NativeManagerStation onExit={exitNativeStation} onEndNativeSession={endNativeStaffSession} />
        ) : nativeStationRole === 'KITCHEN_STAFF' ? (
          <NativeKitchenStation onExit={exitNativeStation} onEndNativeSession={endNativeStaffSession} />
        ) : nativeStationRole === 'OWNER' || nativeStationRole === 'ADMINISTRATOR' ? (
          <NativeAuthorityStatusStation onExit={exitNativeStation} onEndNativeSession={endNativeStaffSession} />
        ) : (
          <NativeCashierStation onExit={exitNativeStation} onEndNativeSession={endNativeStaffSession} />
        )}
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<OperatingSurfaceLoading />}>
      <RoleLoginModal
        staffList={staffList}
        branches={branches}
        businessId={businessId}
        branchId={branchId}
        onSelectBranch={onSelectBranch}
        onOpenNativeStation={(role) => {
          setNativeStationRole(role);
          setShowNativeStation(true);
        }}
        onSignOut={onBrowserSignOut}
      />
    </Suspense>
  );
}

/**
 * The web entry point is intentionally an owner-only, read-only cloud shell.
 * It does not mount the legacy operational workspaces, restore browser-held
 * role state, or call a mutation path. Those workflows re-enter only after
 * the native Hub exposes an authenticated staff-session and command bridge.
 */
function MainOSApp() {
  const [businessAuth, setBusinessAuth] = useState<BusinessAuthSession | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [ownerBusinessChoices, setOwnerBusinessChoices] = useState<OwnerBusinessChoice[]>([]);
  const [ownerSelectionOwnerId, setOwnerSelectionOwnerId] = useState<string | null>(null);
  const [unboundOwnerId, setUnboundOwnerId] = useState<string | null>(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [ownerAccessError, setOwnerAccessError] = useState<string | null>(null);
  const reconciledOwnerIdRef = useRef<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('auth') === 'recovery';
  });

  const clearBrowserContext = useCallback(() => {
    reconciledOwnerIdRef.current = null;
    setBusinessAuth(null);
    setBranches([]);
    setStaffList([]);
    setOwnerBusinessChoices([]);
    setOwnerSelectionOwnerId(null);
    setUnboundOwnerId(null);
    setShowSetupWizard(false);
    setOwnerAccessError(null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // The local owner context is cleared even when a network interruption
      // prevents remote token revocation from completing immediately.
    } finally {
      clearBrowserContext();
    }
  }, [clearBrowserContext]);

  const loadOwnerContext = useCallback(async (candidate: BusinessAuthSession): Promise<OwnerContext> => {
    if (!candidate.isOwner || !candidate.ownerId || !candidate.businessId) {
      throw new Error('An owner-authenticated business context is required.');
    }

    const [businessResult, branchesResult, staffResult] = await Promise.all([
      supabase
        .from('businesses')
        .select('id, name, onboarding_status, owner_id')
        .eq('id', candidate.businessId)
        .maybeSingle(),
      supabase
        .from('branches')
        .select('id, name, location, is_active')
        .eq('business_id', candidate.businessId)
        .order('created_at', { ascending: true }),
      // Never select R001's legacy pin_hash into a browser response.
      supabase
        .from('staff_members')
        .select('id, name, role, status, branch_id, active_shift, performance_score')
        .eq('business_id', candidate.businessId),
    ]);

    if (businessResult.error) throw new Error(`Could not read the business foundation: ${businessResult.error.message}`);
    if (!businessResult.data || businessResult.data.owner_id !== candidate.ownerId) {
      throw new Error('The authenticated account is not the owner of this business.');
    }
    if (branchesResult.error) throw new Error(`Could not read branches: ${branchesResult.error.message}`);
    if (staffResult.error) throw new Error(`Could not read the staff directory: ${staffResult.error.message}`);

    const resolvedBranches = (branchesResult.data || []).map(mapBranchRowToBranch);
    if (!resolvedBranches.some((branch) => branch.isActive)) {
      throw new Error('This business has no active branch. Resolve the R001 foundation before enabling a station.');
    }

    return {
      business: businessResult.data,
      branches: resolvedBranches,
      staff: (staffResult.data || []).map(mapStaffRowToStaffMember),
    };
  }, []);

  const listOwnerBusinesses = useCallback(async (ownerId: string): Promise<OwnerBusinessChoice[]> => {
    const [membershipResult, ownedBusinessResult] = await Promise.all([
      supabase
        .from('business_memberships')
        .select('business_id, role, businesses(id, name, owner_id)')
        .eq('user_id', ownerId)
        .eq('role', 'OWNER'),
      supabase
        .from('businesses')
        .select('id, name, owner_id')
        .eq('owner_id', ownerId),
    ]);

    if (membershipResult.error || ownedBusinessResult.error) {
      throw new Error('The owner business list could not be verified.');
    }

    const byId = new Map<string, OwnerBusinessChoice>();
    for (const membership of membershipResult.data || []) {
      const relationship = membership.businesses as unknown;
      const business = (Array.isArray(relationship) ? relationship[0] : relationship) as {
        id?: string;
        name?: string;
        owner_id?: string;
      } | null;
      // A browser owner context is stricter than a generic R001 membership:
      // the business must still identify this account as its owner record.
      if (business?.id && business.owner_id === ownerId) {
        byId.set(business.id, { id: business.id, name: business.name || 'Business' });
      }
    }
    for (const business of ownedBusinessResult.data || []) {
      if (business.owner_id === ownerId) {
        byId.set(business.id, { id: business.id, name: business.name || 'Business' });
      }
    }

    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, []);

  const acceptOwnerBusiness = useCallback(async ({ ownerId, businessId }: { ownerId: string; businessId: string }) => {
    try {
      setOwnerAccessError(null);
      setOwnerBusinessChoices([]);
      setOwnerSelectionOwnerId(null);
      setUnboundOwnerId(null);
      const candidate: BusinessAuthSession = {
        businessId,
        businessName: 'Business',
        ownerId,
        isOwner: true,
      };
      const context = await loadOwnerContext(candidate);
      const activeBranch = context.branches.find((branch) => branch.isActive);
      if (!activeBranch) throw new Error('This business has no active branch.');
      const resolvedAuth: BusinessAuthSession = {
        businessId: context.business.id,
        businessName: context.business.name,
        branchId: activeBranch.id,
        branchName: activeBranch.name,
        ownerId: candidate.ownerId,
        isOwner: true,
      };

      setBusinessAuth(resolvedAuth);
      setBranches(context.branches);
      setStaffList(context.staff);
      setShowSetupWizard(context.business.onboarding_status !== 'COMPLETED');
    } catch {
      clearBrowserContext();
      setOwnerAccessError('The owner business foundation could not be verified. No browser operational workspace was opened.');
    }
  }, [clearBrowserContext, loadOwnerContext]);

  const selectOwnerBranch = useCallback((branchId: string) => {
    const selected = branches.find((branch) => branch.id === branchId && branch.isActive);
    if (!selected) return;
    setBusinessAuth((current) => current && {
      ...current,
      branchId: selected.id,
      branchName: selected.name,
    });
  }, [branches]);

  const acceptOwnerIdentity = useCallback(async (identity: OwnerAccessIdentity) => {
    // Supabase can emit SIGNED_IN after the explicit browser handler has
    // already reconciled the same owner. A successful R001 foundation handoff
    // carries a preferred business and is deliberately allowed through.
    if (!identity.preferredBusinessId && reconciledOwnerIdRef.current === identity.ownerId) return;
    reconciledOwnerIdRef.current = identity.ownerId;
    try {
      setOwnerAccessError(null);
      setBusinessAuth(null);
      setBranches([]);
      setStaffList([]);
      setShowSetupWizard(false);
      setOwnerSelectionOwnerId(null);
      setUnboundOwnerId(null);

      // A post-R001-creation preferred ID is only a routing hint. The next
      // lookup still proves owner_id before the browser receives any context.
      if (identity.preferredBusinessId) {
        await acceptOwnerBusiness({ ownerId: identity.ownerId, businessId: identity.preferredBusinessId });
        return;
      }

      const businesses = await listOwnerBusinesses(identity.ownerId);
      if (businesses.length === 0) {
        setOwnerBusinessChoices([]);
        setUnboundOwnerId(identity.ownerId);
        return;
      }
      if (businesses.length === 1) {
        await acceptOwnerBusiness({ ownerId: identity.ownerId, businessId: businesses[0].id });
        return;
      }
      setOwnerBusinessChoices(businesses);
      setOwnerSelectionOwnerId(identity.ownerId);
    } catch {
      reconciledOwnerIdRef.current = null;
      clearBrowserContext();
      setOwnerAccessError('The owner account could not be reconciled with a business foundation. No operational workspace was opened.');
    }
  }, [acceptOwnerBusiness, clearBrowserContext, listOwnerBusinesses]);

  const completeRecovery = useCallback(async () => {
    await signOut();
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const retainedSearch = new URLSearchParams(
        [...url.searchParams.entries()].filter(([key]) => key !== 'auth'),
      ).toString();
      url.search = retainedSearch ? `?${retainedSearch}` : '';
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
    setRecoveryMode(false);
  }, [signOut]);

  useEffect(() => {
    let disposed = false;
    const restore = async () => {
      if (recoveryMode) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || disposed) return;
      try {
        await acceptOwnerIdentity({ ownerId: session.user.id });
      } catch {
        if (!disposed) setOwnerAccessError('Owner session restoration could not establish a safe business context.');
      }
    };

    void restore();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        return;
      }
      if (event === 'SIGNED_IN' && session?.user && !recoveryMode) {
        void acceptOwnerIdentity({ ownerId: session.user.id });
        return;
      }
      if (!session) clearBrowserContext();
    });
    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [acceptOwnerIdentity, clearBrowserContext, recoveryMode]);

  if (ownerAccessError) return <OwnerAccessProblem message={ownerAccessError} onSignOut={() => void signOut()} />;

  if (ownerBusinessChoices.length > 0 && ownerSelectionOwnerId) {
    return (
      <OwnerBusinessSelector
        businesses={ownerBusinessChoices}
        onChoose={(businessId) => void acceptOwnerBusiness({ ownerId: ownerSelectionOwnerId, businessId })}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (!businessAuth) {
    return (
      <WelcomeScreen
        onLoginSuccess={(identity) => acceptOwnerIdentity(identity)}
        recoveryMode={recoveryMode}
        authenticatedOwnerId={unboundOwnerId}
        onRecoveryComplete={() => completeRecovery()}
      />
    );
  }

  if (showSetupWizard) {
    return (
      <Suspense fallback={<OperatingSurfaceLoading />}>
        <FirstTimeSetupWizard
          businessAuth={{
            businessId: businessAuth.businessId,
            businessName: businessAuth.businessName,
            branchId: businessAuth.branchId || '',
            branchName: businessAuth.branchName || 'Branch not configured',
            isOwner: true,
            ownerId: businessAuth.ownerId,
          }}
          onSignOut={() => void signOut()}
        />
      </Suspense>
    );
  }

  return (
    <NativeStationAccess
      staffList={staffList}
      branches={branches}
      businessId={businessAuth.businessId}
      branchId={businessAuth.branchId}
      onSelectBranch={selectOwnerBranch}
      onBrowserSignOut={() => void signOut()}
    />
  );
}

export default function App() {
  const [, setHubHealth] = useState<NetworkHealth | null>(null);

  useEffect(() => {
    let mounted = true;
    let unsubscribeHub: (() => void) | undefined;
    void (async () => {
      try {
        // Both the owner-only browser shell and the direct Android-native
        // station entry use this measured capability bridge. Neither may fall
        // back to a browser event, sync, or certificate kernel.
        await localHubRuntime.boot();
        if (!mounted) return;
        setHubHealth(localHubRuntime.getNetworkHealth());
        unsubscribeHub = localHubRuntime.subscribe((snapshot: { networkHealth: NetworkHealth }) => {
          if (mounted) setHubHealth(snapshot.networkHealth);
        });
      } catch (error) {
        console.warn('[NATIVE_HUB_BOOT] Native Hub status is unavailable:', error);
      }
    })();
    return () => {
      mounted = false;
      unsubscribeHub?.();
      void localHubRuntime.shutdown();
    };
  }, []);

  return hasNativeHubHost() ? <NativeStationAccess /> : <MainOSApp />;
}
