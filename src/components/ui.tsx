import { useSyncExternalStore } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const subscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);

// eslint-disable-next-line react-refresh/only-export-components
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "ink";
}) {
  const hydrated = useHydrated();
  const styles = {
    primary: "bg-signal text-ink hover:bg-signal-soft",
    secondary: "border border-line bg-paper text-ink hover:bg-warm",
    ghost: "text-ink hover:bg-warm",
    danger: "bg-alert text-paper hover:opacity-90",
    ink: "bg-ink text-paper hover:bg-ink-soft",
  } as const;
  return (
    <button
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-transform duration-150 ease-out enabled:active:scale-[0.98] disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
      disabled={!hydrated || props.disabled}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const hydrated = useHydrated();
  return (
    <input
      className={cn(
        "h-12 w-full rounded-md border border-line bg-paper px-3 text-base text-ink outline-none placeholder:text-muted focus:border-signal",
        props.className,
      )}
      {...props}
      disabled={!hydrated || props.disabled}
    />
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-paper p-5 shadow-[0_16px_40px_rgba(16,18,15,0.06)]", className)}>
      {children}
    </section>
  );
}

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "live" | "alert" | "signal";
  children: ReactNode;
}) {
  const styles = {
    muted: "border-line bg-warm text-muted",
    live: "border-live/30 bg-live/10 text-live",
    alert: "border-alert/30 bg-alert/10 text-alert",
    signal: "border-signal/30 bg-signal-soft/20 text-signal",
  } as const;
  return (
    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]", styles[tone])}>
      {children}
    </span>
  );
}

export function Notice({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "alert" | "ok";
}) {
  const styles = {
    default: "border-line bg-warm text-ink-soft",
    alert: "border-alert/30 bg-alert/10 text-alert",
    ok: "border-live/30 bg-live/10 text-live",
  } as const;
  return (
    <p className={cn("rounded-lg border px-4 py-3 text-sm leading-6", styles[tone])} role="status">
      {children}
    </p>
  );
}
