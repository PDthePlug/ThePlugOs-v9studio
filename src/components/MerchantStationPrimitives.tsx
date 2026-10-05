import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type MerchantStationTone = 'amber' | 'emerald' | 'orange' | 'sky' | 'rose' | 'slate';

const toneMap: Record<MerchantStationTone, {
  badge: string;
  icon: string;
  accent: string;
  soft: string;
}> = {
  amber: {
    badge: 'border-amber-300 bg-amber-100 text-amber-900',
    icon: 'bg-amber-500 text-white',
    accent: 'bg-amber-500 text-[#1d1608] hover:bg-amber-400',
    soft: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  emerald: {
    badge: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    icon: 'bg-emerald-700 text-white',
    accent: 'bg-emerald-700 text-white hover:bg-emerald-600',
    soft: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  },
  orange: {
    badge: 'border-orange-300 bg-orange-100 text-orange-900',
    icon: 'bg-orange-600 text-white',
    accent: 'bg-orange-600 text-white hover:bg-orange-500',
    soft: 'border-orange-200 bg-orange-50 text-orange-950',
  },
  sky: {
    badge: 'border-sky-300 bg-sky-100 text-sky-900',
    icon: 'bg-sky-700 text-white',
    accent: 'bg-sky-700 text-white hover:bg-sky-600',
    soft: 'border-sky-200 bg-sky-50 text-sky-950',
  },
  rose: {
    badge: 'border-rose-300 bg-rose-100 text-rose-900',
    icon: 'bg-rose-700 text-white',
    accent: 'bg-rose-700 text-white hover:bg-rose-600',
    soft: 'border-rose-200 bg-rose-50 text-rose-950',
  },
  slate: {
    badge: 'border-stone-300 bg-stone-100 text-stone-800',
    icon: 'bg-stone-800 text-white',
    accent: 'bg-stone-900 text-white hover:bg-stone-800',
    soft: 'border-stone-200 bg-stone-50 text-stone-900',
  },
};

export const StationShell = ({ children, width = 'max-w-7xl' }: { children: React.ReactNode; width?: string }) => (
  <main className="min-h-screen bg-[#f7f2e9] px-3 py-4 text-[#191914] sm:px-5 sm:py-6 lg:px-7">
    <div className={`mx-auto ${width} space-y-4 sm:space-y-5`}>{children}</div>
  </main>
);

export const StationHeader = ({
  role,
  staffName,
  title,
  subtitle,
  icon: Icon,
  tone,
  onBack,
  action,
}: {
  role: string;
  staffName: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: MerchantStationTone;
  onBack: () => void;
  action?: React.ReactNode;
}) => {
  const toneClasses = toneMap[tone];
  return (
    <header className="rounded-[1.75rem] border border-[#ded5c5] bg-[#fffdf8] p-4 shadow-[0_18px_55px_rgba(48,38,16,0.08)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#ddd3c2] bg-white text-[#3a352d] shadow-sm transition hover:bg-[#f7f2e9]"
            aria-label="Back to staff access"
          >
            <span className="text-xl leading-none">←</span>
          </button>
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ${toneClasses.icon}`}>
            <Icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.13em] ${toneClasses.badge}`}>{role}</span>
              <span className="truncate text-xs font-semibold text-[#777166]">{staffName}</span>
            </div>
            <h1 className="mt-1 text-xl font-black tracking-[-0.025em] sm:text-2xl">{title}</h1>
            <p className="mt-0.5 text-xs leading-5 text-[#777166] sm:text-sm">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
    </header>
  );
};

export const StatusBadge = ({
  label,
  detail,
  tone = 'slate',
  icon: Icon,
}: {
  label: string;
  detail?: string;
  tone?: MerchantStationTone;
  icon?: LucideIcon;
}) => {
  const toneClasses = toneMap[tone];
  return (
    <div className={`inline-flex min-h-12 items-center gap-2.5 rounded-2xl border px-3 py-2 ${toneClasses.soft}`}>
      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0">
        <strong className="block text-xs font-black">{label}</strong>
        {detail ? <small className="block max-w-xs truncate text-[11px] opacity-70">{detail}</small> : null}
      </span>
    </div>
  );
};

export const SectionCard = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => <section className={`rounded-[1.6rem] border border-[#ded5c5] bg-[#fffdf8] p-4 shadow-[0_12px_34px_rgba(48,38,16,0.055)] sm:p-5 ${className}`}>{children}</section>;

export const SectionTitle = ({
  eyebrow,
  title,
  description,
  trailing,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  trailing?: React.ReactNode;
}) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      {eyebrow ? <p className="text-[11px] font-black uppercase tracking-[0.17em] text-[#a26c0f]">{eyebrow}</p> : null}
      <h2 className="mt-1 text-lg font-black tracking-[-0.02em] sm:text-xl">{title}</h2>
      {description ? <p className="mt-1 max-w-2xl text-xs leading-5 text-[#777166] sm:text-sm">{description}</p> : null}
    </div>
    {trailing}
  </div>
);

export const MetricCard = ({ label, value, hint, tone = 'slate' }: { label: string; value: React.ReactNode; hint?: string; tone?: MerchantStationTone }) => {
  const toneClasses = toneMap[tone];
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses.soft}`}>
      <span className="text-[11px] font-bold uppercase tracking-[0.13em] opacity-60">{label}</span>
      <strong className="mt-1 block text-xl font-black tracking-[-0.02em]">{value}</strong>
      {hint ? <small className="mt-1 block text-[11px] opacity-65">{hint}</small> : null}
    </div>
  );
};

export const MerchantAction = ({
  children,
  onClick,
  disabled,
  tone = 'amber',
  secondary = false,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: MerchantStationTone;
  secondary?: boolean;
  className?: string;
}) => {
  const toneClasses = toneMap[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${secondary ? `border ${toneClasses.badge} bg-white hover:bg-[#f7f2e9]` : toneClasses.accent} ${className}`}
    >
      {children}
    </button>
  );
};

export const MerchantNotice = ({ children, tone = 'amber' }: { children: React.ReactNode; tone?: MerchantStationTone }) => {
  const toneClasses = toneMap[tone];
  return <div className={`rounded-2xl border px-4 py-3 text-xs leading-5 sm:text-sm ${toneClasses.soft}`}>{children}</div>;
};

export const EmptyState = ({ title, detail, icon: Icon }: { title: string; detail: string; icon: LucideIcon }) => (
  <div className="rounded-2xl border border-dashed border-[#d8cebd] bg-[#fbf7ef] p-7 text-center">
    <Icon className="mx-auto h-8 w-8 text-[#9a9182]" aria-hidden="true" />
    <strong className="mt-3 block text-base font-black">{title}</strong>
    <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-[#777166]">{detail}</p>
  </div>
);
