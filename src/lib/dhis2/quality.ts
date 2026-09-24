/**
 * Pairwise data quality: do two data elements agree?
 *
 * The check is equality. Some pairs of data elements are supposed to carry
 * the same number — suspected malaria cases against suspected cases tested,
 * a register count against its summary, doses issued against doses recorded —
 * and anywhere the two disagree, one of them is wrong.
 *
 * Nothing here judges a unit against the rest of the data: a facility where
 * both numbers are 40 passes, and a facility reporting 300 against 280 fails,
 * however normal that gap looks across the region.
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
  const { aId, bId, dimension = "ou", ignoreEmptyUnits = false } = options;

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
      ...judge(a, b, difference),
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
): { flag: QualityFlag; note: string } {
  if (a === null && b === null) {
    return { flag: "missing", note: "Neither item was reported." };
  }
  if (a === null) return { flag: "missing", note: "Only B was reported." };
  if (b === null) return { flag: "missing", note: "Only A was reported." };

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

function bySeverity(left: ComparisonRow, right: ComparisonRow): number {
  const rank = FLAG_ORDER.indexOf(left.flag) - FLAG_ORDER.indexOf(right.flag);
  if (rank !== 0) return rank;
  const size = Math.abs(right.difference ?? 0) - Math.abs(left.difference ?? 0);
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
 * The unit itself gets its own column rather than being placed by its depth.
 * A hierarchy is not always the same depth on every branch: a facility that
 * hangs directly off a district sits at the depth the server names
 * "sub-district", and placing it by depth would file that facility under the
 * sub-district heading. The unit column borrows the level name only when every
 * row really is at the same depth; otherwise it is named for what it holds.
 */
export function hierarchyColumns(
  rows: ComparisonRow[],
  levelName: (level: number) => string,
): LevelColumn[] {
  if (!rows.length) return [];

  const depths = rows.map((row) => row.ancestors.length);
  const deepest = Math.max(...depths);
  const ragged = new Set(depths).size > 1;

  const ancestors: LevelColumn[] = Array.from({ length: deepest }, (_, index) => ({
    level: index + 1,
    label: levelName(index + 1),
  }));

  const unit: LevelColumn = {
    level: 0,
    label: ragged ? "Organisation unit" : levelName(deepest + 1),
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
  row: ComparisonRow,
  column: LevelColumn,
  resolve: (id: string) => string,
): string {
  if (column.level === 0) return row.name;
  const ancestor = row.ancestors[column.level - 1];
  return ancestor === undefined ? "" : resolve(ancestor);
}

export function comparisonToCsv(
  result: ComparisonResult,
  names: { a: string; b: string; levels: LevelColumn[] },
  /** Resolve an ancestor id to its name for the hierarchy columns. */
  resolve: (id: string) => string,
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
    const columns = names.levels.map((column) => hierarchyCell(row, column, resolve));

    lines.push(
      [
        ...columns,
        row.a === null ? "" : String(row.a),
        row.b === null ? "" : String(row.b),
        row.difference === null ? "" : String(row.difference),
        FLAG_LABELS[row.flag],
        row.note,
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
