"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CircleHelp, Play, Plus, RotateCcw, Scale, X } from "lucide-react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { ComparisonScatter } from "@/components/charts/comparison-scatter";
import { Column, DataTable } from "@/components/charts/data-table";
import { MAX_SERIES } from "@/components/charts/palette";
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
  Input,
  Segmented,
  Select,
} from "@/components/ui/primitives";
import { dimensionValues, labelFor, type AnalyticsQuery } from "@/lib/dhis2/analytics";
import { fetchOrgUnitLevels, fetchOrgUnitNames } from "@/lib/dhis2/client";
import { findPeriodOption } from "@/lib/dhis2/periods";
import {
  EQUAL_RULE,
  RULE_LABELS,
  RULE_OPS,
  compareItems,
  compareMany,
  comparisonToCsv,
  differenceOverTime,
  flagLabels,
  hierarchyCell,
  hierarchyColumns,
  multiComparisonToCsv,
  ruleSymbol,
  ruleTolerance,
  type ComparisonRow,
  type MultiComparisonResult,
  type MultiComparisonRow,
  type PairCell,
  type PairRule,
  type PairSpec,
  type LevelOf,
  type QualityFlag,
  type RuleOp,
} from "@/lib/dhis2/quality";
import type { OrgUnitSelection } from "@/components/query/org-unit-picker";
import type { DimensionItem } from "@/lib/dhis2/types";
import { useAsyncData } from "@/lib/hooks";
import { formatNumber, formatPercent, formatPeriod, truncate } from "@/lib/format";
import { downloadCsv, stamped } from "@/lib/download";
import { cn } from "@/lib/utils";

export interface CompareState {
  /**
   * The slots, in order. The first filled slot is the reference; every other
   * filled slot is checked against it, and empty slots are ignored.
   */
  items: (DimensionItem | null)[];
  /** The rule every pair is held to, unless rules are set per pair. */
  rule: PairRule;
  perPair: boolean;
  /** Per-slot rules, aligned with `items`. The reference's entry is unused. */
  rules: (PairRule | null)[];
  periods: string[];
  orgUnits: OrgUnitSelection;
  aggregationType: string;
}

/** What may be in storage: the current shape, or one saved when Compare took exactly A and B. */
type StoredCompare = Partial<CompareState> & {
  a?: DimensionItem | null;
  b?: DimensionItem | null;
};

/** The fewest data elements a check needs, and the slots always on screen. */
const MIN_ITEMS = 2;

/**
 * A level of "AUTO" means the deepest level this server defines — the unit
 * that actually reports. A hardcoded LEVEL-4 would mean facility on one
 * server and sub-district on the next, so the number is resolved per server
 * rather than assumed.
 */
const AUTO_LEVEL = "AUTO";

const DEFAULT_COMPARE: CompareState = {
  items: [null, null],
  rule: EQUAL_RULE,
  perPair: false,
  rules: [],
  periods: ["LAST_12_MONTHS"],
  orgUnits: { units: [], level: AUTO_LEVEL, useUserOrgUnit: true },
  aggregationType: "DEFAULT",
};

function normalise(stored: StoredCompare): CompareState {
  const items = Array.isArray(stored.items)
    ? stored.items
    : [stored.a ?? null, stored.b ?? null];
  return {
    items:
      items.length >= MIN_ITEMS
        ? items
        : [...items, ...Array<null>(MIN_ITEMS - items.length).fill(null)],
    rule: stored.rule ?? EQUAL_RULE,
    perPair: stored.perPair ?? false,
    rules: Array.isArray(stored.rules) ? stored.rules : [],
    periods: stored.periods ?? DEFAULT_COMPARE.periods,
    orgUnits: stored.orgUnits ?? DEFAULT_COMPARE.orgUnits,
    aggregationType: stored.aggregationType ?? DEFAULT_COMPARE.aggregationType,
  };
}

