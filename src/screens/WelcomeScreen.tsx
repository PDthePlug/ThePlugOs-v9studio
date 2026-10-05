import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, KeyRound, Lock, Mail, Store, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ownerAuthRedirectUrl, ownerPortalAccessMessage, resolveOwnerPortalConfiguration } from '../lib/ownerPortal';
import { MarketingLanding } from './MarketingLanding';

export interface OwnerAccessIdentity {
  ownerId: string;
  preferredBusinessId?: string;
}

/** Resolved only after App verifies the selected R001 owner business. */
export interface BusinessAuthSession {
  businessId: string;
  businessName: string;
  branchId?: string;
  branchName?: string;
  ownerId: string;
  isOwner: boolean;
  deviceId?: string;
}

type AccessView = 'LOGIN' | 'CREATE' | 'RECOVER_REQUEST' | 'RECOVER_PASSWORD';

interface WelcomeScreenProps {
  onLoginSuccess: (identity: OwnerAccessIdentity) => void | Promise<void>;
  /** A same-origin presentation marker; Supabase still validates the recovery session. */
  recoveryMode?: boolean;
  /** Set only after App has verified that the current Auth user has no R001 owner business. */
  authenticatedOwnerId?: string | null;
  onRecoveryComplete?: () => void | Promise<void>;
}

class OwnerAccessFlowError extends Error {}

const normalizeEmail = (value: string) => value.trim().toLocaleLowerCase();

