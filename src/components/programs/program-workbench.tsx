"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, Copy, Search } from "lucide-react";
import { CategoryBarChart } from "@/components/charts/category-bar-chart";
import { ChartFrame, type ChartView } from "@/components/charts/chart-frame";
import { Column, DataTable } from "@/components/charts/data-table";
import { StatTile } from "@/components/charts/stat-tile";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { useConnection } from "@/components/connection-provider";
import {
  OrgUnitPicker,
  toOuDimension,
  type OrgUnitSelection,
} from "@/components/query/org-unit-picker";
import { PeriodPicker } from "@/components/query/period-picker";
import { Section, summarise } from "@/components/query/section";
import { Alert, Badge, Button, Input, Label, Select, Spinner } from "@/components/ui/primitives";
import { proxyGet } from "@/lib/dhis2/client";
import { findPeriodOption } from "@/lib/dhis2/periods";
import {
  buildEventAggregatePath,
  buildEventBreakdownPath,
  buildEventQueryPath,
  buildEventSumPath,
  buildProgramPath,
  catalogFor,
  countsToCsv,
  describeProgramType,
  eventDay,
  eventsToCsv,
  explainEventError,
  findCatalogItem,
  groupItems,
  isBreakableValueType,
  isEventScopeRunnable,
  isNumericValueType,
  itemGroup,
  parseBreakdown,
  parseEventCounts,
  parseEventPage,
  parseProgram,
  qualifiedItemId,
  shortItemName,
  sumOfResponse,
  verificationPairs,
  verificationRows,
  verificationToCsv,
  type CatalogItem,
  type CountedItem,
  type EventPage,
  type EventQueryResponse,
  type EventRecord,
  type ProgramDataElement,
  type ProgramTab,
  type VerificationRow,
} from "@/lib/dhis2/programs";
import type { AnalyticsResponse } from "@/lib/dhis2/types";
import { downloadCsv, stamped } from "@/lib/download";
import { formatNumber, formatPercent, formatPeriod } from "@/lib/format";
import { useAsyncData, usePersistentState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface ProgramState {
  periods: string[];
  orgUnits: OrgUnitSelection;
  /** A stage id, or null for the program's first stage. */
  stage: string | null;
}

const DEFAULT_STATE: ProgramState = {
  periods: ["LAST_12_MONTHS"],
  orgUnits: { units: [], level: "", useUserOrgUnit: true },
  stage: null,
};

/** Events listed per page. */
const PAGE_SIZE = 50;
/** Data element columns shown on screen; the rest are in the CSV. */
const MAX_COLUMNS = 10;
/** Bars drawn in a ranking; the table holds them all. */
const MAX_BARS = 20;

const EVENT_SERIES = [{ id: "events", name: "Events" }];
const VALUE_SERIES = [{ id: "value", name: "Total" }];
const FACTOR_SERIES = [{ id: "factor", name: "Verification factor" }];

/**
 * One event program: how many events, where and when, what each holds, and
 * any one of its items read on its own.
 *
 * Three reads of DHIS2 drive it. The events aggregate counts events per
 * period and organisation unit; the same endpoint, given an item, counts
 * events per value of that item or sums it; the events query lists events,
 * newest change first, with the stage's values. All of them say "events": a
 * program nobody is enrolled in has no people to count, so a unit that
 * recorded two assessments counts twice, and every chart says so.
 *
 * The item catalogue (program-items.ts, from the Metadata page's export)
 * names and groups the items before DHIS2 has answered, resolves an id or a
 * code pasted into the finder, and stands in for the program definition
 * when the token cannot read it.
 */
export function ProgramWorkbench({
  tab,
  initialItem = null,
}: {
  tab: ProgramTab;
  /** An item id or code from the URL, selected on arrival. */
  initialItem?: string | null;
}) {
  const { status, loading: checking } = useConnection();
  const connected = status?.connected === true;
  const router = useRouter();
  const pathname = usePathname();

  // Unit ids mean nothing on another server, so the selection is kept per
  // server, and per program.
  const [state, setState] = usePersistentState<ProgramState>(
    `dhis2.programs.${tab.slug}::${status?.baseUrl ?? "unset"}`,
    DEFAULT_STATE,
  );

  /* ------------------------------------------------------------- program */

  const catalog = catalogFor(tab.id);
  const groups = React.useMemo(() => groupItems(catalog), [catalog]);
  const pairs = React.useMemo(() => verificationPairs(catalog), [catalog]);

  const meta = useAsyncData(
    async (signal) =>
      connected ? parseProgram(await proxyGet(buildProgramPath(tab.id), signal)) : null,
    [connected, tab.id],
  );

  const stage =
    meta.data?.stages.find((candidate) => candidate.id === state.stage) ??
    meta.data?.stages[0] ??
    null;

  // The stage's elements as DHIS2 defines them, or the catalogue when the
  // definition cannot be read: the list is then still named and complete.
  const elements: ProgramDataElement[] = React.useMemo(
    () =>
      stage?.dataElements ??
      catalog.map((item) => ({ id: item.id, name: shortItemName(item), valueType: item.valueType })),
    [stage, catalog],
  );

  /* ---------------------------------------------------------------- item */

  // The chosen item lives in the URL, so a link to it can be shared and it
  // survives a reload; it is not stored, so a link always wins.
  const [itemKey, setItemKey] = React.useState<string>(initialItem ?? "");
  const selected = findCatalogItem(tab.id, itemKey);
  const selectItem = (next: CatalogItem | null) => {
    setItemKey(next?.id ?? "");
    const query = next ? `?item=${encodeURIComponent(next.id)}` : "";
    router.replace(`${pathname}${query}`, { scroll: false });
  };
  const selectedElement = selected ? elements.find((element) => element.id === selected.id) : undefined;

  /* --------------------------------------------------------------- scope */

  const scope = {
    periods: state.periods,
    orgUnits: toOuDimension(state.orgUnits),
    stage: stage?.id ?? null,
  };
  const runnable = isEventScopeRunnable(scope);
  const scopeKey = JSON.stringify(scope);
  const stageId = stage?.id ?? "";

  const periodSummary = summarise(
    state.periods.map((period) => findPeriodOption(period)?.label ?? formatPeriod(period)),
    "No period",
  );
  const orgUnitSummary = summarise(
    [
      ...(state.orgUnits.useUserOrgUnit ? ["Your organisation unit"] : []),
      ...state.orgUnits.units.map((unit) => unit.displayName),
      ...(state.orgUnits.level ? [state.orgUnits.level.replace("LEVEL-", "Level ")] : []),
    ],
    "No organisation unit",
  );
  const scopeLine = `${periodSummary} · ${orgUnitSummary}`;

  /* -------------------------------------------------------------- counts */

  const counts = useAsyncData(
    async (signal) => {
      if (!connected || !runnable) return null;
      return parseEventCounts(await proxyGet(buildEventAggregatePath(tab.id, scope), signal));
    },
    [connected, runnable, tab.id, scopeKey],
  );

  /* ------------------------------------------------------- item readings */

  const breakable = selected ? isBreakableValueType(selected.valueType) : false;
  const numeric = selected ? isNumericValueType(selected.valueType) : false;

  const breakdown = useAsyncData(
    async (signal) => {
      if (!connected || !runnable || !selected || !breakable) return null;
      const response = await proxyGet<AnalyticsResponse>(
        buildEventBreakdownPath(tab.id, { ...scope, stage: stageId, item: selected.id }),
        signal,
      );
      return parseBreakdown(response, { ...selected, options: selectedElement?.options });
    },
    [connected, runnable, tab.id, scopeKey, selected?.id, breakable, selectedElement],
  );

  const sums = useAsyncData(
    async (signal) => {
      if (!connected || !runnable || !selected || !numeric) return null;
      const response = await proxyGet<AnalyticsResponse>(
        buildEventSumPath(tab.id, { ...scope, stage: stageId, item: selected.id }),
        signal,
      );
      return parseEventCounts(response);
    },
    [connected, runnable, tab.id, scopeKey, selected?.id, numeric],
  );

  /* -------------------------------------------------------- verification */

  const verification = useAsyncData(
    async (signal) => {
      if (!connected || !runnable || !pairs.length) return null;
      const items = pairs.flatMap((pair) => [pair.source, pair.dhis2]);
      const totals = await Promise.all(
        items.map(async (item) =>
          sumOfResponse(
            await proxyGet<AnalyticsResponse>(
              buildEventSumPath(tab.id, { ...scope, stage: stageId, item: item.id }),
              signal,
            ),
          ),
        ),
      );
      const byItem: Record<string, number | null> = {};
      items.forEach((item, index) => {
        byItem[item.id] = totals[index];
      });
      return verificationRows(pairs, byItem);
    },
    [connected, runnable, tab.id, scopeKey, pairs],
  );

  /* -------------------------------------------------------------- events */

  // The page number belongs to one scope: a new scope starts at page one
  // without an effect having to reset anything.
  const [paging, setPaging] = React.useState({ key: scopeKey, page: 1 });
  const page = paging.key === scopeKey ? paging.page : 1;
  const goToPage = (next: number) => setPaging({ key: scopeKey, page: Math.max(1, next) });

  const elementIds = elements.map((element) => element.id).join(",");
  const events = useAsyncData(
    async (signal) => {
      if (!connected || !runnable || !elements.length) return null;
      const response = await proxyGet<EventQueryResponse>(
        buildEventQueryPath(tab.id, {
          ...scope,
          stage: stageId,
          dataElements: elements.map((element) => element.id),
          page,
          pageSize: PAGE_SIZE,
        }),
        signal,
      );
      return parseEventPage(response, elements, { page, pageSize: PAGE_SIZE });
    },
    [connected, runnable, tab.id, scopeKey, page, elementIds],
  );

  /* ------------------------------------------------------------- display */

  const [periodView, setPeriodView] = React.useState<ChartView>("chart");
  const [unitView, setUnitView] = React.useState<ChartView>("chart");

  if (checking) {
    return <Spinner label="Checking the connection" />;
  }

  if (!connected) {
    return (
      <Alert tone="error" title="No DHIS2 connection">
        Add a server URL and access token on the{" "}
        <Link href="/connect" className="text-accent underline underline-offset-2">
          connection page
        </Link>{" "}
        to read {tab.name}.
      </Alert>
    );
  }

  const byPeriod = counts.data?.byPeriod ?? [];
  const byOrgUnit = counts.data?.byOrgUnit ?? [];
  const periodData = byPeriod.map((item) => ({ __x: item.id, __label: item.name, events: item.value }));
  const unitData = byOrgUnit
    .slice(0, MAX_BARS)
    .map((item) => ({ __x: item.id, __label: item.name, events: item.value }));
  const hiddenUnits = Math.max(0, byOrgUnit.length - MAX_BARS);

  return (
    <div className="grid gap-5 lg:grid-cols-[336px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
        <Section title="Period" summary={periodSummary} defaultOpen>
          <PeriodPicker
            selected={state.periods}
            onChange={(periods) => setState((current) => ({ ...current, periods }))}
          />
        </Section>

        <Section title="Organisation units" summary={orgUnitSummary}>
          <OrgUnitPicker
            selection={state.orgUnits}
            onChange={(orgUnits) => setState((current) => ({ ...current, orgUnits }))}
          />
        </Section>

        <Section
          title="Data item"
          summary={selected ? shortItemName(selected) : "None chosen"}
          defaultOpen={Boolean(initialItem)}
        >
          <ItemFinder
            tab={tab}
            groups={groups}
            selected={selected}
            onSelect={selectItem}
            initialQuery={initialItem && !selected ? initialItem : ""}
          />
        </Section>

        {meta.data && meta.data.stages.length > 1 ? (
          <Section title="Stage" summary={stage?.name ?? "First stage"}>
            <Label htmlFor="program-stage">Program stage</Label>
            <Select
              id="program-stage"
              className="mt-1"
              value={stage?.id ?? ""}
              onChange={(event) =>
                setState((current) => ({ ...current, stage: event.target.value || null }))
              }
            >
              {meta.data.stages.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </Section>
        ) : null}
      </aside>

      <div className="min-w-0 space-y-5">
        <ProgramCard
          tab={tab}
          meta={meta}
          stageName={stage?.name ?? null}
          elementCount={elements.length}
          catalogued={catalog.length}
        />

        {!runnable ? (
          <Alert title="Choose a period and an organisation unit">
            Events are counted inside the periods and organisation units chosen on the left.
          </Alert>
        ) : counts.error ? (
          <RejectedAlert title="The event counts could not be loaded" error={counts.error} />
        ) : counts.loading || !counts.data ? (
          <div className="flex justify-center py-16">
            <Spinner label="Counting events" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Events" value={counts.data.total} hint={scopeLine} />
              <StatTile
                label="Organisation units with events"
                value={byOrgUnit.length}
                hint="Units that recorded at least one event"
              />
              <StatTile
                label="Periods with events"
                value={byPeriod.length}
                hint={`Of ${state.periods.length === 1 ? "the period" : `${state.periods.length} periods`} chosen`}
              />
            </div>

            {counts.data.total === 0 ? (
              <Alert title="No events in this scope">
                DHIS2 returned no events for {periodSummary.toLowerCase()} in {orgUnitSummary}.
                Try a wider period or a higher organisation unit, or check that analytics
                tables have been generated since the events were entered.
              </Alert>
            ) : null}

            <ChartFrame
              title="Events by period"
              description={scopeLine}
              view={periodView}
              onViewChange={setPeriodView}
              onDownload={() =>
                downloadCsv(countsToCsv(byPeriod, "Period"), `${stamped(`${tab.slug}-by-period`)}.csv`)
              }
              footnote={
                <span className="text-muted">
                  Each point counts the events whose event date falls in the period, summed
                  over the organisation units chosen. Events, not people: a unit that
                  recorded two {tab.label === "RDQA" ? "assessments" : "entries"} in a month
                  counts twice.
                </span>
              }
            >
              {periodView === "table" ? (
                <CountTable items={byPeriod} title="Period" />
              ) : (
                <TimeSeriesChart data={periodData} series={EVENT_SERIES} valueFormatter={formatNumber} />
              )}
            </ChartFrame>

            <ChartFrame
              title="Events by organisation unit"
              description={scopeLine}
              view={unitView}
              onViewChange={setUnitView}
              onDownload={() =>
                downloadCsv(
                  countsToCsv(byOrgUnit, "Organisation unit"),
                  `${stamped(`${tab.slug}-by-unit`)}.csv`,
                )
              }
              footnote={
                <span className="text-muted">
                  Events summed over the periods chosen, highest first.
                  {hiddenUnits > 0
                    ? ` The chart shows the top ${MAX_BARS} of ${byOrgUnit.length} units; the table and the CSV hold them all.`
                    : ""}
                </span>
              }
            >
              {unitView === "table" ? (
                <CountTable items={byOrgUnit} title="Organisation unit" />
              ) : (
                <CategoryBarChart
                  data={unitData}
                  series={EVENT_SERIES}
                  orientation="bars"
                  height={Math.max(160, unitData.length * 30 + 40)}
                  valueFormatter={formatNumber}
                />
              )}
            </ChartFrame>
          </>
        )}

        {runnable && pairs.length ? (
          <VerificationFrame tab={tab} verification={verification} scopeLine={scopeLine} />
        ) : null}

        {runnable && selected ? (
          <ItemPanel
            tab={tab}
            item={selected}
            breakable={breakable}
            numeric={numeric}
            breakdown={breakdown}
            sums={sums}
            scopeLine={scopeLine}
          />
        ) : null}

        {/* The list is its own read of DHIS2: it is shown whether or not the
            counts came back, so one rejected query never empties the page. */}
        {runnable ? (
          <EventsFrame
            tab={tab}
            events={events}
            page={page}
            onPage={goToPage}
            highlight={selected?.id ?? null}
            nothingToList={!elements.length}
            metaError={meta.error}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

/** A rejected request, with DHIS2's reason and, when it is a known one, the remedy. */
function RejectedAlert({ title, error }: { title: string; error: string }) {
  const remedy = explainEventError(error);
  return (
    <Alert tone="error" title={title}>
      <p>{error}</p>
      {remedy ? <p className="mt-2 font-medium">{remedy}</p> : null}
    </Alert>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      aria-label={`Copy ${label} ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1 rounded border border-hair bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 transition-colors hover:text-ink"
    >
      {value}
      {copied ? (
        <Check className="size-3 text-accent" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
    </button>
  );
}

/**
 * Picks an item: a finder that takes an id, a program.item id or a code, and
 * a list grouped the way the form is. The chosen item's ids are shown
 * copyable, because the id is what a query — or a link to this page — is
 * written with.
 */
function ItemFinder({
  tab,
  groups,
  selected,
  onSelect,
  initialQuery,
}: {
  tab: ProgramTab;
  groups: ReturnType<typeof groupItems>;
  selected: CatalogItem | undefined;
  onSelect: (item: CatalogItem | null) => void;
  initialQuery: string;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  const [missed, setMissed] = React.useState<string | null>(initialQuery || null);
  const inputId = React.useId();
  const selectId = React.useId();

  function find() {
    const found = findCatalogItem(tab.id, query);
    if (found) {
      setMissed(null);
      setQuery("");
      onSelect(found);
    } else {
      setMissed(query.trim() || null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={inputId}>Find by ID or code</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id={inputId}
            value={query}
            placeholder={`${tab.id}.… or a code`}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                find();
              }
            }}
            className="font-mono text-xs"
          />
          <Button size="sm" variant="secondary" onClick={find} title="Select this item">
            <Search className="size-3.5" aria-hidden />
            Go
          </Button>
        </div>
        {missed ? (
          <p className="mt-1 text-xs text-critical">
            No item in {tab.label} has the id or code “{missed}”.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Paste a UID from the Metadata page&apos;s Event data items list, with or without
            the program in front, or the item&apos;s code.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor={selectId}>Or choose from the form</Label>
        <Select
          id={selectId}
          className="mt-1"
          value={selected?.id ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            setMissed(null);
            onSelect(id ? (findCatalogItem(tab.id, id) ?? null) : null);
          }}
        >
          <option value="">— none —</option>
          {groups.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {shortItemName(item)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>

      {selected ? (
        <dl className="space-y-1.5 rounded-lg border border-hair bg-surface-2/60 p-2.5 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">Item</dt>
            <dd className="text-right font-medium text-ink">{shortItemName(selected)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">Section</dt>
            <dd className="text-ink">{itemGroup(selected)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">Value type</dt>
            <dd className="text-ink">{selected.valueType.toLowerCase().replace(/_/g, " ")}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">UID</dt>
            <dd>
              <CopyButton value={qualifiedItemId(tab.id, selected.id)} label="analytics id" />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">Item UID</dt>
            <dd>
              <CopyButton value={selected.id} label="item id" />
            </dd>
          </div>
          {selected.code ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">Code</dt>
              <dd>
                <CopyButton value={selected.code} label="code" />
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 pt-1">
            <dt className="text-muted">Link</dt>
            <dd>
              <CopyButton
                value={`${typeof window === "undefined" ? "" : window.location.origin}/programs/${tab.slug}?item=${selected.id}`}
                label="link to this item"
              />
            </dd>
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="pt-1 text-xs text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            Clear
          </button>
        </dl>
      ) : null}
    </div>
  );
}

function ProgramCard({
  tab,
  meta,
  stageName,
  elementCount,
  catalogued,
}: {
  tab: ProgramTab;
  meta: ReturnType<typeof useAsyncData<ReturnType<typeof parseProgram> | null>>;
  stageName: string | null;
  elementCount: number;
  catalogued: number;
}) {
  return (
    <section className="rounded-xl border border-hair bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{meta.data?.name ?? tab.name}</h2>
          <p className="mt-1 text-sm text-ink-2">{tab.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">
            {meta.data ? describeProgramType(meta.data.programType) : "Event program"}
          </Badge>
          <CopyButton value={tab.id} label="program id" />
        </div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-2 sm:grid-cols-3">
        <div className="flex gap-2">
          <dt className="text-muted">Stage</dt>
          <dd className="text-ink">{stageName ?? (meta.loading ? "Loading…" : "—")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Data elements</dt>
          <dd className="text-ink">
            {elementCount}
            {!meta.data && catalogued ? " (from the catalogue)" : ""}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Last changed</dt>
          <dd className="text-ink">{meta.data?.lastUpdated ? eventDay(meta.data.lastUpdated) : "—"}</dd>
        </div>
      </dl>
      {meta.error ? (
        <p className="mt-3 text-xs text-critical">
          The program&apos;s definition could not be read ({meta.error}). The items are
          named from the catalogue instead, so option values show as codes.
        </p>
      ) : null}
    </section>
  );
}

function CountTable({ items, title }: { items: CountedItem[]; title: string }) {
  const columns: Column<CountedItem>[] = [
    { key: "name", header: title, render: (row) => row.name, sortValue: (row) => row.name },
    {
      key: "value",
      header: "Events",
      numeric: true,
      render: (row) => formatNumber(row.value),
      sortValue: (row) => row.value,
    },
  ];
  return <DataTable columns={columns} rows={items} maxHeight={420} emptyMessage="No events." />;
}

/**
 * One item on its own: events per value, and for a number its total and the
 * average per event that recorded one.
 */
function ItemPanel({
  tab,
  item,
  breakable,
  numeric,
  breakdown,
  sums,
  scopeLine,
}: {
  tab: ProgramTab;
  item: CatalogItem;
  breakable: boolean;
  numeric: boolean;
  breakdown: ReturnType<typeof useAsyncData<CountedItem[] | null>>;
  sums: ReturnType<typeof useAsyncData<ReturnType<typeof parseEventCounts> | null>>;
  scopeLine: string;
}) {
  const [valuesView, setValuesView] = React.useState<ChartView>("chart");
  const [totalView, setTotalView] = React.useState<ChartView>("chart");
  const name = shortItemName(item);

  const values = breakdown.data ?? [];
  const recorded = values.filter((value) => value.id !== "__blank").reduce((sum, value) => sum + value.value, 0);
  const blank = values.find((value) => value.id === "__blank")?.value ?? 0;
  const valueData = values
    .filter((value) => value.id !== "__blank")
    .slice(0, MAX_BARS)
    .map((value) => ({ __x: value.id, __label: value.name, events: value.value }));
  const hiddenValues = Math.max(0, values.filter((value) => value.id !== "__blank").length - MAX_BARS);

  const total = sums.data?.total ?? null;
  const average = total !== null && recorded > 0 ? total / recorded : null;
  const totalByPeriod = (sums.data?.byPeriod ?? []).map((entry) => ({
    __x: entry.id,
    __label: entry.name,
    value: entry.value,
  }));

  if (!breakable) {
    return (
      <Alert title={`${name}: read it in the events table`}>
        This item is {item.valueType === "FILE_RESOURCE" ? "a file" : "free text"}, so it
        has as many values as events and is not counted per value. Its column is first in
        the Events table below.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {breakdown.error ? (
        <RejectedAlert title={`${name} could not be read`} error={breakdown.error} />
      ) : breakdown.loading || !breakdown.data ? (
        <div className="flex justify-center py-10">
          <Spinner label={`Reading ${name}`} />
        </div>
      ) : (
        <>
          <div className={cn("grid gap-3", numeric ? "sm:grid-cols-4" : "sm:grid-cols-2")}>
            <StatTile label={`Events recording ${name}`} value={recorded} hint={scopeLine} />
            <StatTile label="Not recorded" value={blank} hint="Events with this item left empty" />
            {numeric ? (
              <>
                <StatTile
                  label={`Total of ${name}`}
                  value={sums.error ? null : total}
                  hint="Summed over every event in scope"
                />
                <StatTile
                  label="Average per event"
                  value={average}
                  hint="The total divided by the events that recorded a value"
                />
              </>
            ) : null}
          </div>

          <ChartFrame
            title={`${name}: events per value`}
            description={scopeLine}
            view={valuesView}
            onViewChange={setValuesView}
            onDownload={() =>
              downloadCsv(countsToCsv(values, name), `${stamped(`${tab.slug}-${item.code || item.id}`)}.csv`)
            }
            footnote={
              <span className="text-muted">
                Each bar counts the events that recorded that value, over the periods and
                units chosen. Events left empty are counted above, not drawn.
                {hiddenValues > 0
                  ? ` The chart shows the ${MAX_BARS} most frequent of ${hiddenValues + MAX_BARS} values; the table and the CSV hold them all.`
                  : ""}
              </span>
            }
          >
            {valuesView === "table" ? (
              <CountTable items={values} title={name} />
            ) : valueData.length ? (
              <CategoryBarChart
                data={valueData}
                series={EVENT_SERIES}
                orientation="bars"
                height={Math.max(120, valueData.length * 30 + 40)}
                valueFormatter={formatNumber}
              />
            ) : (
              <p className="px-3 py-8 text-center text-sm text-muted">
                No event in scope recorded a value for {name}.
              </p>
            )}
          </ChartFrame>
        </>
      )}

      {numeric ? (
        sums.error ? (
          <RejectedAlert title={`The total of ${name} could not be read`} error={sums.error} />
        ) : sums.loading || !sums.data ? null : (
          <ChartFrame
            title={`Total of ${name} by period`}
            description={scopeLine}
            view={totalView}
            onViewChange={setTotalView}
            onDownload={() =>
              downloadCsv(
                countsToCsv(sums.data!.byPeriod, "Period").replace(/,Events\r?\n/, `,Total of ${name}\r\n`),
                `${stamped(`${tab.slug}-${item.code || item.id}-total`)}.csv`,
              )
            }
            footnote={
              <span className="text-muted">
                The item&apos;s values added up over the events of each period and over the
                units chosen. A sum of {name.toLowerCase()} is a sum of what assessors
                recorded, not a DHIS2 aggregate value.
              </span>
            }
          >
            {totalView === "table" ? (
              <DataTable
                columns={[
                  { key: "name", header: "Period", render: (row: CountedItem) => row.name, sortValue: (row: CountedItem) => row.id },
                  { key: "value", header: `Total of ${name}`, numeric: true, render: (row: CountedItem) => formatNumber(row.value), sortValue: (row: CountedItem) => row.value },
                ]}
                rows={sums.data.byPeriod}
                maxHeight={420}
                emptyMessage="No values."
              />
            ) : (
              <TimeSeriesChart data={totalByPeriod} series={VALUE_SERIES} valueFormatter={formatNumber} />
            )}
          </ChartFrame>
        )
      ) : null}
    </div>
  );
}

/** The RDQA recount: DHIS2 against the source register, indicator by indicator. */
function VerificationFrame({
  tab,
  verification,
  scopeLine,
}: {
  tab: ProgramTab;
  verification: ReturnType<typeof useAsyncData<VerificationRow[] | null>>;
  scopeLine: string;
}) {
  const [view, setView] = React.useState<ChartView>("table");
  const rows = verification.data ?? [];
  const data = rows
    .filter((row) => row.factor !== null)
    .map((row) => ({ __x: row.key, __label: row.label, factor: Math.round(row.factor! * 1000) / 10 }));

  const columns: Column<VerificationRow>[] = [
    { key: "label", header: "Indicator", render: (row) => row.label, sortValue: (row) => row.label },
    {
      key: "source",
      header: "Source count",
      numeric: true,
      render: (row) => (row.source === null ? "—" : formatNumber(row.source)),
      sortValue: (row) => row.source ?? -1,
    },
    {
      key: "dhis2",
      header: "DHIS2 value",
      numeric: true,
      render: (row) => (row.dhis2 === null ? "—" : formatNumber(row.dhis2)),
      sortValue: (row) => row.dhis2 ?? -1,
    },
    {
      key: "factor",
      header: "Verification factor",
      numeric: true,
      render: (row) =>
        row.factor === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={cn("tabular-nums", Math.abs(row.factor - 1) > 0.1 && "font-medium text-critical")}>
            {formatPercent(row.factor * 100)}
          </span>
        ),
      sortValue: (row) => row.factor ?? -1,
    },
  ];

  return (
    <ChartFrame
      title="Verification factors"
      description={`DHIS2 value as a share of the source count · ${scopeLine}`}
      view={view}
      onViewChange={setView}
      onDownload={rows.length ? () => downloadCsv(verificationToCsv(rows), `${stamped(`${tab.slug}-verification`)}.csv`) : undefined}
      footnote={
        <span className="text-muted">
          For each indicator, the source counts of every assessment in scope are added up,
          the DHIS2 values likewise, and the factor is the one divided by the other: 100%
          means DHIS2 holds exactly what the registers hold, above it over-reporting, below
          it under-reporting. Never an average of per-facility factors. More than 10%
          either way is marked. An indicator with no source count has no factor.
        </span>
      }
    >
      {verification.error ? (
        <RejectedAlert title="The verification items could not be read" error={verification.error} />
      ) : verification.loading || !verification.data ? (
        <div className="flex justify-center py-10">
          <Spinner label="Reading the recount items" />
        </div>
      ) : view === "chart" ? (
        data.length ? (
          <CategoryBarChart
            data={data}
            series={FACTOR_SERIES}
            orientation="bars"
            height={Math.max(120, data.length * 30 + 40)}
            valueFormatter={(value) => `${formatNumber(value)}%`}
          />
        ) : (
          <p className="px-3 py-8 text-center text-sm text-muted">
            No assessment in scope recorded a source count, so there is no factor to draw.
          </p>
        )
      ) : (
        <DataTable columns={columns} rows={rows} maxHeight={480} emptyMessage="No recount items." />
      )}
    </ChartFrame>
  );
}

function EventsFrame({
  tab,
  events,
  page,
  onPage,
  highlight,
  nothingToList,
  metaError,
}: {
  tab: ProgramTab;
  events: ReturnType<typeof useAsyncData<EventPage | null>>;
  page: number;
  onPage: (page: number) => void;
  /** An item whose column is shown first, whatever its position in the form. */
  highlight: string | null;
  nothingToList: boolean;
  metaError: string | null;
}) {
  const data = events.data;
  const ordered = data
    ? [
        ...data.columns.filter((column) => column.id === highlight),
        ...data.columns.filter((column) => column.id !== highlight),
      ]
    : [];
  const shown = ordered.slice(0, MAX_COLUMNS);
  const hiddenColumns = Math.max(0, ordered.length - MAX_COLUMNS);
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? first + data.rows.length - 1 : 0;
  const hasNext = data
    ? data.pageCount !== null
      ? data.page < data.pageCount
      : data.rows.length === data.pageSize
    : false;

  const columns: Column<EventRecord>[] = [
    {
      key: "date",
      header: "Event date",
      render: (row) => <span className="tabular-nums">{eventDay(row.date)}</span>,
      sortValue: (row) => row.date,
      width: "7.5rem",
    },
    {
      key: "orgUnit",
      header: "Organisation unit",
      render: (row) => row.orgUnit,
      sortValue: (row) => row.orgUnit,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => row.status.toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      sortValue: (row) => row.status,
      width: "6.5rem",
    },
    ...shown.map(
      (column): Column<EventRecord> => ({
        key: column.id,
        header: column.name,
        render: (row) => (
          <span className={cn(column.id === highlight && "font-medium text-ink")}>
            {row.values[column.id] ?? ""}
          </span>
        ),
        sortValue: (row) => row.values[column.id] ?? "",
      }),
    ),
  ];

  return (
    <ChartFrame
      title="Events"
      description={
        data
          ? data.total !== null
            ? `${formatNumber(data.total)} events, most recently changed first`
            : "Most recently changed first"
          : "What each event recorded"
      }
      onDownload={data ? () => downloadCsv(eventsToCsv(data), `${stamped(`${tab.slug}-events-page-${data.page}`)}.csv`) : undefined}
      toolbar={
        data ? (
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <span className="tabular-nums">
              {data.rows.length ? `${first}–${last}` : "0"}
              {data.total !== null ? ` of ${formatNumber(data.total)}` : ""}
            </span>
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={!hasNext} onClick={() => onPage(page + 1)}>
              Next
            </Button>
          </div>
        ) : null
      }
      footnote={
        <span className="text-muted">
          One row per event, {PAGE_SIZE} to a page. Option values are shown by name.
          {highlight ? " The chosen item's column comes first." : ""}
          {hiddenColumns > 0
            ? ` The table shows ${MAX_COLUMNS} of ${ordered.length} data elements; the CSV of this page holds them all.`
            : ""}
        </span>
      }
    >
      {nothingToList ? (
        <Alert tone="error" title="Events cannot be listed">
          {metaError
            ? "The program's stage and data elements could not be read, and the catalogue has no items for this program, so there is nothing to list the values under."
            : "This program has no data elements to list."}
        </Alert>
      ) : events.error ? (
        <RejectedAlert title="The events could not be loaded" error={events.error} />
      ) : events.loading || !data ? (
        <div className="flex justify-center py-12">
          <Spinner label="Loading events" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={data.rows}
          maxHeight={560}
          emptyMessage="No events on this page."
        />
      )}
    </ChartFrame>
  );
}
