"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CircleHelp, Play, RotateCcw, Scale, X } from "lucide-react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { ComparisonScatter } from "@/components/charts/comparison-scatter";
import { Column, DataTable } from "@/components/charts/data-table";
import { StatTile } from "@/components/charts/stat-tile";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { useConnection } from "@/components/connection-provider";
import { DataItemSlot } from "@/components/query/data-item-slot";
import { OrgUnitPicker, toOuDimension } from "@/components/query/org-unit-picker";
import { PeriodPicker } from "@/components/query/period-picker";
import { Section, summarise } from "@/components/query/section";
import { useAnalyticsSession } from "@/components/query/use-analytics";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Segmented,
} from "@/components/ui/primitives";
import { dimensionValues, labelFor, type AnalyticsQuery } from "@/lib/dhis2/analytics";
import { fetchOrgUnitLevels, fetchOrgUnitNames } from "@/lib/dhis2/client";
import { findPeriodOption } from "@/lib/dhis2/periods";
import {
  FLAG_LABELS,
  compareItems,
  comparisonToCsv,
  differenceOverTime,
  hierarchyCell,
  hierarchyColumns,
  type ComparisonRow,
  type QualityFlag,
} from "@/lib/dhis2/quality";
import type { OrgUnitSelection } from "@/components/query/org-unit-picker";
import type { DimensionItem } from "@/lib/dhis2/types";
import { useAsyncData } from "@/lib/hooks";
import { formatNumber, formatPercent, formatPeriod, truncate } from "@/lib/format";
import { downloadCsv, stamped } from "@/lib/download";
import { cn } from "@/lib/utils";

export interface CompareState {
  a: DimensionItem | null;
  b: DimensionItem | null;
  periods: string[];
  orgUnits: OrgUnitSelection;
  aggregationType: string;
}

/**
 * A level of "AUTO" means the deepest level this server defines — the unit
 * that actually reports. A hardcoded LEVEL-4 would mean facility on one
 * server and sub-district on the next, so the number is resolved per server
 * rather than assumed.
 */
const AUTO_LEVEL = "AUTO";

const DEFAULT_COMPARE: CompareState = {
  a: null,
  b: null,
  periods: ["LAST_12_MONTHS"],
  orgUnits: { units: [], level: AUTO_LEVEL, useUserOrgUnit: true },
  aggregationType: "DEFAULT",
};

function resolveLevel(level: string, deepest: string): string {
  return level === AUTO_LEVEL ? deepest : level;
}

function buildQuery(state: CompareState, deepest: string): AnalyticsQuery {
  return {
    dx: [state.a?.id, state.b?.id].filter((id): id is string => Boolean(id)),
    pe: state.periods,
    ou: toOuDimension({
      ...state.orgUnits,
      level: resolveLevel(state.orgUnits.level, deepest),
    }),
    aggregationType: state.aggregationType,
    // Ask for ancestors so findings can be read district by sub-district.
    hierarchy: true,
  };
}

type TrendView = "levels" | "difference";

/**
 * Checks whether two data elements that should hold the same number actually
 * do, and lists every reporting unit where they do not.
 *
 * The pairs this is for are the ones where a difference is a defect rather
 * than a finding: suspected malaria cases against suspected cases tested, a
 * register count against its summary, doses issued against doses recorded.
 */
