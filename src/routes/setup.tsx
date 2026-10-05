import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { completeOnboarding, getShopState } from "@/lib/hub";
import { ROLE_LABEL, type StaffRole } from "@/lib/types";

export const Route = createFileRoute("/setup")({ component: Setup });

const DEFAULT_TEAM: { name: string; role: StaffRole; pin: string }[] = [
  { name: "Thandi", role: "CASHIER", pin: "" },
  { name: "Sipho", role: "KITCHEN", pin: "" },
  { name: "Lebo", role: "MANAGER", pin: "" },
];

function Setup() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [branchName, setBranchName] = useState("Main");
  const [team, setTeam] = useState(DEFAULT_TEAM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const holdRecap = useRef(false);

  useEffect(() => {
    if (isPending || !user || done || holdRecap.current) return;
    let cancelled = false;
    void getShopState().then((shop) => {
      if (!cancelled && !holdRecap.current && shop) void navigate({ to: "/owner" });
    }).catch(err => setError(err instanceof Error ? err.message : "Could not load setup."));
    return () => {
      cancelled = true;
    };
  }, [isPending, user, navigate, done]);

  if (isPending) {
    return <main className="grid min-h-screen place-items-center bg-canvas text-muted">Preparing setup…</main>;
  }
  if (!user) return <RedirectToSignIn />;

  const submit = async () => {
    holdRecap.current = true;
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding({ data: { businessName, branchName, team } });
      holdRecap.current = true;
      setDone(true);
    } catch (err) {
      holdRecap.current = false;
      setError(err instanceof Error ? err.message : "Setup could not finish.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="min-h-screen bg-canvas px-4 py-10 text-ink">
        <div className="mx-auto max-w-xl space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">Tell the floor once</p>
          <h1 className="font-display text-4xl font-medium">Shop is ready. PINs are shown once.</h1>
          <p className="text-sm leading-6 text-muted">
            Read this to each person, then they open a station with their name and PIN. After this screen the numbers are gone.
          </p>
          <Card className="space-y-3">
            {team.map((member) => (
              <div key={member.role} className="rounded-lg bg-warm px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong className="block">{member.name}</strong>
                    <span className="text-xs uppercase tracking-[0.14em] text-muted">{ROLE_LABEL[member.role]}</span>
                  </div>
                  <span className="font-mono text-2xl tabular-nums tracking-[0.12em]">{member.pin}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink-soft">
                  “{member.name}, you are {ROLE_LABEL[member.role].toLowerCase()}. Your PIN is {member.pin.split("").join(" ")}. Open the{" "}
                  {ROLE_LABEL[member.role].toLowerCase()} station and enter it.”
                </p>
              </div>
            ))}
          </Card>
          <div className="flex flex-wrap gap-3">
            <Button variant="ink" type="button" onClick={() => void navigate({ to: "/owner" })}>
              Owner dashboard
            </Button>
            <Button variant="secondary" type="button" onClick={() => void navigate({ to: "/station" })}>
              Open a station
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-ink">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">Set up your shop</p>
            <h1 className="mt-2 font-display text-4xl font-medium tracking-tight">One setup. Then you can trade.</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Name your business and add your team. Then pair the shop’s devices, open a cash shift and record your starting stock.
            </p>
          </div>
          <UserButton />
        </div>
        <Card className="space-y-4">
          <Field label="Business name">
            <Input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Nomsa's Takeaway" />
          </Field>
          <Field label="First branch">
            <Input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Cresta" />
          </Field>
        </Card>
        <Card className="space-y-4">
          <h2 className="font-display text-2xl font-medium">First team</h2>
          <p className="text-sm leading-6 text-muted">Names and PINs for cashier, kitchen and manager. You will read these back once at the end.</p>
          {team.map((member, index) => (
            <div key={member.role} className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Field label={`${ROLE_LABEL[member.role]} name`}>
                <Input
                  value={member.name}
                  onChange={(event) => {
                    const next = [...team];
                    next[index] = { ...member, name: event.target.value };
                    setTeam(next);
                  }}
                />
              </Field>
              <Field label={`${ROLE_LABEL[member.role]} PIN`}>
                <Input
                  inputMode="numeric"
                  value={member.pin}
                  onChange={(event) => {
                    const next = [...team];
                    next[index] = { ...member, pin: event.target.value.replace(/\D/g, "").slice(0, 8) };
                    setTeam(next);
                  }}
                />
              </Field>
            </div>
          ))}
        </Card>
        {error ? <Notice tone="alert">{error}</Notice> : null}
        <Button variant="ink" className="w-full sm:w-auto" disabled={busy} onClick={() => void submit()}>
          {busy ? "Creating the shop…" : "Finish setup"}
        </Button>
      </div>
    </main>
  );
}
