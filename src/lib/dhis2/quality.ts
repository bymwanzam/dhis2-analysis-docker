/**
 * Pairwise data quality: do two data elements agree?
 *
 * The default check is equality. Some pairs of data elements are supposed to carry
 * the same number — suspected malaria cases against suspected cases tested,
 * a register count against its summary, doses issued against doses recorded —
 * and anywhere the two disagree, one of them is wrong.
 *
 * Nothing here judges a unit against the rest of the data: a facility where
 * both numbers are 40 passes, and a facility reporting 300 against 280 fails,
 * however normal that gap looks across the region.
 *
 * A pair can be held to a looser rule instead (A at least B, A at most B, or
 * A within a stated percentage of B), and several data elements can be checked
 * against one reference at once (`compareMany`), each pair under its own rule.
 */
import { dimensionValues, labelFor, type ParsedAnalytics } from "./analytics";

/**
 * Why a unit was reported. Ordered by how much it should worry the reader:
 * a disagreement is a certainty, a gap is unknown, agreement is the goal.
 */
export type QualityFlag = "mismatch" | "missing" | "match";

export const FLAG_ORDER: QualityFlag[] = ["mismatch", "missing", "match"];

export const FLAG_LABELS: Record<QualityFlag, string> = {
  mismatch: "Does not match",
  missing: "Incomplete",
  match: "Matches",
};

/**
 * What a pair has to satisfy. A is always the reference, B the item checked
 * against it. "within" compares the gap, the difference as a percentage of the
 * larger of the two, against `tolerance`.
 */
export type RuleOp = "eq" | "gte" | "lte" | "within";

export interface PairRule {
  op: RuleOp;
  /** Allowed gap in percent, for "within". */
  tolerance?: number;
}

export const EQUAL_RULE: PairRule = { op: "eq" };

export const RULE_OPS: RuleOp[] = ["eq", "gte", "lte", "within"];

export const RULE_LABELS: Record<RuleOp, string> = {
  eq: "A = B exactly",
  gte: "A ≥ B",
  lte: "A ≤ B",
  within: "A within ±X% of B",
};