/**
 * Browser access establishes an owner cloud context only. It never accepts a
 * staff PIN or restores a browser-held operational identity; that belongs to
 * the enrolled Android Hub under ADR-003.
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onLoginSuccess,
  recoveryMode = false,
  authenticatedOwnerId = null,
  onRecoveryComplete,
}) => {
  const [view, setView] = useState<AccessView>('LOGIN');
  const accessPanelRef = useRef<HTMLDivElement>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [replacementPassword, setReplacementPassword] = useState('');
  const [confirmReplacementPassword, setConfirmReplacementPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ownerPortal = resolveOwnerPortalConfiguration();

  const requireOwnerPortal = () => {
    if (ownerPortal.isReady) return true;
    setNotice(null);
    setError(ownerPortalAccessMessage(ownerPortal));
    return false;
  };

  const openAccess = (nextView: AccessView) => {
    setView(nextView);
    setError(ownerPortal.isReady ? null : ownerPortalAccessMessage(ownerPortal));
    setNotice(null);
    setAccessOpen(true);
  };

  const dismissAccess = () => {
    if (loading) return;
    if (recoveryMode) {
      void onRecoveryComplete?.();
      return;
    }
    setAccessOpen(false);
    setError(null);
  };

  const dismissRef = useRef(dismissAccess);
  dismissRef.current = dismissAccess;

  useEffect(() => {
    if (!recoveryMode) return;
    setAccessOpen(true);
    setView('RECOVER_PASSWORD');
    setError(null);
    setNotice('Choose a new password for your owner account. This link is verified by Supabase before any password is changed.');
  }, [recoveryMode]);

  useEffect(() => {
    if (!authenticatedOwnerId || recoveryMode) return;
    setAccessOpen(true);
    setView('CREATE');
    setError(null);
    setNotice('Your owner account is confirmed. Create the R001 business foundation to continue.');
  }, [authenticatedOwnerId, recoveryMode]);

  useEffect(() => {
    if (!accessOpen) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = accessPanelRef.current;
    (panel?.querySelector<HTMLElement>('input, button:not([disabled])') || panel)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current();
      if (event.key !== 'Tab' || !panel) return;
      const fields = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')];
      const first = fields[0], last = fields[fields.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };

    document.body.classList.add('plug-no-scroll');
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.classList.remove('plug-no-scroll');
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [accessOpen, loading, recoveryMode]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requireOwnerPortal()) return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      setError('Enter your email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (authError || !data.user) {
        throw new OwnerAccessFlowError('Unable to sign in. Check your details or reset your password.');
      }
      setPassword('');
      await onLoginSuccess({ ownerId: data.user.id });
    } catch (reason) {
      setError(reason instanceof OwnerAccessFlowError
        ? reason.message
        : 'Unable to sign in. Check your details or reset your password.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requireOwnerPortal()) return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      setError('Enter your email address to request a recovery link.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const redirectTo = ownerAuthRedirectUrl('RECOVERY');
      if (!redirectTo) throw new Error('Owner portal redirect is unavailable.');
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });
      if (recoveryError) throw new Error('Recovery request failed.');
      setNotice('If an owner account matches this address, a recovery link has been sent. Check your inbox and spam folder.');
    } catch {
      setError('We could not request a recovery link just now. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requireOwnerPortal()) return;
    if (replacementPassword.length < 12) {
      setError('Choose a password with at least 12 characters.');
      return;
    }
    if (replacementPassword !== confirmReplacementPassword) {
      setError('The new passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: replacementPassword });
      if (updateError) throw updateError;
      setReplacementPassword('');
      setConfirmReplacementPassword('');
      // A recovery session must not become a browser operating session. The
      // owner signs in again after App clears it following the update.
      await onRecoveryComplete?.();
    } catch {
      setError('We could not change the password. Request a fresh recovery link and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBusiness = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requireOwnerPortal()) return;
    const trimmedBusinessName = businessName.trim();
    const trimmedBranchName = branchName.trim();
    const normalizedEmail = normalizeEmail(email);

    if (!trimmedBusinessName) {
      setError('Enter the business name.');
      return;
    }
    if (!trimmedBranchName) {
      setError('Enter the first branch name.');
      return;
    }
    if (!authenticatedOwnerId) {
      if (!normalizedEmail) {
        setError('Enter the owner email address.');
        return;
      }
      if (password.length < 12) {
        setError('Choose a password with at least 12 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('The passwords do not match.');
        return;
      }
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { data: currentUserData, error: currentUserError } = await supabase.auth.getUser();
      if (currentUserError) throw new Error('Session lookup failed.');
      let owner = currentUserData.user;

      if (authenticatedOwnerId && (!owner || owner.id !== authenticatedOwnerId)) {
        throw new OwnerAccessFlowError('Your owner session has expired. Sign in again before creating the business foundation.');
      }

      if (owner) {
        const signedInEmail = normalizeEmail(owner.email || '');
        if (normalizedEmail && signedInEmail && signedInEmail !== normalizedEmail) {
          throw new OwnerAccessFlowError('This browser is already signed in as a different owner account. Sign out before creating another business.');
        }
      } else {
        const redirectTo = ownerAuthRedirectUrl('SIGNUP_CONFIRMATION');
        if (!redirectTo) throw new Error('Owner portal redirect is unavailable.');
        const { data: registration, error: registrationError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: redirectTo,
          },
        });
        if (registrationError || !registration.user) {
          throw new Error('Registration failed.');
        }
        if (!registration.session || !registration.user.email_confirmed_at) {
          setPassword('');
          setConfirmPassword('');
          setView('LOGIN');
          setNotice('Confirm your email, then sign in and create the business foundation. No business data was created yet.');
          return;
        }
        owner = registration.user;
      }

      if (!owner.email_confirmed_at) {
        setPassword('');
        setConfirmPassword('');
        setView('LOGIN');
        setNotice('Confirm your email, then sign in and create the business foundation. No business data was created yet.');
        return;
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc('create_business_with_owner_and_branch', {
        business_name: trimmedBusinessName,
        branch_name: trimmedBranchName,
        branch_location: null,
      });
      if (rpcError || !rpcData || typeof rpcData !== 'object') {
        throw new Error('Business initialization failed.');
      }

      const result = rpcData as { business_id?: unknown; branch_id?: unknown };
      if (typeof result.business_id !== 'string' || typeof result.branch_id !== 'string') {
        throw new Error('Business initialization returned an invalid result.');
      }

      setPassword('');
      setConfirmPassword('');
      await onLoginSuccess({ ownerId: owner.id, preferredBusinessId: result.business_id });
    } catch (reason) {
      setError(reason instanceof OwnerAccessFlowError
        ? reason.message
        : 'We could not create the business foundation. No browser operational workspace was opened. Review the details and try again.');
    } finally {
      setLoading(false);
    }
  };

  const openLogin = () => openAccess('LOGIN');

  return (
    <>
      <MarketingLanding onSignIn={openLogin} onCreateBusiness={() => openAccess('CREATE')} />

      {accessOpen && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-950/70 backdrop-blur-md"
          onMouseDown={dismissAccess}
        >
          <div
            className="plug-access-panel flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl"
            ref={accessPanelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="plug-access-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="plug-access-head flex shrink-0 flex-col items-center justify-center space-y-3 border-b border-slate-800 bg-slate-950 p-6">
              <button className="plug-access-close" type="button" onClick={dismissAccess} aria-label={recoveryMode ? 'Cancel password recovery' : 'Close business access'}>
                <X aria-hidden="true" />
              </button>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500 shadow-lg shadow-amber-500/20">
                {view === 'RECOVER_REQUEST' || view === 'RECOVER_PASSWORD'
                  ? <KeyRound className="h-8 w-8 text-slate-950" aria-hidden="true" />
                  : <Store className="h-8 w-8 text-slate-950" aria-hidden="true" />}
              </div>
              <h2 id="plug-access-title" className="text-2xl font-black tracking-tight text-white">ThePlugOS</h2>
              <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
                {view === 'RECOVER_REQUEST' || view === 'RECOVER_PASSWORD' ? 'Owner account recovery' : 'Owner access'}
              </p>
            </div>

            <div className="plug-access-body overflow-y-auto p-6">
              {!ownerPortal.isReady ? (
                <div role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
                  {ownerPortalAccessMessage(ownerPortal)}
                </div>
              ) : <>
              {!recoveryMode && view !== 'RECOVER_REQUEST' && (
                <div className="plug-access-tabs mb-6 flex shrink-0 rounded-xl border border-slate-800 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => { setView('LOGIN'); setError(null); setNotice(null); }}
                    className={`flex-1 rounded-lg py-2 text-sm font-bold transition-all ${view === 'LOGIN' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => { setView('CREATE'); setError(null); setNotice(null); }}
                    className={`flex-1 rounded-lg py-2 text-sm font-bold transition-all ${view === 'CREATE' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`}
                  >
                    Create Business
                  </button>
                </div>
              )}

              {error && <div role="alert" className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-center text-xs font-bold text-rose-300">{error}</div>}
              {notice && <div role="status" className="mb-4 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{notice}</span></div>}

              {view === 'LOGIN' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="plug-login-email" className="text-xs font-bold text-slate-400">Email address</label>
                    <div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-login-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="Enter email" /></div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="plug-login-password" className="text-xs font-bold text-slate-400">Password</label>
                    <div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-login-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="Enter password" /></div>
                  </div>
                  <button type="button" onClick={() => openAccess('RECOVER_REQUEST')} className="text-xs font-bold text-amber-300 underline-offset-4 hover:text-amber-200 hover:underline">Forgot password?</button>
                  <button type="submit" disabled={loading} className="mt-2 w-full cursor-pointer rounded-xl bg-amber-500 py-3 font-black text-slate-950 shadow-md transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Signing in…' : 'Sign In'}</button>
                </form>
              )}

              {view === 'RECOVER_REQUEST' && (
                <form onSubmit={handleRecoveryRequest} className="space-y-4">
                  <p className="text-sm leading-relaxed text-slate-300">Enter your owner email address. We will only send a link if the account is eligible for recovery.</p>
                  <div className="space-y-1.5"><label htmlFor="plug-recover-email" className="text-xs font-bold text-slate-400">Email address</label><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-recover-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="Enter email" /></div></div>
                  <button type="submit" disabled={loading} className="w-full rounded-xl bg-amber-500 py-3 font-black text-slate-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Sending recovery link…' : 'Send recovery link'}</button>
                  <button type="button" onClick={openLogin} className="flex w-full items-center justify-center gap-2 text-xs font-bold text-slate-400 hover:text-slate-100"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to sign in</button>
                </form>
              )}

              {view === 'RECOVER_PASSWORD' && (
                <form onSubmit={handlePasswordRecovery} className="space-y-4">
                  <p className="text-sm leading-relaxed text-slate-300">Use a new password of at least 12 characters. After it is changed, sign in again rather than continuing in this recovery session.</p>
                  <div className="space-y-1.5"><label htmlFor="plug-recovery-password" className="text-xs font-bold text-slate-400">New password</label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-recovery-password" type="password" required autoComplete="new-password" value={replacementPassword} onChange={(event) => setReplacementPassword(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="Choose a new password" /></div></div>
                  <div className="space-y-1.5"><label htmlFor="plug-recovery-confirm" className="text-xs font-bold text-slate-400">Confirm new password</label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-recovery-confirm" type="password" required autoComplete="new-password" value={confirmReplacementPassword} onChange={(event) => setConfirmReplacementPassword(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="Re-enter new password" /></div></div>
                  <button type="submit" disabled={loading} className="w-full rounded-xl bg-amber-500 py-3 font-black text-slate-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Updating password…' : 'Update password and sign out'}</button>
                </form>
              )}

              {view === 'CREATE' && (
                <form onSubmit={handleCreateBusiness} className="space-y-4">
                  <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                    {authenticatedOwnerId
                      ? 'This creates only the R001 business and first-branch foundation. Native onboarding is still required before the business can trade.'
                      : 'Create your owner account first. After you confirm your email and sign in, you can create the R001 business and first-branch foundation. Native onboarding is still required before the business can trade.'}
                  </p>
                  <div className="space-y-1.5"><label htmlFor="plug-create-business" className="text-xs font-bold text-slate-400">Business name</label><div className="relative"><Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-create-business" type="text" required value={businessName} onChange={(event) => setBusinessName(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="e.g. Nomsa's Takeaway" /></div></div>
                  <div className="space-y-1.5"><label htmlFor="plug-create-branch" className="text-xs font-bold text-slate-400">First branch name</label><div className="relative"><Store className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-create-branch" type="text" required value={branchName} onChange={(event) => setBranchName(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="e.g. Cresta Branch" /></div></div>
                  {!authenticatedOwnerId && <>
                    <div className="space-y-1.5"><label htmlFor="plug-create-email" className="text-xs font-bold text-slate-400">Owner email address</label><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-create-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="Enter email" /></div></div>
                    <div className="space-y-1.5"><label htmlFor="plug-create-password" className="text-xs font-bold text-slate-400">Password</label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-create-password" type="password" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="At least 12 characters" /></div></div>
                    <div className="space-y-1.5"><label htmlFor="plug-create-confirm" className="text-xs font-bold text-slate-400">Confirm password</label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="plug-create-confirm" type="password" required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none" placeholder="Re-enter password" /></div></div>
                  </>}
                  <button type="submit" disabled={loading} className="mt-2 w-full rounded-xl bg-amber-500 py-3 font-black text-slate-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Creating business foundation…' : authenticatedOwnerId ? 'Create business foundation' : 'Create owner account'}</button>
                </form>
              )}
              </>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
