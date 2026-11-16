"use client";

import * as React from "react";
import {
  Check,
  Copy,
  KeyRound,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  TriangleAlert,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { Button, Input, Label, Segmented, Spinner } from "@/components/ui/primitives";
import { useAsyncData } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface PublicUser {
  name: string;
  displayName: string;
  role: "admin" | "user";
  disabled: boolean;
  mustChange: boolean;
  source: "site" | "server";
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

interface UsersResponse {
  ok: boolean;
  users: PublicUser[];
  storeError: string | null;
  storePath: string;
  dhis2SignIn: boolean;
  me: string;
  error?: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

/**
 * Manage users: every site account, what it may do, and the controls to
 * change it. A password chosen here — typed or generated — is shown once and
 * must be replaced by its owner at first sign-in.
 */
export function UsersAdmin() {
  const [nonce, setNonce] = React.useState(0);
  const data = useAsyncData((signal) => api<UsersResponse>("/api/admin/users", { signal }), [nonce]);
  const reload = () => setNonce((value) => value + 1);
  const [secret, setSecret] = React.useState<{ name: string; password: string; what: string } | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [filter, setFilter] = React.useState("");

  async function act(name: string, body: Record<string, unknown>, done: string) {
    setNotice(null);
    try {
      const result = await api<{ password?: string }>(`/api/admin/users/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (result.password) setSecret({ name, password: result.password, what: "New password" });
      setNotice({ tone: "good", text: done });
      reload();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function remove(name: string) {
    if (!window.confirm(`Delete the account "${name}"? They will be signed out and cannot sign in again.`)) return;
    setNotice(null);
    try {
      await api(`/api/admin/users/${encodeURIComponent(name)}`, { method: "DELETE" });
      setNotice({ tone: "good", text: `"${name}" was deleted.` });
      reload();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  if (data.error) {
    return <Message tone="error" text={data.error} />;
  }
  if (data.loading && !data.data) return <Spinner label="Loading accounts" />;
  if (!data.data) return null;

  const { users, storeError, storePath, dhis2SignIn, me } = data.data;
  const needle = filter.trim().toLowerCase();
  const shown = users.filter((user) => !needle || `${user.name} ${user.displayName}`.toLowerCase().includes(needle));
  const admins = users.filter((user) => user.role === "admin" && !user.disabled).length;

  return (
    <div className="space-y-5">
      {storeError ? (
        <Message tone="error" text={`The account file cannot be read: ${storeError}. Site accounts made here are unavailable until it is fixed (${storePath}).`} />
      ) : null}

      {secret ? <SecretCard secret={secret} onClose={() => setSecret(null)} /> : null}
      {notice ? <Message tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Accounts" value={users.length} />
        <Stat label="Administrators" value={admins} />
        <Stat label="Disabled" value={users.filter((user) => user.disabled).length} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-xl border border-hair bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-5 py-3">
            <h2 className="text-base font-semibold text-ink">Site accounts</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
              <Input aria-label="Find an account" className="h-8 w-52 pl-8 text-xs" placeholder="Find an account…" value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
          </header>
          {!shown.length ? (
            <p className="px-5 py-10 text-center text-sm text-ink-2">{users.length ? "No account matches." : "No site accounts yet. Add one on the right."}</p>
          ) : (
            <ul className="divide-y divide-hair">
              {shown.map((user) => (
                <UserRow
                  key={user.name}
                  user={user}
                  isMe={user.name.toLowerCase() === me.toLowerCase()}
                  onRole={(role) => act(user.name, { role }, role === "admin" ? `"${user.name}" is now an administrator.` : `"${user.name}" is now a user.`)}
                  onDisable={(disabled) => act(user.name, { disabled }, disabled ? `"${user.name}" was disabled and signed out.` : `"${user.name}" can sign in again.`)}
                  onReset={() => {
                    if (window.confirm(`Reset the password of "${user.name}"? They will be signed out and must choose a new one.`)) {
                      void act(user.name, { resetPassword: true }, `New password made for "${user.name}". Give it to them privately.`);
                    }
                  }}
                  onDelete={() => void remove(user.name)}
                />
              ))}
            </ul>
          )}
          <p className="border-t border-hair px-5 py-3 text-xs text-muted">
            Accounts are kept in <span className="font-mono">{storePath}</span>, outside the app folder, so updating the app keeps them.
            {dhis2SignIn ? " People can also sign in with their DHIS2 accounts; those are managed in DHIS2, not here." : ""}
          </p>
        </section>

        <AddUser
          onCreated={(name, password, generated) => {
            setSecret({ name, password, what: generated ? "Generated password" : "Password" });
            setNotice({ tone: "good", text: `"${name}" was added. They must choose their own password at first sign-in.` });
            reload();
          }}
        />
      </div>
    </div>
  );
}

function UserRow({
  user,
  isMe,
  onRole,
  onDisable,
  onReset,
  onDelete,
}: {
  user: PublicUser;
  isMe: boolean;
  onRole: (role: "admin" | "user") => void;
  onDisable: (disabled: boolean) => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-5 py-3", user.disabled && "opacity-60")}>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
          user.role === "admin" ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink-2",
        )}
        aria-hidden
      >
        {user.displayName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase())
          .join("") || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {user.displayName}
          {isMe ? <Tag>You</Tag> : null}
          {user.role === "admin" ? (
            <Tag tone="accent">
              <ShieldCheck className="size-3" aria-hidden /> Administrator
            </Tag>
          ) : (
            <Tag>User</Tag>
          )}
          {user.disabled ? <Tag tone="critical">Disabled</Tag> : null}
          {user.mustChange && !user.disabled ? <Tag tone="warning">Must change password</Tag> : null}
          {user.source === "server" ? <Tag>From server settings</Tag> : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-2">
          <span className="font-mono">{user.name}</span>
          {user.createdAt && !user.createdAt.startsWith("1970") ? ` · added ${new Date(user.createdAt).toLocaleDateString()}` : ""}
          {user.createdBy ? ` by ${user.createdBy}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {!isMe ? (
          <>
            <Action label="Reset password" onClick={onReset} icon={<KeyRound className="size-3.5" />} />
            {user.role === "admin" ? (
              <Action label="Make user" onClick={() => onRole("user")} icon={<ShieldOff className="size-3.5" />} />
            ) : (
              <Action label="Make administrator" onClick={() => onRole("admin")} icon={<ShieldCheck className="size-3.5" />} />
            )}
            {user.disabled ? (
              <Action label="Enable" onClick={() => onDisable(false)} icon={<UserCheck className="size-3.5" />} />
            ) : (
              <Action label="Disable" onClick={() => onDisable(true)} icon={<UserX className="size-3.5" />} />
            )}
            {user.source === "site" ? <Action label="Delete" onClick={onDelete} icon={<Trash2 className="size-3.5" />} danger /> : null}
          </>
        ) : (
          <a href="/account" className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:underline">
            Change my password
          </a>
        )}
      </div>
    </li>
  );
}

function AddUser({ onCreated }: { onCreated: (name: string, password: string, generated: boolean) => void }) {
  const [name, setName] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [role, setRole] = React.useState<"user" | "admin">("user");
  const [mode, setMode] = React.useState<"generate" | "choose">("generate");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ name: string; password: string; generated: boolean }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), displayName: displayName.trim(), role, password: mode === "choose" ? password : "" }),
      });
      onCreated(result.name, result.password, result.generated);
      setName("");
      setDisplayName("");
      setPassword("");
      setRole("user");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 self-start rounded-xl border border-hair bg-surface p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        <UserPlus className="size-4 text-accent" aria-hidden /> Add a user
      </h2>
      <div>
        <Label htmlFor="new-username">Username</Label>
        <Input id="new-username" className="mt-1" autoCapitalize="none" spellCheck={false} placeholder="e.g. ama.owusu" value={name} onChange={(event) => setName(event.target.value)} />
        <p className="mt-1 text-[11px] text-muted">Letters, digits, dots, dashes or underscores. What they type to sign in.</p>
      </div>
      <div>
        <Label htmlFor="new-display">Full name</Label>
        <Input id="new-display" className="mt-1" placeholder="e.g. Ama Owusu" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </div>
      <div>
        <Label>Role</Label>
        <Segmented
          className="mt-1"
          ariaLabel="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: "user", label: "User" },
            { value: "admin", label: "Administrator" },
          ]}
        />
        <p className="mt-1 text-[11px] text-muted">
          {role === "admin" ? "Can add and change accounts, as you can." : "Can use the site; cannot manage accounts."}
        </p>
      </div>
      <div>
        <Label>Password</Label>
        <Segmented
          className="mt-1"
          ariaLabel="Password"
          value={mode}
          onChange={setMode}
          options={[
            { value: "generate", label: "Generate one" },
            { value: "choose", label: "I'll type one" },
          ]}
        />
        {mode === "choose" ? (
          <Input className="mt-2" type="text" autoComplete="new-password" placeholder="At least 10 characters" value={password} onChange={(event) => setPassword(event.target.value)} />
        ) : null}
        <p className="mt-1 text-[11px] text-muted">Shown to you once. They must replace it the first time they sign in.</p>
      </div>
      {error ? <Message tone="error" text={error} /> : null}
      <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!name.trim() || (mode === "choose" && password.length < 10)}>
        <UserPlus className="size-4" aria-hidden /> Add user
      </Button>
    </form>
  );
}