export function CompareWorkbench() {
  const { status, loading: checking } = useConnection();
  const connected = status?.connected === true;

  const { data: levels, error: levelsError } = useAsyncData(
    (signal) => fetchOrgUnitLevels(signal),
    [],
  );

  // Headings are the server's own words for its levels. When that lookup
  // fails the table still renders, headed "Level 1, Level 2" — which reads as
  // a bug rather than a missing permission, so it is stated outright.
  const unnamedLevels = Boolean(levelsError) || (levels !== null && levels.length === 0);

  const deepestLevel = levels?.length
    ? `LEVEL-${Math.max(...levels.map((level) => level.level))}`
    : "";

  const toQuery = React.useCallback(
    (state: CompareState) => buildQuery(state, deepestLevel),
    [deepestLevel],
  );

  const { query, setQuery, hydrated, result, error, running, dirty, run } =
    useAnalyticsSession("dhis2.compare.query", DEFAULT_COMPARE, toQuery);

  const [trendView, setTrendView] = React.useState<TrendView>("levels");
  const [problemsOnly, setProblemsOnly] = React.useState(false);

  /* ------------------------------------------------------------ shaping */

  // Which id is A is read back from the result, so a half-edited selection
  // never relabels a table that was drawn from the previous query.
  const items = result ? dimensionValues(result, "dx", "total") : [];
  const aId = query.a && items.includes(query.a.id) ? query.a.id : items[0];
  const bId = query.b && items.includes(query.b.id) ? query.b.id : items[1];
  const ready = Boolean(result && aId && bId);

  const aName = result && aId ? labelFor(result, aId) : (query.a?.displayName ?? "A");
  const bName = result && bId ? labelFor(result, bId) : (query.b?.displayName ?? "B");

  const comparison = React.useMemo(() => {
    if (!result || !aId || !bId) return null;
    return compareItems(result, { aId, bId });
  }, [result, aId, bId]);

  const overTime = React.useMemo(() => {
    if (!result || !aId || !bId) return [];
    return differenceOverTime(result, aId, bId);
  }, [result, aId, bId]);

  /* ------------------------------------------------------- the hierarchy */

  // Analytics names the units it returns but hands back their ancestors as
  // bare ids, so region and district names need a second lookup.
  const ancestorIds = React.useMemo(
    () => [...new Set((comparison?.rows ?? []).flatMap((row) => row.ancestors))],
    [comparison],
  );
  const ancestorKey = ancestorIds.join(",");

  const { data: ancestors } = useAsyncData(
    (signal) =>
      ancestorIds.length
        ? fetchOrgUnitNames(ancestorIds, signal)
        : Promise.resolve(new Map()),
    [ancestorKey],
  );

  const resolve = React.useCallback(
    (id: string) => ancestors?.get(id)?.displayName ?? id,
    [ancestors],
  );

  // Named the way the server names its own levels, and trimmed to the ones
  // that actually vary across the findings.
  const levelColumns = React.useMemo(() => {
    const names = new Map((levels ?? []).map((level) => [level.level, level.displayName]));
    return hierarchyColumns(
      comparison?.rows ?? [],
      (level) => names.get(level) ?? `Level ${level}`,
    );
  }, [comparison, levels]);

  const visibleRows = React.useMemo(() => {
    const rows = comparison?.rows ?? [];
    return problemsOnly ? rows.filter((row) => row.flag !== "match") : rows;
  }, [comparison, problemsOnly]);

  const trendData = React.useMemo(
    () =>
      overTime.map((point) => ({
        __x: point.period,
        __label: formatPeriod(point.period),
        ...(trendView === "levels"
          ? { [aId!]: point.a, [bId!]: point.b }
          : { difference: point.difference }),
      })),
    [overTime, trendView, aId, bId],
  );

  const trendSeries =
    trendView === "levels"
      ? [
          { id: aId ?? "a", name: aName },
          { id: bId ?? "b", name: bName },
        ]
      : [{ id: "difference", name: "A minus B" }];

  const missingSide = result && !ready ? (aId ? bName : aName) : null;

  /* -------------------------------------------------------------- render */

  if (!checking && !connected) {
    return (
      <Alert tone="error" title="No DHIS2 connection">
        Add a server URL and access token on the{" "}
        <Link href="/connect" className="font-medium text-accent underline">
          connection page
        </Link>{" "}
        before comparing data.
      </Alert>
    );
  }

  const effectiveLevel = resolveLevel(query.orgUnits.level, deepestLevel);
  const levelSummary = effectiveLevel
    ? `by ${(levels ?? [])
        .find((level) => `LEVEL-${level.level}` === effectiveLevel)
        ?.displayName.toLowerCase() ?? effectiveLevel.toLowerCase()}`
    : "";

  const canRun = Boolean(
    query.a &&
      query.b &&
      query.periods.length &&
      buildQuery(query, deepestLevel).ou.length &&
      // Wait for the level list before running, or "deepest" has no meaning.
      (query.orgUnits.level !== AUTO_LEVEL || deepestLevel),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[336px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="flex flex-col gap-3">
          <Section
            title="The two data elements"
            summary={
              query.a && query.b
                ? `${truncate(query.a.displayName, 18)} vs ${truncate(query.b.displayName, 18)}`
                : "Choose two that should carry the same number"
            }
            defaultOpen
          >
            <div className="space-y-4">
              <DataItemSlot
                label="Data element A"
                keyColor="var(--series-1)"
                value={query.a}
                exclude={query.b?.id}
                onChange={(a) => setQuery({ ...query, a })}
              />
              <DataItemSlot
                label="Data element B"
                keyColor="var(--series-2)"
                value={query.b}
                exclude={query.a?.id}
                onChange={(b) => setQuery({ ...query, b })}
              />
              <p className="text-xs text-muted">
                Every unit where the two do not hold exactly the same number is
                reported.
              </p>
            </div>
          </Section>

          <Section
            title="Period"
            summary={summarise(
              query.periods.map((id) => findPeriodOption(id)?.label ?? formatPeriod(id)),
              "No period chosen",
            )}
          >
            <PeriodPicker
              selected={query.periods}
              onChange={(periods) => setQuery({ ...query, periods })}
            />
          </Section>

          <Section
            title="Organisation units"
            summary={summarise(
              [
                ...(query.orgUnits.useUserOrgUnit ? ["My units"] : []),
                ...query.orgUnits.units.map((unit) => unit.displayName),
                ...(levelSummary ? [levelSummary] : []),
              ],
              "No organisation unit chosen",
            )}
          >
            <OrgUnitPicker
              selection={{
                ...query.orgUnits,
                level: resolveLevel(query.orgUnits.level, deepestLevel),
              }}
              onChange={(orgUnits) => setQuery({ ...query, orgUnits })}
            />
          </Section>

          <div className="sticky bottom-0 -mx-1 flex items-center gap-2 bg-plane/90 px-1 py-3 backdrop-blur">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => void run()}
              disabled={!canRun || !hydrated}
              loading={running}
            >
              {!running ? <Play className="size-3.5" aria-hidden /> : null}
              {running ? "Checking…" : dirty ? "Check" : "Check again"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setQuery(DEFAULT_COMPARE)}
              title="Reset the comparison"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              <span className="sr-only">Reset</span>
            </Button>
          </div>

          {!canRun ? (
            <p className="text-xs text-ink-2">
              Choose both data elements, a period and an organisation unit.
            </p>
          ) : dirty && result ? (
            <p className="text-xs text-ink-2">The selection has changed — check again.</p>
          ) : null}
        </div>
      </aside>

      <div className="min-w-0 space-y-5">
        {error ? (
          <Alert tone="error" title="The check did not run">
            {error}
          </Alert>
        ) : null}

        {!result ? (
          <div className="rounded-xl border border-hair bg-surface">
            <EmptyState
              icon={<Scale className="size-7" aria-hidden />}
              title={running ? "Checking…" : "Nothing checked yet"}
            >
              Pick two data elements that should hold the same number — suspected
              malaria cases and suspected cases tested, a register count and its
              summary — and this page lists every organisation unit where they do not.
            </EmptyState>
          </div>
        ) : result.isEmpty ? (
          <Alert title="The query returned no values">
            DHIS2 answered successfully but had nothing for this combination. Widen the
            period or pick a higher organisation unit.
          </Alert>
        ) : !ready ? (
          <Alert tone="error" title="Only one of the two data elements returned data">
            {missingSide} has no values anywhere in this selection, so there is nothing
            to check it against. Confirm it is captured for this period and these units.
          </Alert>
        ) : comparison ? (
          <>
            <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label={aName} value={comparison.summary.totalA} hint="Total for A" />
              <StatTile label={bName} value={comparison.summary.totalB} hint="Total for B" />
              <StatTile
                label="Difference"
                value={comparison.summary.totalDifference}
                hint="A minus B, across every unit"
              />
              <StatTile
                label="Units matching"
                value={comparison.summary.matched}
                hint={
                  comparison.summary.matchRate === null
                    ? "Nothing comparable"
                    : `of ${comparison.summary.comparable} comparable · ${comparison.summary.matchRate.toFixed(0)}%`
                }
              />
            </section>

            <FindingsStrip
              counts={{
                mismatch: comparison.summary.mismatched,
                missing: comparison.summary.incomplete,
                match: comparison.summary.matched,
              }}
            />

            {comparison.summary.unitCount <= 1 ? (
              <Alert title="Only one organisation unit in this result">
                The check runs per reporting unit. Set{" "}
                <strong className="text-ink">Break down by level</strong> in the
                organisation unit picker to get districts or facilities.
              </Alert>
            ) : null}

            <ChartFrame
              title={`${truncate(aName, 30)} against ${truncate(bName, 30)}`}
              description="One point per organisation unit. Anything off the diagonal is a unit where the two disagree."
            >
              <ComparisonScatter rows={comparison.rows} aName={aName} bName={bName} />
            </ChartFrame>

            {overTime.length > 1 ? (
              <ChartFrame
                title="Over time"
                description={
                  trendView === "levels"
                    ? "Both data elements summed across the selected units."
                    : "A minus B in each period. Anything away from zero is a period where the two did not agree."
                }
                toolbar={
                  <Segmented
                    ariaLabel="What to plot over time"
                    value={trendView}
                    onChange={setTrendView}
                    options={[
                      { value: "levels", label: "Levels" },
                      { value: "difference", label: "Difference" },
                    ]}
                  />
                }
                legend={
                  trendView === "levels" ? (
                    <ul className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
                      {trendSeries.map((series, index) => (
                        <li key={series.id} className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="h-0.5 w-4 rounded-full"
                            style={{
                              background: index === 0 ? "var(--series-1)" : "var(--series-2)",
                            }}
                          />
                          <span className="truncate">{series.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null
                }
              >
                <TimeSeriesChart
                  data={trendData}
                  series={trendSeries}
                  referenceValue={trendView === "difference" ? 0 : null}
                  referenceLabel={trendView === "difference" ? "Agree" : undefined}
                />
              </ChartFrame>
            ) : null}

            <FindingsTable
              rows={visibleRows}
              totalRows={comparison.rows.length}
              levelColumns={levelColumns}
              unnamedLevels={unnamedLevels}
              resolve={resolve}
              aName={aName}
              bName={bName}
              problemsOnly={problemsOnly}
              onProblemsOnlyChange={setProblemsOnly}
              onDownload={() =>
                downloadCsv(
                  comparisonToCsv(
                    comparison,
                    { a: aName, b: bName, levels: levelColumns },
                    resolve,
                  ),
                  `${stamped("dhis2-comparison")}.csv`,
                )
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- findings */

const FLAG_STYLE: Record<
  QualityFlag,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  mismatch: { icon: X, className: "text-critical" },
  missing: { icon: CircleHelp, className: "text-serious" },
  // Matching is deliberately unpainted: the two agreeing does not prove either
  // number is right, and a green tick would claim that it does.
  match: { icon: Check, className: "text-muted" },
};

function FindingsStrip({ counts }: { counts: Record<QualityFlag, number> }) {
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {(["mismatch", "missing", "match"] as QualityFlag[]).map((flag) => {
        const { icon: Icon, className } = FLAG_STYLE[flag];
        return (
          <li key={flag}>
            <Badge>
              <Icon className={cn("size-3.5", className)} aria-hidden />
              <span className="tabular-nums">{counts[flag]}</span>
              <span className="font-normal text-muted">{FLAG_LABELS[flag]}</span>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function FlagCell({ flag }: { flag: QualityFlag }) {
  const { icon: Icon, className } = FLAG_STYLE[flag];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden />
      {FLAG_LABELS[flag]}
    </span>
  );
}

function FindingsTable({
  rows,
  totalRows,
  levelColumns,
  unnamedLevels,
  resolve,
  aName,
  bName,
  problemsOnly,
  onProblemsOnlyChange,
  onDownload,
}: {
  rows: ComparisonRow[];
  totalRows: number;
  levelColumns: { level: number; label: string }[];
  unnamedLevels: boolean;
  resolve: (id: string) => string;
  aName: string;
  bName: string;
  problemsOnly: boolean;
  onProblemsOnlyChange: (value: boolean) => void;
  onDownload: () => void;
}) {
  const columns: Column<ComparisonRow>[] = [
    ...levelColumns.map((column) => ({
      key: `level-${column.level}`,
      header: column.label,
      render: (row: ComparisonRow) => hierarchyCell(row, column, resolve),
      sortValue: (row: ComparisonRow) => hierarchyCell(row, column, resolve),
    })),
    {
      key: "a",
      header: truncate(aName, 26),
      numeric: true,
      render: (row) => formatNumber(row.a),
      sortValue: (row) => row.a ?? -Infinity,
    },
    {
      key: "b",
      header: truncate(bName, 26),
      numeric: true,
      render: (row) => formatNumber(row.b),
      sortValue: (row) => row.b ?? -Infinity,
    },
    {
      key: "difference",
      header: "Difference",
      numeric: true,
      render: (row) =>
        row.difference === null ? (
          "–"
        ) : row.difference === 0 ? (
          <span className="text-muted">0</span>
        ) : (
          <span className="font-medium text-critical">
            {row.difference > 0 ? "+" : ""}
            {formatNumber(row.difference)}
          </span>
        ),
      sortValue: (row) => Math.abs(row.difference ?? 0),
    },
    {
      key: "gap",
      header: "Gap",
      numeric: true,
      render: (row) => (row.gap === null ? "–" : formatPercent(row.gap)),
      sortValue: (row) => row.gap ?? -1,
    },
    {
      key: "flag",
      header: "Finding",
      render: (row) => <FlagCell flag={row.flag} />,
      sortValue: (row) => row.flag,
    },
  ];

  return (
    <ChartFrame
      title="Findings by organisation unit"
      description={`Worst first. ${totalRows.toLocaleString()} unit${totalRows === 1 ? "" : "s"} checked.${
        unnamedLevels
          ? " This server did not name its hierarchy levels, so the columns are numbered."
          : ""
      }`}
      onDownload={onDownload}
      toolbar={
        <Checkbox
          label={<span className="text-xs text-ink-2">Only show problems</span>}
          checked={problemsOnly}
          onChange={(event) => onProblemsOnlyChange(event.target.checked)}
        />
      }
    >
      <div className="px-3">
        <DataTable
          columns={columns}
          rows={rows}
          caption="Every organisation unit checked, with its region and district"
          maxHeight={560}
          emptyMessage={
            problemsOnly
              ? "Every unit reported the same number for both data elements."
              : "No values to show."
          }
        />
      </div>
    </ChartFrame>
  );
}