/** The filled slots, first occurrence of each item only. */
function selectedItems(state: CompareState): DimensionItem[] {
  const seen = new Set<string>();
  return state.items.filter((item): item is DimensionItem => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** Per-pair rules only mean something once there is more than one pair. */
function usesPerPair(state: CompareState): boolean {
  return state.perPair && state.items.length > MIN_ITEMS;
}

function ruleFor(state: CompareState, id: string): PairRule {
  if (!usesPerPair(state)) return state.rule;
  const slot = state.items.findIndex((item) => item?.id === id);
  return (slot >= 0 ? state.rules[slot] : null) ?? state.rule;
}

function slotLetter(slot: number): string {
  return slot < 26 ? String.fromCharCode(65 + slot) : String(slot + 1);
}

/** Entity colour by position among the chosen items; there is no ninth colour. */
function keyColor(index: number): string {
  return index < MAX_SERIES ? `var(--series-${index + 1})` : "var(--muted)";
}

function resolveLevel(level: string, deepest: string): string {
  return level === AUTO_LEVEL ? deepest : level;
}

function buildQuery(state: CompareState, deepest: string): AnalyticsQuery {
  return {
    dx: selectedItems(state).map((item) => item.id),
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

/** How to read the scatter under a rule. The diagonal is always equality. */
function scatterDescription(rule: PairRule): string {
  switch (rule.op) {
    case "gte":
      return "One point per organisation unit. The diagonal is equality: points on or above it pass (A ≥ B), points below it break the rule.";
    case "lte":
      return "One point per organisation unit. The diagonal is equality: points on or below it pass (A ≤ B), points above it break the rule.";
    case "within":
      return `One point per organisation unit. The diagonal is equality: points within ±${ruleTolerance(rule)}% of it pass.`;
    default:
      return "One point per organisation unit. Anything off the diagonal is a unit where the two disagree.";
  }
}

type TrendView = "levels" | "difference";

/**
 * Checks whether data elements that should hold the same number actually do,
 * and lists every reporting unit where they do not.
 *
 * The pairs this is for are the ones where a difference is a defect rather
 * than a finding: suspected malaria cases against suspected cases tested, a
 * register count against its summary, doses issued against doses recorded.
 * With more than two, the first is the reference and each of the others is
 * checked against it.
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
    (state: StoredCompare) => buildQuery(normalise(state), deepestLevel),
    [deepestLevel],
  );

  const {
    query: stored,
    setQuery,
    hydrated,
    result,
    resultQuery,
    error,
    running,
    dirty,
    run,
  } = useAnalyticsSession<StoredCompare>("dhis2.compare.query", DEFAULT_COMPARE, toQuery);
  const query = React.useMemo(() => normalise(stored), [stored]);

  const [trendView, setTrendView] = React.useState<TrendView>("levels");
  const [problemsOnly, setProblemsOnly] = React.useState(false);
  const [pairFilter, setPairFilter] = React.useState<number | null>(null);

  /* ------------------------------------------------------------ shaping */

  // What is compared is read back from the request that produced the result,
  // so a half-edited selection never relabels a table drawn from the previous
  // query. Only the rules come from the current selection: they need no new
  // request, so changing one re-judges the result straight away.
  const returned = React.useMemo(
    () => (result ? dimensionValues(result, "dx", "total") : []),
    [result],
  );
  const ranIds = React.useMemo(() => resultQuery?.dx ?? [], [resultQuery]);
  const referenceId = ranIds[0];
  const multi = ranIds.length > MIN_ITEMS;

  const pairSpecs = React.useMemo<PairSpec[]>(
    () => ranIds.slice(1).map((id) => ({ id, rule: ruleFor(query, id) })),
    [ranIds, query],
  );

  const nameOf = (id: string | undefined, fallback: string) => {
    if (!id) return fallback;
    if (result && returned.includes(id)) return labelFor(result, id);
    return query.items.find((item) => item?.id === id)?.displayName ?? id;
  };

  // Two items: the check as it has always been, one pair, A against B.
  const pairRule = pairSpecs[0]?.rule ?? EQUAL_RULE;
  const aId = !multi && referenceId && returned.includes(referenceId) ? referenceId : undefined;
  const bId =
    !multi && pairSpecs[0] && returned.includes(pairSpecs[0].id) ? pairSpecs[0].id : undefined;
  const ready = Boolean(result && aId && bId);

  const aName = nameOf(referenceId, query.items[0]?.displayName ?? "A");
  const bName = nameOf(pairSpecs[0]?.id, query.items[1]?.displayName ?? "B");
  const labels = flagLabels(multi ? pairSpecs.map((pair) => pair.rule) : [pairRule]);

  const comparison = React.useMemo(() => {
    if (!result || !aId || !bId) return null;
    return compareItems(result, { aId, bId, rule: pairRule });
  }, [result, aId, bId, pairRule]);

  const overTime = React.useMemo(() => {
    if (!result || !aId || !bId) return [];
    return differenceOverTime(result, aId, bId);
  }, [result, aId, bId]);

  // Three or more: every other item against the reference.
  const otherNames = pairSpecs.map((pair) => nameOf(pair.id, pair.id));
  const missingOthers = pairSpecs.filter((pair) => !returned.includes(pair.id));
  const referenceMissing = Boolean(multi && result && !returned.includes(referenceId));
  const multiReady =
    multi && Boolean(result) && !referenceMissing && missingOthers.length < pairSpecs.length;

  const multiComparison = React.useMemo(() => {
    if (!result || !multiReady) return null;
    return compareMany(result, { referenceId, pairs: pairSpecs });
  }, [result, multiReady, referenceId, pairSpecs]);

  // The pair the charts follow: the one filtered to, or the first.
  const focus = pairFilter !== null && pairFilter < pairSpecs.length ? pairFilter : null;
  const focusIndex = focus ?? 0;

  const pairTrends = React.useMemo(() => {
    if (!result || !multiComparison) return [];
    return multiComparison.pairs.map((pair) => differenceOverTime(result, referenceId, pair.id));
  }, [result, multiComparison, referenceId]);

  /* ------------------------------------------------------- the hierarchy */

  const findingRows: { ancestors: string[]; name: string }[] = React.useMemo(
    () => multiComparison?.rows ?? comparison?.rows ?? [],
    [multiComparison, comparison],
  );

  // Analytics names the units it returns but hands back their ancestors as
  // bare ids, so region and district names need a second lookup.
  const ancestorIds = React.useMemo(
    () => [...new Set(findingRows.flatMap((row) => row.ancestors))],
    [findingRows],
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

  // The real level of each ancestor, so headings start at the query's root.
  const levelOf = React.useCallback(
    (id: string) => ancestors?.get(id)?.level,
    [ancestors],
  );

  // Named the way the server names its own levels, and trimmed to the ones
  // that actually vary across the findings.
  const levelColumns = React.useMemo(() => {
    const names = new Map((levels ?? []).map((level) => [level.level, level.displayName]));
    return hierarchyColumns(
      findingRows,
      (level) => names.get(level) ?? `Level ${level}`,
      levelOf,
    );
  }, [findingRows, levels, levelOf]);

  const visibleRows = React.useMemo(() => {
    const rows = comparison?.rows ?? [];
    return problemsOnly ? rows.filter((row) => row.flag !== "match") : rows;
  }, [comparison, problemsOnly]);

  const visibleMultiRows = React.useMemo(() => {
    let rows = multiComparison?.rows ?? [];
    if (focus !== null) rows = rows.filter((row) => row.failed.includes(focus));
    return problemsOnly ? rows.filter((row) => row.flag !== "match") : rows;
  }, [multiComparison, focus, problemsOnly]);

  // Levels: every item, in the order chosen, which is the order of their
  // colours — capped at the palette, never cycled. Difference: the focused pair.
  const multiLevelIds = [referenceId, ...pairSpecs.map((pair) => pair.id)].slice(0, MAX_SERIES);
  const hiddenSeries = Math.max(0, pairSpecs.length + 1 - MAX_SERIES);

  const trendData = React.useMemo(() => {
    if (multi) {
      const periods = pairTrends[0] ?? [];
      return periods.map((point, index) => ({
        __x: point.period,
        __label: formatPeriod(point.period),
        ...(trendView === "levels"
          ? Object.fromEntries([
              [referenceId, point.a],
              ...pairTrends.map((trend, pair) => [pairSpecs[pair].id, trend[index]?.b ?? 0]),
            ])
          : { difference: pairTrends[focusIndex]?.[index]?.difference ?? 0 }),
      }));
    }
    return overTime.map((point) => ({
      __x: point.period,
      __label: formatPeriod(point.period),
      ...(trendView === "levels"
        ? { [aId!]: point.a, [bId!]: point.b }
        : { difference: point.difference }),
    }));
  }, [multi, pairTrends, pairSpecs, referenceId, focusIndex, overTime, trendView, aId, bId]);

  const trendSeries =
    trendView === "levels"
      ? multi
        ? multiLevelIds.map((id) => ({ id, name: nameOf(id, id) }))
        : [
            { id: aId ?? "a", name: aName },
            { id: bId ?? "b", name: bName },
          ]
      : [
          {
            id: "difference",
            name: multi ? `${aName} minus ${otherNames[focusIndex]}` : "A minus B",
          },
        ];

  const missingSide = result && !multi && !ready ? (aId ? bName : aName) : null;

  /* ----------------------------------------------------------- selection */

  const selected = selectedItems(query);
  const perPair = usesPerPair(query);
  const referenceSlot = query.items.findIndex((item) => item !== null);

  const setSlot = (slot: number, item: DimensionItem | null) =>
    setQuery({ ...query, items: query.items.map((current, index) => (index === slot ? item : current)) });

  const addSlot = () =>
    setQuery({ ...query, items: [...query.items, null], rules: [...query.rules, null] });

  const removeSlot = (slot: number) =>
    setQuery({
      ...query,
      items: query.items.filter((_, index) => index !== slot),
      rules: query.items.map((_, index) => query.rules[index] ?? null).filter((_, index) => index !== slot),
    });

  const setSlotRule = (slot: number, rule: PairRule) =>
    setQuery({
      ...query,
      rules: query.items.map((_, index) => (index === slot ? rule : (query.rules[index] ?? null))),
    });

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

  const enoughItems = selected.length >= MIN_ITEMS;
  const canRun = Boolean(
    enoughItems &&
      query.periods.length &&
      buildQuery(query, deepestLevel).ou.length &&
      // Wait for the level list before running, or "deepest" has no meaning.
      (query.orgUnits.level !== AUTO_LEVEL || deepestLevel),
  );

  const selectionSummary =
    selected.length === 2
      ? `${truncate(selected[0].displayName, 18)} vs ${truncate(selected[1].displayName, 18)}`
      : selected.length > 2
        ? `${truncate(selected[0].displayName, 18)} vs ${selected.length - 1} others`
        : "Choose at least two that should carry the same number";

  return (
    <div className="grid gap-5 lg:grid-cols-[336px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="flex flex-col gap-3">
          <Section title="Data elements" summary={selectionSummary} defaultOpen>
            <div className="space-y-4">
              {query.items.map((item, slot) => {
                const colorIndex = query.items
                  .slice(0, slot)
                  .filter((earlier) => earlier !== null).length;
                const isReference = slot === referenceSlot;
                const letter = slotLetter(slot);
                return (
                  <div key={slot} className="space-y-2">
                    <DataItemSlot
                      label={`Data element ${letter}${
                        isReference && query.items.length > MIN_ITEMS ? " · reference" : ""
                      }`}
                      keyColor={keyColor(colorIndex)}
                      value={item}
                      exclude={selected
                        .filter((chosen) => chosen.id !== item?.id)
                        .map((chosen) => chosen.id)}
                      onChange={(next) => setSlot(slot, next)}
                      action={
                        slot >= MIN_ITEMS ? (
                          <button
                            type="button"
                            onClick={() => removeSlot(slot)}
                            className="shrink-0 rounded-md p-0.5 text-muted hover:text-critical"
                            title={`Remove data element ${letter}`}
                          >
                            <X className="size-3.5" aria-hidden />
                            <span className="sr-only">Remove data element {letter}</span>
                          </button>
                        ) : null
                      }
                    />
                    {perPair && item && !isReference ? (
                      <RuleControl
                        label={`Rule for ${slotLetter(referenceSlot)} vs ${letter}`}
                        a={slotLetter(Math.max(referenceSlot, 0))}
                        b={letter}
                        rule={query.rules[slot] ?? query.rule}
                        onChange={(rule) => setSlotRule(slot, rule)}
                      />
                    ) : null}
                  </div>
                );
              })}

              <Button variant="ghost" className="w-full" onClick={addSlot}>
                <Plus className="size-3.5" aria-hidden />
                Add data element
              </Button>

              <div className="space-y-2 border-t border-hair pt-3">
                {!perPair ? (
                  <RuleControl
                    label={query.items.length > MIN_ITEMS ? "Rule for every pair" : "Rule"}
                    a="A"
                    b="B"
                    rule={query.rule}
                    onChange={(rule) => setQuery({ ...query, rule })}
                  />
                ) : null}
                {query.items.length > MIN_ITEMS ? (
                  <Checkbox
                    label={<span className="text-xs text-ink-2">Set the rule per pair</span>}
                    checked={query.perPair}
                    onChange={(event) =>
                      setQuery({
                        ...query,
                        perPair: event.target.checked,
                        rules: query.items.map((_, index) => query.rules[index] ?? query.rule),
                      })
                    }
                  />
                ) : null}
                <p className="text-xs text-muted">
                  {query.items.length > MIN_ITEMS
                    ? "The first data element is the reference; each of the others is checked against it. A unit is reported when any pair breaks its rule."
                    : query.rule.op === "eq"
                      ? "Every unit where the two do not hold exactly the same number is reported."
                      : "Every unit where the two break the rule is reported."}
                </p>
              </div>
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

          {!enoughItems ? (
            <p className="text-xs text-ink-2">Select at least 2 data elements.</p>
          ) : !canRun ? (
            <p className="text-xs text-ink-2">Choose a period and an organisation unit.</p>
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
              Pick two or more data elements that should hold the same number — suspected
              malaria cases and suspected cases tested, a register count and its
              summary — and this page lists every organisation unit where they do not.
            </EmptyState>
          </div>
        ) : result.isEmpty ? (
          <Alert title="The query returned no values">
            DHIS2 answered successfully but had nothing for this combination. Widen the
            period or pick a higher organisation unit.
          </Alert>
        ) : multi ? (
          referenceMissing ? (
            <Alert tone="error" title="The reference data element returned no data">
              {aName} has no values anywhere in this selection, so there is nothing to
              check the others against. Confirm it is captured for this period and these
              units, or put a different data element first.
            </Alert>
          ) : !multiComparison ? (
            <Alert tone="error" title="Only the reference returned data">
              None of the other data elements has values anywhere in this selection, so
              there is nothing to check {aName} against.
            </Alert>
          ) : (
            <MultiResults
              comparison={multiComparison}
              aName={aName}
              otherNames={otherNames}
              missingOthers={missingOthers.map((pair) => nameOf(pair.id, pair.id))}
              labels={labels}
              focusIndex={focusIndex}
              trend={
                pairTrends[0] && pairTrends[0].length > 1 ? (
                  <TrendChart
                    view={trendView}
                    onViewChange={setTrendView}
                    data={trendData}
                    series={trendSeries}
                    levelsNote={
                      hiddenSeries
                        ? `Every data element summed across the selected units. The first ${MAX_SERIES} are drawn; ${hiddenSeries} more are in the table.`
                        : "Every data element summed across the selected units."
                    }
                    differenceNote={`${aName} minus ${otherNames[focusIndex]} in each period. Anything away from zero is a period where the two did not agree.`}
                  />
                ) : null
              }
              table={
                <MultiFindingsTable
                  comparison={multiComparison}
                  rows={visibleMultiRows}
                  levelColumns={levelColumns}
                  unnamedLevels={unnamedLevels}
                  resolve={resolve}
                  levelOf={levelOf}
                  aName={aName}
                  otherNames={otherNames}
                  labels={labels}
                  focus={focus}
                  onFocusChange={setPairFilter}
                  problemsOnly={problemsOnly}
                  onProblemsOnlyChange={setProblemsOnly}
                  onDownload={() =>
                    downloadCsv(
                      multiComparisonToCsv(
                        multiComparison,
                        { reference: aName, others: otherNames, levels: levelColumns, levelOf },
                        resolve,
                      ),
                      `${stamped("dhis2-comparison")}.csv`,
                    )
                  }
                />
              }
            />
          )
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
                label={pairRule.op === "eq" ? "Units matching" : "Units passing"}
                value={comparison.summary.matched}
                hint={
                  comparison.summary.matchRate === null
                    ? "Nothing comparable"
                    : `of ${comparison.summary.comparable} comparable · ${comparison.summary.matchRate.toFixed(0)}%`
                }
              />
            </section>

            <FindingsStrip
              labels={labels}
              counts={{
                mismatch: comparison.summary.mismatched,
                missing: comparison.summary.incomplete,
                match: comparison.summary.matched,
              }}
            />

            {comparison.summary.unitCount <= 1 ? <SingleUnitAlert /> : null}

            <ChartFrame
              title={`${truncate(aName, 30)} against ${truncate(bName, 30)}`}
              description={scatterDescription(pairRule)}
            >
              <ComparisonScatter rows={comparison.rows} aName={aName} bName={bName} />
            </ChartFrame>

            {overTime.length > 1 ? (
              <TrendChart
                view={trendView}
                onViewChange={setTrendView}
                data={trendData}
                series={trendSeries}
                levelsNote="Both data elements summed across the selected units."
                differenceNote="A minus B in each period. Anything away from zero is a period where the two did not agree."
              />
            ) : null}

            <FindingsTable
              rows={visibleRows}
              totalRows={comparison.rows.length}
              levelColumns={levelColumns}
              unnamedLevels={unnamedLevels}
              resolve={resolve}
              levelOf={levelOf}
              aName={aName}
              bName={bName}
              labels={labels}
              rule={pairRule}
              problemsOnly={problemsOnly}
              onProblemsOnlyChange={setProblemsOnly}
              onDownload={() =>
                downloadCsv(
                  comparisonToCsv(
                    comparison,
                    { a: aName, b: bName, levels: levelColumns, levelOf },
                    resolve,
                    labels,
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

/* ---------------------------------------------------------------- rules */

function RuleControl({
  label,
  a,
  b,
  rule,
  onChange,
}: {
  label: string;
  /** The letters the options name the two sides by. */
  a: string;
  b: string;
  rule: PairRule;
  onChange: (rule: PairRule) => void;
}) {
  const name = (op: RuleOp) => RULE_LABELS[op].replace(/\bA\b/, a).replace(/\bB\b/, b);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-2">{label}</p>
      <div className="flex items-center gap-2">
        <Select
          className="h-8 min-w-0 flex-1 text-xs"
          aria-label={label}
          value={rule.op}
          onChange={(event) => {
            const op = event.target.value as RuleOp;
            onChange(op === "within" ? { op, tolerance: rule.tolerance ?? 10 } : { op });
          }}
        >
          {RULE_OPS.map((op) => (
            <option key={op} value={op}>
              {name(op)}
            </option>
          ))}
        </Select>
        {rule.op === "within" ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-ink-2">
            ±
            <Input
              type="number"
              min={0}
              step="any"
              className="h-8 w-16 text-xs"
              value={rule.tolerance ?? 0}
              aria-label={`${label}: allowed gap in percent`}
              onChange={(event) =>
                onChange({
                  op: "within",
                  tolerance: event.target.value === "" ? 0 : Number(event.target.value),
                })
              }
            />
            %
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- charts */

function SingleUnitAlert() {
  return (
    <Alert title="Only one organisation unit in this result">
      The check runs per reporting unit. Set{" "}
      <strong className="text-ink">Break down by level</strong> in the
      organisation unit picker to get districts or facilities.
    </Alert>
  );
}

function TrendChart({
  view,
  onViewChange,
  data,
  series,
  levelsNote,
  differenceNote,
}: {
  view: TrendView;
  onViewChange: (view: TrendView) => void;
  data: Record<string, string | number | null>[];
  series: { id: string; name: string }[];
  levelsNote: string;
  differenceNote: string;
}) {
  return (
    <ChartFrame
      title="Over time"
      description={view === "levels" ? levelsNote : differenceNote}
      toolbar={
        <Segmented
          ariaLabel="What to plot over time"
          value={view}
          onChange={onViewChange}
          options={[
            { value: "levels", label: "Levels" },
            { value: "difference", label: "Difference" },
          ]}
        />
      }
      legend={
        view === "levels" ? (
          <ul className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
            {series.map((item, index) => (
              <li key={item.id} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-0.5 w-4 rounded-full"
                  style={{ background: keyColor(index) }}
                />
                <span className="truncate">{item.name}</span>
              </li>
            ))}
          </ul>
        ) : null
      }
    >
      <TimeSeriesChart
        data={data}
        series={series}
        referenceValue={view === "difference" ? 0 : null}
        referenceLabel={view === "difference" ? "Agree" : undefined}
      />
    </ChartFrame>
  );
}

function MultiResults({
  comparison,
  aName,
  otherNames,
  missingOthers,
  labels,
  focusIndex,
  trend,
  table,
}: {
  comparison: MultiComparisonResult;
  aName: string;
  otherNames: string[];
  missingOthers: string[];
  labels: Record<QualityFlag, string>;
  focusIndex: number;
  trend: React.ReactNode;
  table: React.ReactNode;
}) {
  const { summary } = comparison;
  const focused = comparison.pairs[focusIndex];

  return (
    <>
      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={aName} value={summary.totalReference} hint="Total for the reference" />
        <StatTile
          label="Pairs checked"
          value={comparison.pairs.length}
          hint={`Each against ${truncate(aName, 24)}`}
        />
        <StatTile
          label="Units flagged"
          value={summary.flagged}
          hint="At least one pair broke its rule"
        />
        <StatTile
          label="Units passing"
          value={summary.passed}
          hint={`of ${summary.unitCount} · every pair passed`}
        />
      </section>

      <FindingsStrip
        labels={labels}
        counts={{ mismatch: summary.flagged, missing: summary.incomplete, match: summary.passed }}
      />

      {missingOthers.length ? (
        <Alert title="Some data elements returned no data">
          {missingOthers.join(", ")} {missingOthers.length === 1 ? "has" : "have"} no values
          anywhere in this selection, so every unit is incomplete for{" "}
          {missingOthers.length === 1 ? "that pair" : "those pairs"}.
        </Alert>
      ) : null}

      {summary.unitCount <= 1 ? <SingleUnitAlert /> : null}

      <ChartFrame
        title={`${truncate(aName, 30)} against ${truncate(otherNames[focusIndex], 30)}`}
        description={`${scatterDescription(focused.rule)} ${
          comparison.pairs.length > 1
            ? "Filter the findings to a pair to plot that pair here."
            : ""
        }`.trim()}
      >
        <ComparisonScatter
          rows={focused.result.rows}
          aName={aName}
          bName={otherNames[focusIndex]}
        />
      </ChartFrame>

      {trend}
      {table}
    </>
  );
}

function PairFilter({
  comparison,
  otherNames,
  focus,
  onChange,
}: {
  comparison: MultiComparisonResult;
  otherNames: string[];
  focus: number | null;
  onChange: (pair: number | null) => void;
}) {
  return (
    <Select
      className="h-8 w-56 text-xs"
      aria-label="Filter by pair"
      value={focus === null ? "" : String(focus)}
      onChange={(event) =>
        onChange(event.target.value === "" ? null : Number(event.target.value))
      }
    >
      <option value="">All pairs</option>
      {comparison.pairs.map((pair, index) => (
        <option key={pair.id} value={index}>
          {`Broke: vs ${truncate(otherNames[index], 24)} (${ruleSymbol(pair.rule)}) · ${comparison.summary.failuresByPair[index]}`}
        </option>
      ))}
    </Select>
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

function FindingsStrip({
  counts,
  labels,
}: {
  counts: Record<QualityFlag, number>;
  labels: Record<QualityFlag, string>;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {(["mismatch", "missing", "match"] as QualityFlag[]).map((flag) => {
        const { icon: Icon, className } = FLAG_STYLE[flag];
        return (
          <li key={flag}>
            <Badge>
              <Icon className={cn("size-3.5", className)} aria-hidden />
              <span className="tabular-nums">{counts[flag]}</span>
              <span className="font-normal text-muted">{labels[flag]}</span>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function FlagCell({ flag, labels }: { flag: QualityFlag; labels: Record<QualityFlag, string> }) {
  const { icon: Icon, className } = FLAG_STYLE[flag];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden />
      {labels[flag]}
    </span>
  );
}

function FindingsTable({
  rows,
  totalRows,
  levelColumns,
  unnamedLevels,
  resolve,
  levelOf,
  aName,
  bName,
  labels,
  rule,
  problemsOnly,
  onProblemsOnlyChange,
  onDownload,
}: {
  rows: ComparisonRow[];
  totalRows: number;
  levelColumns: { level: number; label: string }[];
  unnamedLevels: boolean;
  resolve: (id: string) => string;
  levelOf: LevelOf;
  aName: string;
  bName: string;
  labels: Record<QualityFlag, string>;
  rule: PairRule;
  problemsOnly: boolean;
  onProblemsOnlyChange: (value: boolean) => void;
  onDownload: () => void;
}) {
  const columns: Column<ComparisonRow>[] = [
    ...levelColumns.map((column) => ({
      key: `level-${column.level}`,
      header: column.label,
      render: (row: ComparisonRow) => hierarchyCell(row, column, resolve, levelOf),
      sortValue: (row: ComparisonRow) => hierarchyCell(row, column, resolve, levelOf),
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
      render: (row) => <DifferenceText difference={row.difference} flag={row.flag} />,
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
      render: (row) => <FlagCell flag={row.flag} labels={labels} />,
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
              ? rule.op === "eq"
                ? "Every unit reported the same number for both data elements."
                : "Every unit passed the rule."
              : "No values to show."
          }
        />
      </div>
    </ChartFrame>
  );
}

/** A difference, red only where it broke the rule; under equality that is any non-zero one. */
function DifferenceText({
  difference,
  flag,
}: {
  difference: number | null;
  flag: QualityFlag;
}) {
  if (difference === null) return "–";
  if (difference === 0) return <span className="text-muted">0</span>;
  return (
    <span className={flag === "mismatch" ? "font-medium text-critical" : "text-ink-2"}>
      {difference > 0 ? "+" : ""}
      {formatNumber(difference)}
    </span>
  );
}

function PairValue({ cell, label }: { cell: PairCell; label: string }) {
  const { icon: Icon, className } = FLAG_STYLE[cell.flag];
  return (
    <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap" title={cell.note}>
      <span>{formatNumber(cell.value)}</span>
      <span className="text-xs">
        <DifferenceText difference={cell.difference} flag={cell.flag} />
      </span>
      <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function MultiFindingsTable({
  comparison,
  rows,
  levelColumns,
  unnamedLevels,
  resolve,
  levelOf,
  aName,
  otherNames,
  labels,
  focus,
  onFocusChange,
  problemsOnly,
  onProblemsOnlyChange,
  onDownload,
}: {
  comparison: MultiComparisonResult;
  rows: MultiComparisonRow[];
  levelColumns: { level: number; label: string }[];
  unnamedLevels: boolean;
  resolve: (id: string) => string;
  levelOf: LevelOf;
  aName: string;
  otherNames: string[];
  labels: Record<QualityFlag, string>;
  focus: number | null;
  onFocusChange: (pair: number | null) => void;
  problemsOnly: boolean;
  onProblemsOnlyChange: (value: boolean) => void;
  onDownload: () => void;
}) {
  const totalRows = comparison.rows.length;
  const columns: Column<MultiComparisonRow>[] = [
    ...levelColumns.map((column) => ({
      key: `level-${column.level}`,
      header: column.label,
      render: (row: MultiComparisonRow) => hierarchyCell(row, column, resolve, levelOf),
      sortValue: (row: MultiComparisonRow) => hierarchyCell(row, column, resolve, levelOf),
    })),
    {
      key: "reference",
      header: truncate(aName, 26),
      numeric: true,
      render: (row) => formatNumber(row.reference),
      sortValue: (row) => row.reference ?? -Infinity,
    },
    ...comparison.pairs.map((pair, index) => ({
      key: `pair-${index}`,
      header: `vs ${truncate(otherNames[index], 22)} (${ruleSymbol(pair.rule)})`,
      numeric: true,
      render: (row: MultiComparisonRow) => (
        <PairValue cell={row.pairs[index]} label={labels[row.pairs[index].flag]} />
      ),
      sortValue: (row: MultiComparisonRow) => Math.abs(row.pairs[index].difference ?? 0),
    })),
    {
      key: "failed",
      header: "Failed pairs",
      render: (row) =>
        row.failed.length ? (
          <span className="text-critical">
            {row.failed.map((index) => truncate(otherNames[index], 22)).join(", ")}
          </span>
        ) : (
          <span className="text-muted">–</span>
        ),
      sortValue: (row) => row.failed.length,
    },
    {
      key: "flag",
      header: "Finding",
      render: (row) => <FlagCell flag={row.flag} labels={labels} />,
      sortValue: (row) => row.flag,
    },
  ];

  return (
    <ChartFrame
      title="Findings by organisation unit"
      description={`Worst first. ${totalRows.toLocaleString()} unit${totalRows === 1 ? "" : "s"} checked against ${truncate(aName, 30)}. Each pair column shows the other data element's value, the reference minus it, and whether the pair passed.${
        unnamedLevels
          ? " This server did not name its hierarchy levels, so the columns are numbered."
          : ""
      }`}
      onDownload={onDownload}
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          <PairFilter
            comparison={comparison}
            otherNames={otherNames}
            focus={focus}
            onChange={onFocusChange}
          />
          <Checkbox
            label={<span className="text-xs text-ink-2">Only show problems</span>}
            checked={problemsOnly}
            onChange={(event) => onProblemsOnlyChange(event.target.checked)}
          />
        </div>
      }
    >
      <div className="px-3">
        <DataTable
          columns={columns}
          rows={rows}
          caption="Every organisation unit checked, with its region and district"
          maxHeight={560}
          emptyMessage={
            focus !== null
              ? `No unit broke the pair against ${otherNames[focus]}.`
              : problemsOnly
                ? "Every unit passed every pair."
                : "No values to show."
          }
        />
      </div>
    </ChartFrame>
  );
}
