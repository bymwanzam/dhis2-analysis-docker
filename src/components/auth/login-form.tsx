"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Map as MapIcon,
  ShieldCheck,
  TriangleAlert,
  User,
} from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";

/**
 * The sign-in page: who may use the site. Reading DHIS2 data is a second,
 * separate step — after signing in, each person connects with their own
 * DHIS2 personal access token, so everyone sees only what their own account
 * may see.
 */
export function LoginForm({
  next,
  problem,
  disabled,
  dhis2Host,
  localAccounts,
}: {
  next: string;
  problem: string | null;
  disabled: boolean;
  dhis2Host: string | null;
  localAccounts: boolean;
}) {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, next }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; next?: string; error?: string };
      if (!response.ok || !result.ok) {
        setError(result.error ?? `Sign-in failed (${response.status}).`);
        setPassword("");
        return;
      }
      // Re-render from the server, so the header and every page start from the new session.
      router.replace(result.next ?? "/");
      router.refresh();
    } catch {
      setError("The site could not be reached. Check your internet connection.");
    } finally {
      setBusy(false);
    }
  }

  const hint = dhis2Host
    ? `Use your DHIS2 username and password for ${dhis2Host}${localAccounts ? ", or a site account" : ""}.`
    : "Use the site account the administrator gave you.";

  return (
    <div className="grid min-h-[calc(100vh-10rem)] place-items-center py-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-hair bg-surface shadow-xl md:grid-cols-[1fr_1.1fr]">
        {/* ------------------------------------------------ brand panel */}
        <section
          className="relative hidden flex-col justify-between gap-8 p-8 text-white md:flex"
          style={{
            background:
              "radial-gradient(circle at 20% 15%, color-mix(in oklab, var(--accent) 70%, white) 0%, transparent 45%), linear-gradient(150deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 55%, black) 100%)",
          }}
        >
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-xl bg-white/15 text-base font-bold backdrop-blur">D2</span>
              <span className="text-lg font-semibold">DHIS2 Analysis</span>
            </div>
            <h1 className="mt-8 text-2xl font-semibold leading-snug">
              Analyse, map and check the quality of your DHIS2 data.
            </h1>
          </div>
          <ul className="space-y-3 text-sm text-white/90">
            <li className="flex items-start gap-2.5">
              <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden /> Trends, rankings and pivot tables from DHIS2 analytics
            </li>
            <li className="flex items-start gap-2.5">
              <MapIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> Maps by region, district and sub-district
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Data quality rules and reports
            </li>
          </ul>
          <p className="text-xs text-white/70">Read-only. Your token stays on the server and is never shown to the browser.</p>
        </section>

        {/* ------------------------------------------------ form */}
        <section className="p-8 sm:p-10">
          <div className="mb-6 flex items-center gap-2 md:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">D2</span>
            <span className="font-semibold text-ink">DHIS2 Analysis</span>
          </div>
          <span className="grid size-11 place-items-center rounded-xl bg-accent/10 text-accent">
            <Lock className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-xl font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-ink-2">{hint}</p>

          {problem ? (
            <div role="alert" className="mt-6 rounded-lg border border-critical/40 bg-critical/5 p-4 text-sm text-ink">
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert className="size-4 text-critical" aria-hidden /> Sign-in is not set up yet
              </p>
              <p className="mt-1 text-ink-2">{problem}</p>
              <p className="mt-2 text-ink-2">
                The site stays locked until it is. The administrator sets these in cPanel → Setup Node.js App → Environment
                variables, then restarts the app (see DEPLOY-CPANEL.md).
              </p>
            </div>
          ) : disabled ? (
            <div className="mt-6 rounded-lg border border-hair bg-surface-2 p-4 text-sm text-ink-2">
              Sign-in is switched off on this server (AUTH_DISABLED).{" "}
              <Link className="text-accent underline" href="/">
                Continue
              </Link>
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
              <div>
                <Label htmlFor="username">Username</Label>
                <div className="relative mt-1">
                  <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input
                    id="username"
                    className="h-11 pl-9"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative mt-1">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input
                    id="password"
                    className="h-11 pl-9 pr-11"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((value) => !value)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                  >
                    {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </div>

              {error ? (
                <p role="alert" className="flex items-start gap-2 rounded-lg border border-critical/40 bg-critical/5 px-3 py-2 text-sm text-ink">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
                  {error}
                </p>
              ) : null}

              <Button type="submit" variant="primary" className="h-11 w-full text-base" loading={busy} disabled={!username.trim() || !password}>
                <LogIn className="size-4" aria-hidden /> Sign in
              </Button>

              <p className="text-xs leading-relaxed text-muted">
                After signing in, connect with your own DHIS2 personal access token on the Connection page. The site shows
                only the data your own DHIS2 account may see.
              </p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