/** The tolerance a "within" rule actually applies: never negative, never NaN. */
export function ruleTolerance(rule: PairRule): number {
  const value = Number(rule.tolerance ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The rule as a short symbol, for column headings: "=", "≥", "≤", "±5%". */
export function ruleSymbol(rule: PairRule): string {
  if (rule.op === "gte") return "≥";
  if (rule.op === "lte") return "≤";
  if (rule.op === "within") return `±${ruleTolerance(rule)}%`;
  return "=";
}

/**
 * Finding labels. Under equality the words are about agreeing; under any
 * other rule two different numbers can pass, so "Matches" would be untrue.
 */
export const RULE_FLAG_LABELS: Record<QualityFlag, string> = {
  mismatch: "Breaks the rule",
  missing: "Incomplete",
  match: "Passes",
};

export function flagLabels(rules: PairRule[]): Record<QualityFlag, string> {
  return rules.every((rule) => rule.op === "eq") ? FLAG_LABELS : RULE_FLAG_LABELS;
}

export interface ComparisonRow {
  id: string;
  name: string;
  /** Ancestor ids above this unit, root first. Empty when not requested. */
  ancestors: string[];
  a: number | null;
  b: number | null;
  /** A minus B, where both were reported. */
  difference: number | null;
  /** The gap as a percentage of the larger of the two. */
  gap: number | null;
  flag: QualityFlag;
  note: string;
}

export interface ComparisonSummary {
  totalA: number;
  totalB: number;
  /** Total A minus total B across everything compared. */
  totalDifference: number;
  unitCount: number;
  /** Units where both items were reported. */
  comparable: number;
  matched: number;
  mismatched: number;
  incomplete: number;
  /** Share of comparable units where the two agree, as a percentage. */
  matchRate: number | null;
  /** The largest single disagreement, by absolute value. */
  largestGap: number;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  summary: ComparisonSummary;
}

export interface CompareOptions {
  aId: string;
  bId: string;
  /** Which dimension each row represents. Organisation unit by default. */
  dimension?: string;
  /** What A and B have to satisfy. Exact equality by default. */
  rule?: PairRule;
  /**
   * Treat a unit that reported neither item as agreeing rather than as
   * incomplete. Off by default: silence is not a matching pair.
   */
  ignoreEmptyUnits?: boolean;
}

export function compareItems(
  parsed: ParsedAnalytics,
  options: CompareOptions,
): ComparisonResult {
  const {
    aId,
    bId,
    dimension = "ou",
    ignoreEmptyUnits = false,
    rule = EQUAL_RULE,
  } = options;

  const units = dimensionValues(parsed, dimension, "name");
  const aValues = new Map<string, number>();
  const bValues = new Map<string, number>();

  for (const row of parsed.rows) {
    const unit = String(row[dimension] ?? "");
    if (!unit) continue;
    const item = String(row.dx ?? "");
    if (item === aId) aValues.set(unit, (aValues.get(unit) ?? 0) + row.value);
    else if (item === bId) bValues.set(unit, (bValues.get(unit) ?? 0) + row.value);
  }

  const rows: ComparisonRow[] = [];

  for (const unit of units) {
    const a = aValues.has(unit) ? aValues.get(unit)! : null;
    const b = bValues.has(unit) ? bValues.get(unit)! : null;
    if (ignoreEmptyUnits && a === null && b === null) continue;

    const difference = a !== null && b !== null ? a - b : null;
    const largest = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
    const gap =
      difference !== null && largest > 0 ? (Math.abs(difference) / largest) * 100 : null;

    rows.push({
      id: unit,
      name: labelFor(parsed, unit),
      ancestors: parsed.hierarchy[unit] ?? [],
      a,
      b,
      difference,
      gap,
      ...judge(a, b, difference, gap, rule),
    });
  }

  const totalA = sum([...aValues.values()]);
  const totalB = sum([...bValues.values()]);

  const matched = rows.filter((row) => row.flag === "match").length;
  const mismatched = rows.filter((row) => row.flag === "mismatch").length;
  const incomplete = rows.filter((row) => row.flag === "missing").length;
  const comparable = matched + mismatched;

  return {
    // Disagreements first, largest first — the reader should not have to hunt
    // for the rows that made them open this page.
    rows: [...rows].sort(bySeverity),
    summary: {
      totalA,
      totalB,
      totalDifference: totalA - totalB,
      unitCount: rows.length,
      comparable,
      matched,
      mismatched,
      incomplete,
      matchRate: comparable > 0 ? (matched / comparable) * 100 : null,
      largestGap: rows.reduce(
        (worst, row) => Math.max(worst, Math.abs(row.difference ?? 0)),
        0,
      ),
    },
  };
}

function judge(
  a: number | null,
  b: number | null,
  difference: number | null,
  gap: number | null,
  rule: PairRule,
): { flag: QualityFlag; note: string } {
  if (a === null && b === null) {
    return { flag: "missing", note: "Neither item was reported." };
  }
  if (a === null) return { flag: "missing", note: "Only B was reported." };
  if (b === null) return { flag: "missing", note: "Only A was reported." };

  if (rule.op !== "eq") return judgeRule(difference!, gap, rule);

  if (difference === 0) {
    return { flag: "match", note: "The two agree." };
  }

  const size = Math.abs(difference!);
  return {
    flag: "mismatch",
    note:
      difference! > 0
        ? `A is ${size.toLocaleString()} higher than B.`
        : `A is ${size.toLocaleString()} lower than B.`,
  };
}

function judgeRule(
  difference: number,
  gap: number | null,
  rule: PairRule,
): { flag: QualityFlag; note: string } {
  const size = Math.abs(difference).toLocaleString();
  const direction = difference > 0 ? "higher" : "lower";

  if (rule.op === "gte") {
    return difference >= 0
      ? { flag: "match", note: "A is at least B." }
      : { flag: "mismatch", note: `A is ${size} lower than B; it should be at least B.` };
  }
  if (rule.op === "lte") {
    return difference <= 0
      ? { flag: "match", note: "A is at most B." }
      : { flag: "mismatch", note: `A is ${size} higher than B; it should be at most B.` };
  }

  const tolerance = ruleTolerance(rule);
  // Both zero leaves no gap to measure, and two zeros agree.
  const measured = gap ?? 0;
  if (measured <= tolerance) {
    return {
      flag: "match",
      note:
        difference === 0
          ? "The two agree."
          : `A is ${size} ${direction} than B, within ±${tolerance}%.`,
    };
  }
  return {
    flag: "mismatch",
    note: `A is ${size} ${direction} than B, a gap of ${measured.toFixed(1)}% against a limit of ±${tolerance}%.`,
  };
}

function bySeverity(left: ComparisonRow, right: ComparisonRow): number {
  const rank = FLAG_ORDER.indexOf(left.flag) - FLAG_ORDER.indexOf(right.flag);
  if (rank !== 0) return rank;
  const size = Math.abs(right.difference ?? 0) - Math.abs(left.difference ?? 0);
  if (size !== 0) return size;
  return left.name.localeCompare(right.name);
}

/* ------------------------------------------------- one reference, many */

export interface PairSpec {
  /** The item checked against the reference. */
  id: string;
  rule: PairRule;
}

/** One pair's verdict for one unit: B's value and how it stands against A. */
export interface PairCell {
  value: number | null;
  /** Reference minus this item, where both were reported. */
  difference: number | null;
  gap: number | null;
  flag: QualityFlag;
  note: string;
}

export interface MultiComparisonRow {
  id: string;
  name: string;
  ancestors: string[];
  /** The reference item's value. */
  reference: number | null;
  /** One cell per pair, in the order the pairs were given. */
  pairs: PairCell[];
  /** Indexes of the pairs that broke their rule here. */
  failed: number[];
  /** Broken if any pair broke; incomplete if any pair is; otherwise passing. */
  flag: QualityFlag;
}

export interface MultiComparisonSummary {
  totalReference: number;
  unitCount: number;
  /** Units where at least one pair broke its rule. */
  flagged: number;
  /** Units with no broken pair but at least one incomplete one. */
  incomplete: number;
  /** Units where every pair passed. */
  passed: number;
  /** How many units each pair broke in, by pair index. */
  failuresByPair: number[];
}

export interface MultiComparisonResult {
  referenceId: string;
  /** Each pair on its own, exactly as `compareItems` reports it. */
  pairs: (PairSpec & { result: ComparisonResult })[];
  rows: MultiComparisonRow[];
  summary: MultiComparisonSummary;
}

export interface CompareManyOptions {
  referenceId: string;
  pairs: PairSpec[];
  dimension?: string;
  ignoreEmptyUnits?: boolean;
}

/**
 * Checks every item in `pairs` against one reference, each under its own rule,
 * and folds the verdicts into one row per unit. A unit is flagged when any pair
 * breaks its rule there.
 *
 * Every pair is judged by `compareItems`, so a single pair here says exactly
 * what the two-item check says.
 */
export function compareMany(
  parsed: ParsedAnalytics,
  options: CompareManyOptions,
): MultiComparisonResult {
  const { referenceId, dimension = "ou", ignoreEmptyUnits = false } = options;

  const pairs = options.pairs.map((pair) => ({
    ...pair,
    result: compareItems(parsed, {
      aId: referenceId,
      bId: pair.id,
      rule: pair.rule,
      dimension,
      ignoreEmptyUnits,
    }),
  }));
  const byUnit = pairs.map((pair) => new Map(pair.result.rows.map((row) => [row.id, row])));

  const rows: MultiComparisonRow[] = [];

  for (const unit of dimensionValues(parsed, dimension, "name")) {
    const found = byUnit.map((rowsById) => rowsById.get(unit));
    const first = found.find((row) => row !== undefined);
    // Only an empty unit under ignoreEmptyUnits is absent from every pair.
    if (!first) continue;

    const cells: PairCell[] = found.map((row) =>
      row
        ? { value: row.b, difference: row.difference, gap: row.gap, flag: row.flag, note: row.note }
        : // Absent from one pair only when neither side reported there and
          // empty units count as agreeing.
          { value: null, difference: null, gap: null, flag: "match", note: "Neither item was reported." },
    );
    const failed = cells.flatMap((cell, index) => (cell.flag === "mismatch" ? [index] : []));

    rows.push({
      id: unit,
      name: first.name,
      ancestors: first.ancestors,
      reference: first.a,
      pairs: cells,
      failed,
      flag: failed.length
        ? "mismatch"
        : cells.some((cell) => cell.flag === "missing")
          ? "missing"
          : "match",
    });
  }

  return {
    referenceId,
    pairs,
    // Worst first: broken before incomplete, more broken pairs first, then the
    // largest single disagreement.
    rows: [...rows].sort(byMultiSeverity),
    summary: {
      totalReference: pairs[0]?.result.summary.totalA ?? 0,
      unitCount: rows.length,
      flagged: rows.filter((row) => row.flag === "mismatch").length,
      incomplete: rows.filter((row) => row.flag === "missing").length,
      passed: rows.filter((row) => row.flag === "match").length,
      failuresByPair: pairs.map(
        (_, index) => rows.filter((row) => row.failed.includes(index)).length,
      ),
    },
  };
}

function largestDifference(row: MultiComparisonRow): number {
  return row.pairs.reduce((worst, cell) => Math.max(worst, Math.abs(cell.difference ?? 0)), 0);
}

function byMultiSeverity(left: MultiComparisonRow, right: MultiComparisonRow): number {
  const rank = FLAG_ORDER.indexOf(left.flag) - FLAG_ORDER.indexOf(right.flag);
  if (rank !== 0) return rank;
  const broken = right.failed.length - left.failed.length;
  if (broken !== 0) return broken;
  const size = largestDifference(right) - largestDifference(left);
  if (size !== 0) return size;
  return left.name.localeCompare(right.name);
}

/** The two totals in each period, for watching them drift apart over time. */
export interface PeriodPoint {
  period: string;
  a: number;
  b: number;
  difference: number;
}

export function differenceOverTime(
  parsed: ParsedAnalytics,
  aId: string,
  bId: string,
): PeriodPoint[] {
  if (!parsed.dimensions.includes("pe")) return [];

  const periods = dimensionValues(parsed, "pe", "time");
  const totals = new Map<string, { a: number; b: number }>();

  for (const row of parsed.rows) {
    const period = String(row.pe ?? "");
    if (!period) continue;
    const bucket = totals.get(period) ?? { a: 0, b: 0 };
    const item = String(row.dx ?? "");
    if (item === aId) bucket.a += row.value;
    else if (item === bId) bucket.b += row.value;
    totals.set(period, bucket);
  }

  return periods.map((period) => {
    const bucket = totals.get(period) ?? { a: 0, b: 0 };
    return { period, a: bucket.a, b: bucket.b, difference: bucket.a - bucket.b };
  });
}

/** A hierarchy column: the organisation unit level it shows, and its heading. */
export interface LevelColumn {
  /** The ancestor level this column shows, or 0 when it names the unit itself. */
  level: number;
  label: string;
}

/**
 * The hierarchy columns for a set of findings.
 *
 * Every level is shown, root first, down to a final column naming the unit
 * being checked — national, region, district, sub-district, facility. A level
 * that reads the same in every row is kept rather than dropped: a table gets
 * read away from the query that produced it, and a row that does not say which
 * region and district it belongs to cannot be acted on or joined to anything
 * else.
 *
 * Columns are numbered by real organisation unit level, not by position in
 * the ancestor list. Analytics starts that list at the root that was asked
 * for, not at the national unit, so with "My units" set to a region the first
 * ancestor is a region. Its level comes from DHIS2 (`levelOf`), and the
 * headings start there: Region, District, Subdistrict, Facility.
 *
 * The unit itself gets its own column rather than being placed by its depth.
 * A hierarchy is not always the same depth on every branch: a facility that
 * hangs directly off a district sits at the level the server names
 * "sub-district", and placing it by level would file that facility under the
 * sub-district heading. The unit column borrows the level name only when every
 * row really is at the same level; otherwise it is named for what it holds.
 */
/** What the hierarchy columns read from a row; both kinds of finding have it. */
type HierarchyRow = Pick<ComparisonRow, "name" | "ancestors">;

/** An organisation unit's level as DHIS2 states it, where known. */
export type LevelOf = (id: string) => number | undefined;

/**
 * The level of each of a row's ancestors. The list is an unbroken path down
 * from the query's root, so an ancestor whose level is unknown sits one below
 * the one before it. With no levels known at all the root counts as level 1.
 */
function ancestorLevels(row: HierarchyRow, levelOf?: LevelOf): number[] {
  const levels: number[] = [];
  row.ancestors.forEach((id, index) => {
    levels.push(levelOf?.(id) ?? (index === 0 ? 1 : levels[index - 1] + 1));
  });
  return levels;
}

export function hierarchyColumns(
  rows: HierarchyRow[],
  levelName: (level: number) => string,
  levelOf?: LevelOf,
): LevelColumn[] {
  if (!rows.length) return [];

  const paths = rows.map((row) => ancestorLevels(row, levelOf));
  const withAncestors = paths.filter((levels) => levels.length > 0);

  // A row with no ancestors is the root itself; its level is not looked up.
  const unitLevels = paths.map((levels) =>
    levels.length ? levels[levels.length - 1] + 1 : 1,
  );
  const ragged = new Set(unitLevels).size > 1;

  const ancestors: LevelColumn[] = [];
  if (withAncestors.length) {
    const top = Math.min(...withAncestors.map((levels) => levels[0]));
    const bottom = Math.max(...withAncestors.map((levels) => levels[levels.length - 1]));
    for (let level = top; level <= bottom; level += 1) {
      ancestors.push({ level, label: levelName(level) });
    }
  }

  const unit: LevelColumn = {
    level: 0,
    label: ragged ? "Organisation unit" : levelName(unitLevels[0]),
  };

  return [...ancestors, unit];
}

/**
 * What one hierarchy column shows for one row.
 *
 * The table on screen and the export share this rule, so the two can never
 * disagree about which name belongs in which column.
 */
export function hierarchyCell(
  row: HierarchyRow,
  column: LevelColumn,
  resolve: (id: string) => string,
  levelOf?: LevelOf,
): string {
  if (column.level === 0) return row.name;
  const index = ancestorLevels(row, levelOf).indexOf(column.level);
  return index < 0 ? "" : resolve(row.ancestors[index]);
}

export function comparisonToCsv(
  result: ComparisonResult,
  names: { a: string; b: string; levels: LevelColumn[]; levelOf?: LevelOf },
  /** Resolve an ancestor id to its name for the hierarchy columns. */
  resolve: (id: string) => string,
  /** The finding words; `flagLabels` picks them for the pair's rule. */
  labels: Record<QualityFlag, string> = FLAG_LABELS,
): string {
  const header = [
    ...names.levels.map((column) => column.label),
    names.a,
    names.b,
    "Difference",
    "Finding",
    "Note",
  ];
  const lines = [header.map(cell).join(",")];

  for (const row of result.rows) {
    const columns = names.levels.map((column) =>
      hierarchyCell(row, column, resolve, names.levelOf),
    );

    lines.push(
      [
        ...columns,
        row.a === null ? "" : String(row.a),
        row.b === null ? "" : String(row.b),
        row.difference === null ? "" : String(row.difference),
        labels[row.flag],
        row.note,
      ]
        .map(cell)
        .join(","),
    );
  }

  return lines.join("\r\n");
}

export function multiComparisonToCsv(
  result: MultiComparisonResult,
  names: { reference: string; others: string[]; levels: LevelColumn[]; levelOf?: LevelOf },
  resolve: (id: string) => string,
): string {
  const labels = flagLabels(result.pairs.map((pair) => pair.rule));
  const header = [
    ...names.levels.map((column) => column.label),
    names.reference,
    ...result.pairs.flatMap((pair, index) => {
      const other = names.others[index];
      return [
        other,
        `Difference (${names.reference} minus ${other})`,
        `Result vs ${other} (${ruleSymbol(pair.rule)})`,
      ];
    }),
    "Failed pairs",
    "Finding",
  ];
  const lines = [header.map(cell).join(",")];

  for (const row of result.rows) {
    lines.push(
      [
        ...names.levels.map((column) => hierarchyCell(row, column, resolve, names.levelOf)),
        row.reference === null ? "" : String(row.reference),
        ...row.pairs.flatMap((pairCell) => [
          pairCell.value === null ? "" : String(pairCell.value),
          pairCell.difference === null ? "" : String(pairCell.difference),
          labels[pairCell.flag],
        ]),
        row.failed.map((index) => names.others[index]).join("; "),
        labels[row.flag],
      ]
        .map(cell)
        .join(","),
    );
  }

  return lines.join("\r\n");
}

function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