function SecretCard({ secret, onClose }: { secret: { name: string; password: string; what: string }; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <section className="rounded-xl border-2 border-accent bg-accent/5 p-5" role="status">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <KeyRound className="size-4 text-accent" aria-hidden /> {secret.what} for “{secret.name}”
          </p>
          <p className="mt-1 text-xs text-ink-2">
            Shown only now: it is not stored and cannot be shown again. Give it to them privately; they will be asked to change it.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-lg border border-hair bg-surface px-3 py-2 font-mono text-base tracking-wide text-ink">{secret.password}</code>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(`Username: ${secret.name}\nPassword: ${secret.password}`).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy username and password"}
        </Button>
      </div>
    </section>
  );
}

function Action({ label, onClick, icon, danger }: { label: string; onClick: () => void; icon: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-hair px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2",
        danger ? "hover:border-critical/50 hover:text-critical" : "hover:text-ink",
      )}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "accent" | "critical" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "accent"
          ? "border-accent/40 text-accent"
          : tone === "critical"
            ? "border-critical/40 text-critical"
            : tone === "warning"
              ? "border-warning/50 text-ink"
              : "border-hair text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-hair bg-surface px-4 py-3">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Message({ tone, text, onClose }: { tone: "good" | "error"; text: string; onClose?: () => void }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-ink",
        tone === "error" ? "border-critical/40 bg-critical/5" : "border-hair bg-surface-2",
      )}
    >
      {tone === "error" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />}
      <span className="flex-1">{text}</span>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="text-muted hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </p>
  );
}
