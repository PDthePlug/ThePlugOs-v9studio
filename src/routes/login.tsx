import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAccessReadiness } from "@/lib/access-readiness";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {void getAccessReadiness().then(result => setReady(result.ready)).catch(() => setReady(false));}, []);

  if (!isPending && user) return <Navigate to="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "up") {
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name: name.trim() || email.split("@")[0],
        });
        if (signUpError) throw new Error(signUpError.message || "Could not create the owner account.");
      } else {
        const { error: signInError } = await authClient.signIn.email({ email, password });
        if (signInError) throw new Error(signInError.message || "Could not sign in.");
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 text-ink">
      <div className="mx-auto w-full max-w-md space-y-6">
        <Link to="/" className="text-sm font-semibold text-muted hover:text-ink">
          Back
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">Owner access</p>
          <h1 className="mt-2 font-display text-4xl font-medium tracking-tight">
            {mode === "in" ? "Open ThePlugOS" : "Set up my business"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Owner sign-in stays in the cloud. Staff PINs never live on this page.
          </p>
        </div>
        <Card className="space-y-4 p-6">
          {authEnabled ? (
            <>
              {mode === "up" ? (
                <Field label="Your name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                </Field>
              ) : null}
              <Field label="Email">
                <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                />
              </Field>
              {ready === false ? <Notice>Owner access is being prepared. Please try again soon.</Notice> : null}
              {error ? <Notice>{error}</Notice> : null}
              <Button type="button" variant="ink" className="w-full" disabled={busy || ready !== true} onClick={() => void submit()}>
                {busy ? "Working…" : mode === "in" ? "Sign in" : "Create owner account"}
              </Button>
              <div className="grid gap-2">
                {(import.meta.env.VITE_GROK_OAUTH_ENABLED === "true" ? GROK_PROVIDERS : []).map((provider) => (
                  <Button
                    key={provider.providerId}
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => void signIn(provider.providerId, { callbackURL: "/" })}
                  >
                    Continue with {provider.label}
                  </Button>
                ))}
              </div>
              <Button variant="ghost" type="button" className="text-sm font-semibold text-signal" onClick={() => setMode(mode === "in" ? "up" : "in")}>
                {mode === "in" ? "New owner? Create an account" : "Already have an account? Sign in"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">Sign-in is disabled.</p>
          )}
        </Card>
      </div>
    </main>
  );
}
