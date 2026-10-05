import React from 'react';
import { AlertTriangle, Building2, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
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
 * The former browser wizard wrote staff, credentials, product, and onboarding
 * state through independent client calls. That could leave a business marked
 * complete with unusable PINs or partial catalog/staff data. Until the staged
 * command receiver owns one atomic onboarding workflow, this screen is an
 * explicit safe stop.
 */
export const FirstTimeSetupWizard: React.FC<FirstTimeSetupWizardProps> = ({
  businessAuth,
  onSignOut
}) => (
  <div className="plug-setup-gate fixed inset-0 bg-[#020617] flex items-center justify-center z-50 p-4">
    <section className="plug-setup-card bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl" aria-labelledby="native-onboarding-title">
      <header className="bg-slate-950 p-6 border-b border-slate-800 flex items-start gap-3">
        <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300"><AlertTriangle className="w-6 h-6" /></div>
        <div>
          <h2 id="native-onboarding-title" className="text-2xl font-black text-white tracking-tight">Native onboarding required</h2>
          <p className="text-sm text-slate-400 mt-1">{businessAuth.businessName || 'Your business'} · {businessAuth.branchName}</p>
        </div>
      </header>

      <div className="p-6 space-y-5 text-sm leading-relaxed text-slate-300">
        <p>
          The R001 business foundation was created, but staff credentials, device authority, catalog, and operational setup cannot be finalized in a browser. The prior wizard could write some records while silently failing the security step; it is intentionally retired.
        </p>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 space-y-3">
          <div className="flex items-center gap-2 text-slate-100"><ShieldCheck className="w-4 h-4 text-emerald-300" /><strong>Release path before this business may trade</strong></div>
          <ol className="list-decimal pl-5 space-y-2 text-xs text-slate-400">
            <li>Clone R001 into staging and rehearse the credential migration without production changes.</li>
            <li>Deploy the authenticated cloud enrollment and native staff-session receiver.</li>
            <li>Complete one atomic onboarding command on the Android Cashier Hub.</li>
            <li>Verify the signed bundle, local ledger, and first staff station before marking onboarding complete.</li>
          </ol>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3 text-xs text-amber-100">
          <Smartphone className="w-5 h-5 shrink-0" />
          <span>Do not enter a staff PIN into this web shell. It will be verified and stored only by the approved native/cloud authority after the staging gate.</span>
        </div>

        <NativeHubEnrollmentControl
          businessId={businessAuth.businessId}
          branchId={businessAuth.branchId}
          branchName={businessAuth.branchName}
          compact
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="inline-flex items-center gap-2 text-xs text-slate-500"><Building2 className="w-4 h-4" /> Business foundation remains in progress</span>
          {onSignOut && <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-100 hover:bg-slate-700"><LogOut className="w-4 h-4" /> Sign out safely</button>}
        </div>
      </div>
    </section>
  </div>
);
