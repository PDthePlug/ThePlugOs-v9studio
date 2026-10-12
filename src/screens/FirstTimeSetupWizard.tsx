import React from 'react';
import {
  Building2,
  CheckCircle2,
  LogOut,
  Package,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
} from 'lucide-react';
import { NativeHubEnrollmentControl } from '../components/NativeHubEnrollmentControl';

interface FirstTimeSetupWizardProps {
  businessAuth: {
    businessId: string;
    businessName?: string;
    branchId: string;
    branchName: string;
    isOwner: boolean;
    ownerId?: string;
  };
  onSignOut?: () => void;
}

/**
 * Owner-facing continuation after the R001 business + first branch foundation
 * has been created. The browser presents setup progress and may request the
 * bounded native enrollment flow, but it never captures staff PINs, device
 * keys, terminal credentials, or operational command authority.
 */
export const FirstTimeSetupWizard: React.FC<FirstTimeSetupWizardProps> = ({
  businessAuth,
  onSignOut,
}) => (
  <div className="plug-setup-gate fixed inset-0 z-50 overflow-y-auto p-4">
    <section
      className="plug-setup-card mx-auto w-full overflow-y-auto border shadow-2xl"
      aria-labelledby="business-setup-title"
    >
      <header className="plug-setup-head border-b">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
              <Store className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">Business setup</p>
              <h2 id="business-setup-title" className="mt-1 font-black">Get your shop ready</h2>
              <p className="mt-2 text-sm">
                {businessAuth.businessName || 'Your business'} · {businessAuth.branchName}
              </p>
            </div>
          </div>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2" aria-label="Setup progress">
          <div className="h-1.5 rounded-full bg-amber-500" />
          <div className="h-1.5 rounded-full bg-amber-500/50" />
          <div className="h-1.5 rounded-full bg-slate-800" />
        </div>
      </header>

      <div className="plug-setup-body space-y-6">
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Business setup checklist">
          <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-black uppercase tracking-[0.12em]">Done</span>
            </div>
            <h3 className="mt-3 text-base font-black text-white">Business created</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Your owner account, business and first branch are ready.
            </p>
          </article>

          <article className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-center gap-2 text-amber-500">
              <Smartphone className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-black uppercase tracking-[0.12em]">Next</span>
            </div>
            <h3 className="mt-3 text-base font-black text-white">Connect the shop</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Pair the Android device that will run your local Cashier Hub.
            </p>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <Users className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-black uppercase tracking-[0.12em]">Then</span>
            </div>
            <h3 className="mt-3 text-base font-black text-white">Set up your team</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Add staff access, stations and your trading setup on the secured shop device.
            </p>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-500">Step 1 complete</p>
              <h3 className="mt-1 font-black text-white">Your business foundation is ready</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {businessAuth.businessName || 'Your business'} now has an owner account and the {businessAuth.branchName} branch. You do not need to create them again.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Smartphone className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-500">Step 2</p>
              <h3 className="mt-1 font-black text-white">Connect your main shop device</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Create a short-lived pairing code below, open the installed ThePlugOS app on the Android device at {businessAuth.branchName}, and enter the code there. Keep both devices on the same local network while pairing.
              </p>
            </div>
          </div>

          <NativeHubEnrollmentControl
            businessId={businessAuth.businessId}
            branchId={businessAuth.branchId}
            branchName={businessAuth.branchName}
            compact
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-500" aria-hidden="true" />
              <h3 className="text-base font-black text-white">Step 3 · Team & stations</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Once the Cashier Hub is connected, finish staff profiles and assign Cashier, Kitchen and Manager stations from the secured shop setup.
            </p>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-500" aria-hidden="true" />
              <h3 className="text-base font-black text-white">Menu & stock</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Add the products you sell, opening stock and the operating details your team needs before the first live sale.
            </p>
          </article>
        </section>

        <div className="rounded-2xl border border-emerald-700/20 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <strong className="block">Your staff PINs stay private.</strong>
              <span>
                Staff PINs are entered only on the enrolled Android device. This owner portal never asks for, stores or verifies a staff PIN.
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs leading-5 text-slate-500">
            Setup stays in progress until the secured shop device confirms the operating configuration.
          </span>
          <span className="inline-flex items-center gap-2 text-xs font-bold text-amber-500">
            <Smartphone className="h-4 w-4" aria-hidden="true" /> Continue on your Cashier Hub
          </span>
        </div>
      </div>
    </section>
  </div>
);
