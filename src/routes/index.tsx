import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CookingPot, Radio, ShoppingBasket, Store, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { SignedIn, SignedOut, SignInGate, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getShopState } from "@/lib/hub";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();

  const [hasShop, setHasShop] = useState(false);

  useEffect(() => {
    if (isPending || !user) return;
    let cancelled = false;
    void getShopState().then((shop) => {
      if (cancelled) return;
      if (!shop) void navigate({ to: "/setup" });
      else setHasShop(true);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isPending, user, navigate]);

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-ink text-signal-soft">
            <Store className="h-5 w-5" />
          </span>
          <div>
            <strong className="block text-sm tracking-tight">ThePlugOS</strong>
            <span className="text-xs text-muted">Shop operating system</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPending ? <div className="h-10 w-10 animate-pulse rounded-full bg-warm" /> : null}
          <SignedIn>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <Link to="/login" className="inline-flex h-11 items-center rounded-md px-4 text-sm font-semibold">
              Open ThePlugOS
            </Link>
          </SignedOut>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Township fast food first</p>
          <h1 className="mt-4 max-w-xl font-display text-5xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
            The whole business, moving as one.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-ink-soft">
            Cashier takes the order. Kitchen cooks the queue. Manager keeps cash and stock honest. Owner sees the heartbeat. Connected stations keep everyone up to date.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <SignInGate
              fallback={
                <Link to="/login" className="inline-flex min-h-12 items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-paper">
                  Set up my business
                </Link>
              }
            >
              <Link
                to={hasShop ? "/owner" : "/setup"}
                className="inline-flex min-h-12 items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-paper"
              >
                {hasShop ? "Open owner dashboard" : "Continue setup"}
              </Link>
            </SignInGate>
            <Link to="/station" className="inline-flex min-h-12 items-center justify-center rounded-md border border-line bg-paper px-5 text-sm font-semibold">
              Pair a device
            </Link>
          </div>
        </div>
        <Card className="space-y-4 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Saturday rush</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Waiting", "6 tickets"],
              ["Cooking", "4 tickets"],
              ["Drawer", "R 2,480"],
              ["Ready for collection", "3 updates"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-warm px-4 py-3">
                <span className="block text-xs text-muted">{label}</span>
                <strong className="mt-1 block font-mono text-lg tabular-nums">{value}</strong>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">Illustrative preview of a Cresta takeaway lunch rush.</p>
        </Card>
      </section>

      <section className="border-t border-line bg-paper">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {[
            { icon: ShoppingBasket, title: "Cashier", copy: "Build the order, take cash, hand over when kitchen is ready." },
            { icon: CookingPot, title: "Kitchen", copy: "Waiting on the left. Cooking on the right. No money on this screen." },
            { icon: WalletCards, title: "Manager", copy: "Open the shift, cancel exceptions, count stock as it really is." },
            { icon: Radio, title: "Owner", copy: "Heartbeat, team, devices and menu. Pair stations without mixing roles." },
          ].map((item) => (
            <article key={item.title} className="rounded-xl border border-line bg-canvas p-5">
              <item.icon className="h-5 w-5 text-signal" />
              <h2 className="mt-4 font-display text-2xl font-medium">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <SignedIn>
          <Link to="/owner" className="inline-flex items-center gap-2 text-sm font-semibold">
            Open owner dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        </SignedIn>
      </section>
    </main>
  );
}
