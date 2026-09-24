"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Lock, LogOut, ShieldCheck } from "lucide-react";
import { useConnection } from "@/components/connection-provider";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from "@/components/ui/primitives";
import { clearConnection, saveConnection } from "@/lib/dhis2/client";

/**
 * Connection setup.
 *
 * The token is posted once and stored in an httpOnly cookie; it is never
 * echoed back to the browser and never rendered again after this form.
 */
export function ConnectionForm() {
  const router = useRouter();
  const { status, loading, setStatus, refresh } = useConnection();

  const [baseUrl, setBaseUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [tokenType, setTokenType] = React.useState("ApiToken");
  const [revealed, setRevealed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const connected = status?.connected === true;
  const envManaged = status?.managedByEnv === true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const next = await saveConnection({ baseUrl, token, tokenType });
      if (next.connected) {
        setStatus(next);
        setToken("");
        router.refresh();
      } else {
        setError(next.error ?? "The connection could not be verified.");
      }
    } catch {
      setError("Could not reach this app's server to save the connection.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    await clearConnection();
    setStatus({ connected: false });
    router.refresh();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        {connected ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Connected</CardTitle>
                <CardDescription>{status?.baseUrl}</CardDescription>
              </div>
              <Badge tone="good">
                <Check className="size-3" aria-hidden />
                Verified
              </Badge>
            </CardHeader>
            <CardBody className="space-y-3">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Signed in as" value={status?.user?.displayName ?? "—"} />
                <Detail label="Username" value={status?.user?.username ?? "—"} />
                <Detail label="DHIS2 version" value={status?.system?.version ?? "Unknown"} />
                <Detail
                  label="Analytics last generated"
                  value={
                    status?.system?.lastAnalyticsTableSuccess
                      ? new Date(status.system.lastAnalyticsTableSuccess).toLocaleString()
                      : "Unknown"
                  }
                />
                <Detail
                  label="Data access"
                  value={`${status?.user?.organisationUnits?.length ?? 0} root organisation unit(s)`}
                />
                <Detail label="Credential type" value={status?.tokenType ?? "ApiToken"} />
              </dl>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="secondary" onClick={() => void refresh()} loading={loading}>
                  Re-check
                </Button>
                {!envManaged ? (
                  <Button variant="danger" onClick={() => void disconnect()}>
                    <LogOut className="size-3.5" aria-hidden />
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ) : null}

        {envManaged ? (
          <Alert title="Credentials come from the environment">
            <code className="text-xs">DHIS2_BASE_URL</code> and{" "}
            <code className="text-xs">DHIS2_TOKEN</code> are set on the server, so the
            connection cannot be changed from here. Update the environment and restart to
            point at a different server.
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{connected ? "Connect to a different server" : "Connect to DHIS2"}</CardTitle>
                <CardDescription>
                  The token is verified against <code>/api/me</code> before it is stored.
                </CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <Label htmlFor="base-url">Server URL</Label>
                  <Input
                    id="base-url"
                    className="mt-1"
                    placeholder="https://play.dhis2.org/40"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    autoComplete="url"
                    required
                  />
                  <p className="mt-1 text-xs text-muted">
                    The context path, without <code>/api</code>. A pasted API URL is trimmed
                    for you.
                  </p>
                </div>

                <div>
                  <Label htmlFor="token">Access token</Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="token"
                      type={revealed ? "text" : "password"}
                      className="font-mono"
                      placeholder="d2pat_…"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRevealed((value) => !value)}
                      title={revealed ? "Hide token" : "Show token"}
                    >
                      {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      <span className="sr-only">{revealed ? "Hide" : "Show"} token</span>
                    </Button>
                  </div>
                </div>

                <div>
                  <Label htmlFor="token-type">Token type</Label>
                  <Select
                    id="token-type"
                    className="mt-1"
                    value={tokenType}
                    onChange={(event) => setTokenType(event.target.value)}
                  >
                    <option value="ApiToken">Personal access token (d2pat_…)</option>
                    <option value="Bearer">OIDC bearer token</option>
                  </Select>
                </div>

                {error ? (
                  <Alert tone="error" title="Could not connect">
                    {error}
                  </Alert>
                ) : null}

                <Button type="submit" variant="primary" loading={saving}>
                  <ShieldCheck className="size-3.5" aria-hidden />
                  Verify and save
                </Button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>

      <aside className="space-y-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4 text-accent" aria-hidden />
                Where the token lives
              </CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2.5 text-xs text-ink-2">
              <li>
                Stored in an <strong className="text-ink">httpOnly cookie</strong>, so no
                script in the page can read it.
              </li>
              <li>
                Attached to DHIS2 requests <strong className="text-ink">on the server</strong>.
                The browser only ever talks to this app.
              </li>
              <li>
                The proxy forwards <strong className="text-ink">GET requests only</strong>,
                and only to analytics and metadata endpoints — it cannot write data.
              </li>
              <li>The session expires after 12 hours, or when you disconnect.</li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Creating a token in DHIS2</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="list-decimal space-y-1.5 pl-4 text-xs text-ink-2">
              <li>Open your DHIS2 profile and choose <em>Edit profile</em>.</li>
              <li>Go to <em>Personal access tokens</em> and generate a new token.</li>
              <li>
                Copy it once — DHIS2 shows the value a single time — and paste it here.
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted">
              A read-only account is enough. This app never writes to DHIS2.
            </p>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
