"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, KeyRound, ShieldCheck, TriangleAlert, UserCog, Users } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * My account: who is signed in, and changing one's own password. A DHIS2
 * sign-in has no password here — it is changed in DHIS2 itself.
 */
export function AccountView({
  account,
  mustChange,
  first,
}: {
  account: { name: string; displayName: string; role: "admin" | "user"; via: "local" | "dhis2" };
  mustChange: boolean;
  first: boolean;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="rounded-xl border border-hair bg-surface p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full bg-accent/15 text-base font-semibold text-accent">
            {initials(account.displayName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink">{account.displayName}</p>
            <p className="truncate text-sm text-ink-2">{account.name}</p>
          </div>
        </div>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Role</dt>
            <dd className="inline-flex items-center gap-1.5 font-medium text-ink">
              {account.role === "admin" ? <ShieldCheck className="size-4 text-accent" aria-hidden /> : null}
              {account.role === "admin" ? "Administrator" : "User"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Signed in with</dt>
            <dd className="text-ink">{account.via === "dhis2" ? "DHIS2 account" : "Site account"}</dd>
          </div>
        </dl>
        {account.role === "admin" ? (
          <Link
            href="/admin/users"
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-hair px-3 py-2 text-sm font-medium text-ink hover:border-accent"
          >
            <Users className="size-4" aria-hidden /> Manage users
          </Link>
        ) : null}
        <p className="mt-5 text-xs leading-relaxed text-muted">
          Reading data is separate from signing in: connect with your own DHIS2 personal access token on the{" "}
          <Link href="/connect" className="text-accent underline">
            Connection
          </Link>{" "}
          page.
        </p>
      </section>

      <section className="rounded-xl border border-hair bg-surface p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <KeyRound className="size-4 text-accent" aria-hidden /> Password
        </h2>
        {account.via === "dhis2" ? (
          <p className="mt-2 text-sm text-ink-2">
            You signed in with your DHIS2 account, so your password is the DHIS2 one. Change it in DHIS2 (your profile → Edit
            profile → Change password); the next sign-in here uses the new one.
          </p>
        ) : (
          <PasswordForm mustChange={mustChange} first={first} />
        )}
      </section>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function PasswordForm({ mustChange, first }: { mustChange: boolean; first: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "good" | "error"; text: string } | null>(null);

  const checks = [
    { ok: password.length >= 10, text: "At least 10 characters" },
    { ok: password.length > 0 && password === confirm, text: "Both new passwords match" },
    { ok: password.length > 0 && password !== current, text: "Different from the current one" },
  ];
  const ready = current.length > 0 && checks.every((check) => check.ok);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, password }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        setMessage({ tone: "error", text: result.error ?? `The password could not be changed (${response.status}).` });
        return;
      }
      setCurrent("");
      setPassword("");
      setConfirm("");
      setMessage({ tone: "good", text: "Password changed. Any other place you were signed in has been signed out." });
      if (mustChange) {
        router.replace("/");
        router.refresh();
      } else {
        router.refresh();
      }
    } catch {
      setMessage({ tone: "error", text: "The site could not be reached." });
    } finally {
      setBusy(false);
    }
  }

  const type = show ? "text" : "password";
  return (
    <form className="mt-3 space-y-4" onSubmit={submit}>
      {mustChange || first ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          Your password was set by an administrator. Choose your own before using the site.
        </p>
      ) : null}
      <div>
        <Label htmlFor="current-password">Current password</Label>
        <Input id="current-password" className="mt-1" type={type} autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" className="mt-1" type={type} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="confirm-password">New password again</Label>
          <Input id="confirm-password" className="mt-1" type={type} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="space-y-1 text-xs">
          {checks.map((check) => (
            <li key={check.text} className={cn("flex items-center gap-1.5", check.ok ? "text-success-text" : "text-muted")}>
              <Check className={cn("size-3.5", check.ok ? "opacity-100" : "opacity-30")} aria-hidden />
              {check.text}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setShow((value) => !value)} className="inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
          {show ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          {show ? "Hide passwords" : "Show passwords"}
        </button>
      </div>
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            message.tone === "error" ? "border-critical/40 bg-critical/5 text-ink" : "border-hair bg-surface-2 text-ink",
          )}
        >
          {message.tone === "error" ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
          ) : (
            <Check className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />
          )}
          {message.text}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={!ready} loading={busy}>
        <UserCog className="size-4" aria-hidden /> Change password
      </Button>
    </form>
  );
}
