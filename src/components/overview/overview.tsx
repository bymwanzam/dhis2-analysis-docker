"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Grid3x3,
  Library,
  Map as MapIcon,
  Plug,
} from "lucide-react";
import { useConnection } from "@/components/connection-provider";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui/primitives";
import { StatTile } from "@/components/charts/stat-tile";
import { proxyGet } from "@/lib/dhis2/client";
import { useAsyncData } from "@/lib/hooks";
import type { Pager } from "@/lib/dhis2/types";

const COUNTED = [
  { resource: "indicators", label: "Indicators" },
  { resource: "dataElements", label: "Data elements" },
  { resource: "organisationUnits", label: "Organisation units" },
  { resource: "dataSets", label: "Data sets" },
] as const;

export function Overview() {
  const { status, loading } = useConnection();
  const connected = status?.connected === true;

  // One count per resource, asked for with a single-row page so DHIS2 does the
  // counting rather than this app.
  const { data: counts } = useAsyncData(async (signal) => {
    if (!connected) return {} as Record<string, number | null>;

    const entries = await Promise.all(
      COUNTED.map(async ({ resource }) => {
        try {
          const payload = await proxyGet<{ pager?: Pager }>(
            `${resource}.json?fields=id&pageSize=1&totalPages=true`,
            signal,
          );
          return [resource, payload.pager?.total ?? null] as const;
        } catch {
          return [resource, null] as const;
        }
      }),
    );

    return Object.fromEntries(entries) as Record<string, number | null>;
  }, [connected]);

  if (loading && !status) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {COUNTED.map((item) => (
          <Skeleton key={item.resource} className="h-24" />
        ))}
      </div>
    );
  }

  if (!connected) {
    return (
      <Card>
        <CardBody className="flex flex-col items-start gap-4 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-base font-semibold text-ink">Connect a DHIS2 server</h2>
            <p className="mt-1.5 text-sm text-ink-2">
              This app reads aggregate data through the DHIS2 Web API using a personal
              access token. The token is held on the server, and every request it makes is
              a read.
            </p>
            {status?.error ? (
              <p className="mt-3 text-sm text-critical">{status.error}</p>
            ) : null}
          </div>
          <Link
            href="/connect"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-[filter] hover:brightness-110"
          >
            <Plug className="size-4" aria-hidden />
            Set up the connection
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-label="What this server holds" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {COUNTED.map((item) => (
          <StatTile
            key={item.resource}
            label={item.label}
            value={counts?.[item.resource] ?? null}
            hint={counts === null ? "Counting…" : "Defined on this server"}
          />
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Start an analysis</CardTitle>
              <CardDescription>
                Four ways into the same data, all read from the same analytics.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <QuickLink
              href="/explore"
              icon={<Activity className="size-4" aria-hidden />}
              title="Explore"
              description="Trends, rankings and shares, with the figures beside them."
            />
            <QuickLink
              href="/pivot"
              icon={<Grid3x3 className="size-4" aria-hidden />}
              title="Pivot"
              description="Cross-tabulate two dimensions and export the matrix."
            />
            <QuickLink
              href="/maps"
              icon={<MapIcon className="size-4" aria-hidden />}
              title="Maps"
              description="Shade regions and districts by value, then drill down."
            />
            <QuickLink
              href="/metadata"
              icon={<Library className="size-4" aria-hidden />}
              title="Metadata"
              description="Find the indicators and elements worth querying."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Server</CardTitle>
              <CardDescription className="truncate" title={status?.baseUrl}>
                {status?.baseUrl}
              </CardDescription>
            </div>
            <Badge tone="good">v{status?.system?.version ?? "?"}</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <AnalyticsFreshness
              timestamp={status?.system?.lastAnalyticsTableSuccess}
              ageHours={status?.analyticsAgeHours}
            />
            <dl className="space-y-2 text-sm">
              <Row label="Signed in as" value={status?.user?.displayName ?? "—"} />
              <Row
                label="Root units"
                value={String(status?.user?.organisationUnits?.length ?? 0)}
              />
              <Row label="Credential" value={status?.tokenType ?? "ApiToken"} />
            </dl>
            <Link
              href="/connect"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent"
            >
              Connection settings
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </CardBody>
        </Card>
      </div>

      <Alert title="A note on what the numbers mean">
        Analytics answers from pre-generated tables, not from raw data values. Anything
        captured since the last analytics run will not appear here, however recent the
        period you query.
      </Alert>
    </div>
  );
}

/**
 * Freshness is a state, so it wears a status colour — and never colour alone:
 * the icon and the words carry it too.
 */
function AnalyticsFreshness({
  timestamp,
  ageHours,
}: {
  timestamp?: string;
  ageHours?: number;
}) {
  if (!timestamp || ageHours === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <CircleHelp className="size-4 shrink-0 text-muted" aria-hidden />
        Analytics run time unknown
      </p>
    );
  }

  const generated = new Date(timestamp);
  const stale = ageHours > 48;

  return (
    <p className="flex items-start gap-2 text-sm">
      {stale ? (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      ) : (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
      )}
      <span className="text-ink-2">
        <span className="font-medium text-ink">
          {stale ? "Analytics may be stale" : "Analytics up to date"}
        </span>
        <br />
        Last generated {generated.toLocaleString()}
      </span>
    </p>
  );
}

function QuickLink({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-hair p-3.5 transition-colors hover:bg-surface-2"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <span className="text-accent">{icon}</span>
        {title}
        <ArrowRight
          className="size-3.5 text-muted transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
      <span className="mt-1 block text-xs text-ink-2">{description}</span>
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
