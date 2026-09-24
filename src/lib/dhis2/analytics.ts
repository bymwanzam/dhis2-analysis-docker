/**
 * Analytics query building and response shaping.
 *
 * DHIS2 returns analytics as a header list plus an array of string rows. Every
 * chart and table in this app is built from the tidy form produced here, so
 * the raw shape is parsed exactly once.
 */
import { formatPeriod, periodSortKey } from "@/lib/format";
import type { AnalyticsResponse } from "./types";

export interface AnalyticsQuery {
  /** Data items: indicator, data element or program indicator ids. */
  dx: string[];
  /** Periods: relative keywords or fixed period ids. */
  pe: string[];
  /** Org units: ids, LEVEL-n, or keywords such as USER_ORGUNIT. */
  ou: string[];
  /** Split values by category option combo. */
  includeCategories?: boolean;
  /** Ask DHIS2 for each organisation unit's ancestors. */
  hierarchy?: boolean;
  aggregationType?: string;
  skipRounding?: boolean;
  /**
   * Send periods as a filter rather than a dimension, so DHIS2 aggregates
   * across them itself and returns one value per remaining combination. For
   * an indicator that means summed numerators over summed denominators — a
   * number this app could not rebuild by adding period values together.
   */
  periodsAsFilter?: boolean;
}

export function isQueryRunnable(query: AnalyticsQuery): boolean {
  return query.dx.length > 0 && query.pe.length > 0 && query.ou.length > 0;
}

/** Build the proxy path for an analytics request. */
export function buildAnalyticsPath(query: AnalyticsQuery): string {
  const params = new URLSearchParams();
  params.append("dimension", `dx:${query.dx.join(";")}`);
  params.append(query.periodsAsFilter ? "filter" : "dimension", `pe:${query.pe.join(";")}`);
  params.append("dimension", `ou:${query.ou.join(";")}`);
  if (query.includeCategories) params.append("dimension", "co");
  params.set("displayProperty", "NAME");
  params.set("includeNumDen", "false");
  params.set("skipMeta", "false");
  if (query.hierarchy) params.set("hierarchyMeta", "true");
  if (query.aggregationType && query.aggregationType !== "DEFAULT") {
    params.set("aggregationType", query.aggregationType);
  }
  if (query.skipRounding) params.set("skipRounding", "true");
  return `analytics.json?${params.toString()}`;
}

export interface AnalyticsRow {
  value: number;
  [dimension: string]: string | number;
}

export interface ParsedAnalytics {
  /** Meta columns present in the response, in header order. */
  dimensions: string[];
  rows: AnalyticsRow[];
  /** Resolve a dimension item id to its display name. */
  labels: Record<string, string>;
  /**
   * Ancestors of each organisation unit, root first, when the query asked for
   * them. DHIS2 returns the ids only — the names need a metadata lookup.
   */
  hierarchy: Record<string, string[]>;
  isEmpty: boolean;
}

export function parseAnalytics(response: AnalyticsResponse): ParsedAnalytics {
  const headers = response.headers ?? [];
  const dimensions = headers.filter((header) => header.meta).map((header) => header.name);
  const valueIndex = headers.findIndex((header) => header.name === "value");

  const rows: AnalyticsRow[] = (response.rows ?? []).map((raw) => {
    const row: AnalyticsRow = { value: Number(raw[valueIndex]) };
    headers.forEach((header, index) => {
      if (header.meta) row[header.name] = raw[index];
    });
    if (!Number.isFinite(row.value)) row.value = 0;
    return row;
  });

  const labels: Record<string, string> = {};
  const items = response.metaData?.items ?? {};
  for (const [id, item] of Object.entries(items)) {
    labels[id] = item.name;
  }

  const hierarchy: Record<string, string[]> = {};
  for (const [id, path] of Object.entries(response.metaData?.ouHierarchy ?? {})) {
    hierarchy[id] = path.split("/").filter(Boolean);
  }

  return { dimensions, rows, labels, hierarchy, isEmpty: rows.length === 0 };
}

export function labelFor(parsed: ParsedAnalytics, id: string | number): string {
  return parsed.labels[String(id)] ?? String(id);
}

/** Distinct values of a dimension, ordered for display. */
export function dimensionValues(
  parsed: ParsedAnalytics,
  dimension: string,
  order: "time" | "total" | "name" = "name",
): string[] {
  const totals = new Map<string, number>();
  for (const row of parsed.rows) {
    const key = String(row[dimension] ?? "");
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + row.value);
  }
  const values = [...totals.keys()];

  if (order === "time") {
    return values.sort((a, b) => periodSortKey(a).localeCompare(periodSortKey(b)));
  }
  if (order === "total") {
    return values.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }
  return values.sort((a, b) => labelFor(parsed, a).localeCompare(labelFor(parsed, b)));
}

/** The synthetic key holding one combination of every plotted dimension. */
export const COMBINED_SERIES = "__series";

/**
 * Fold every dimension except one into a single series key.
 *
 * Plotting one dimension means the others are summed behind the reader's
 * back — twenty districts added together and drawn as a single line, which for
 * a rate is not a number at all. Combining them instead makes each series one
 * real combination, so nothing is aggregated that was not asked for.
 *
 * The key is deliberately not added to `dimensions`: it is a drawing
 * convenience, not a column, so tables and exports stay as the server
 * described them. The palette still caps how many series are drawn; the rest
 * are reported as hidden and remain in the table view.
 */
export function combineSeries(
  parsed: ParsedAnalytics,
  exclude?: string,
): { parsed: ParsedAnalytics; seriesDimension: string; title: string } {
  const others = parsed.dimensions.filter((dimension) => dimension !== exclude);

  if (others.length === 0) {
    return { parsed, seriesDimension: "dx", title: dimensionTitle("dx") };
  }
  if (others.length === 1) {
    return { parsed, seriesDimension: others[0], title: dimensionTitle(others[0]) };
  }

  const labels = { ...parsed.labels };
  const rows = parsed.rows.map((row) => {
    const parts = others.map((dimension) => String(row[dimension] ?? ""));
    const id = parts.join("|");
    if (!labels[id]) {
      labels[id] = parts.map((part) => parsed.labels[part] ?? part).join(" - ");
    }
    return { ...row, [COMBINED_SERIES]: id };
  });

  return {
    parsed: { ...parsed, rows, labels },
    seriesDimension: COMBINED_SERIES,
    title: others.map((dimension) => dimensionTitle(dimension)).join(" x "),
  };
}

export interface SeriesDescriptor {
  id: string;
  name: string;
}

export interface SeriesResult {
  /** One object per x position, keyed by series id. */
  data: Record<string, string | number | null>[];
  series: SeriesDescriptor[];
  /** Series ranked out of the chart because the palette stops at eight. */
  hiddenSeries: SeriesDescriptor[];
}

/**
 * Reshape tidy rows into the wide form Recharts wants.
 *
 * Series are ranked by total and capped at the palette size. The tail is never
 * summed into an "Other" bucket — for rates and ratios that would invent a
 * number — it is listed as hidden and stays visible in the table view.
 */
export function buildSeries(
  parsed: ParsedAnalytics,
  options: {
    xDimension: string;
    seriesDimension: string;
    xOrder?: "time" | "total" | "name";
    maxSeries?: number;
    formatX?: (value: string) => string;
  },
): SeriesResult {
  const { xDimension, seriesDimension, xOrder = "name", maxSeries = 8, formatX } = options;

  const xValues = dimensionValues(parsed, xDimension, xOrder);
  const rankedSeries = dimensionValues(parsed, seriesDimension, "total");

  const visible = rankedSeries.slice(0, maxSeries);
  const hidden = rankedSeries.slice(maxSeries);
  const visibleSet = new Set(visible);

  const lookup = new Map<string, number>();
  for (const row of parsed.rows) {
    const seriesId = String(row[seriesDimension] ?? "");
    if (!visibleSet.has(seriesId)) continue;
    const key = `${row[xDimension]}\u0000${seriesId}`;
    lookup.set(key, (lookup.get(key) ?? 0) + row.value);
  }

  const data = xValues.map((x) => {
    const label = formatX ? formatX(x) : labelFor(parsed, x);
    const point: Record<string, string | number | null> = { __x: x, __label: label };
    for (const seriesId of visible) {
      point[seriesId] = lookup.get(`${x}\u0000${seriesId}`) ?? null;
    }
    return point;
  });

  const describe = (id: string): SeriesDescriptor => ({ id, name: labelFor(parsed, id) });

  return {
    data,
    series: visible.map(describe),
    hiddenSeries: hidden.map(describe),
  };
}

export interface PivotResult {
  rowKeys: string[];
  rowLabels: string[];
  columnKeys: string[];
  columnLabels: string[];
  /** cells[rowIndex][columnIndex] — null where the query returned nothing. */
  cells: (number | null)[][];
  rowTotals: number[];
  columnTotals: number[];
  grandTotal: number;
  max: number;
  min: number;
}

/** Cross-tabulate tidy rows into a matrix, summing duplicates. */
export function buildPivot(
  parsed: ParsedAnalytics,
  options: {
    rowDimension: string;
    columnDimension: string;
    rowOrder?: "time" | "total" | "name";
    columnOrder?: "time" | "total" | "name";
    formatRow?: (value: string) => string;
    formatColumn?: (value: string) => string;
  },
): PivotResult {
  const {
    rowDimension,
    columnDimension,
    rowOrder = "name",
    columnOrder = "name",
    formatRow,
    formatColumn,
  } = options;

  const rowKeys = dimensionValues(parsed, rowDimension, rowOrder);
  const columnKeys = dimensionValues(parsed, columnDimension, columnOrder);
  const rowIndex = new Map(rowKeys.map((key, index) => [key, index]));
  const columnIndex = new Map(columnKeys.map((key, index) => [key, index]));

  const cells: (number | null)[][] = rowKeys.map(() => columnKeys.map(() => null));

  for (const row of parsed.rows) {
    const r = rowIndex.get(String(row[rowDimension] ?? ""));
    const c = columnIndex.get(String(row[columnDimension] ?? ""));
    if (r === undefined || c === undefined) continue;
    cells[r][c] = (cells[r][c] ?? 0) + row.value;
  }

  const rowTotals = cells.map((cellRow) =>
    cellRow.reduce<number>((sum, value) => sum + (value ?? 0), 0),
  );
  const columnTotals = columnKeys.map((_, c) =>
    cells.reduce<number>((sum, cellRow) => sum + (cellRow[c] ?? 0), 0),
  );
  const grandTotal = rowTotals.reduce((sum, value) => sum + value, 0);

  const flat = cells.flat().filter((value): value is number => value !== null);

  return {
    rowKeys,
    rowLabels: rowKeys.map((key) => (formatRow ? formatRow(key) : labelFor(parsed, key))),
    columnKeys,
    columnLabels: columnKeys.map((key) =>
      formatColumn ? formatColumn(key) : labelFor(parsed, key),
    ),
    cells,
    rowTotals,
    columnTotals,
    grandTotal,
    max: flat.length ? Math.max(...flat) : 0,
    min: flat.length ? Math.min(...flat) : 0,
  };
}

/** Total, mean and latest value of a single data item across the result. */
export interface Summary {
  id: string;
  name: string;
  total: number;
  mean: number;
  latest: number | null;
  latestPeriod: string | null;
  previous: number | null;
  previousPeriod: string | null;
  count: number;
  /** Per-period totals in time order, for the tile sparkline. */
  trend: { period: string; value: number }[];
}

export function summarize(parsed: ParsedAnalytics, dimension = "dx"): Summary[] {
  const hasPeriod = parsed.dimensions.includes("pe");
  const periods = hasPeriod ? dimensionValues(parsed, "pe", "time") : [];
  const latestPeriod = periods.at(-1) ?? null;
  const previousPeriod = periods.at(-2) ?? null;

  const byItem = new Map<string, AnalyticsRow[]>();
  for (const row of parsed.rows) {
    const key = String(row[dimension] ?? "");
    const bucket = byItem.get(key);
    if (bucket) bucket.push(row);
    else byItem.set(key, [row]);
  }

  return dimensionValues(parsed, dimension, "total").map((id) => {
    const rows = byItem.get(id) ?? [];
    const total = rows.reduce((sum, row) => sum + row.value, 0);

    const sumAt = (period: string | null): number | null => {
      if (period === null) return null;
      const matching = rows.filter((row) => row.pe === period);
      if (matching.length === 0) return null;
      return matching.reduce((sum, row) => sum + row.value, 0);
    };

    return {
      id,
      name: labelFor(parsed, id),
      total,
      mean: rows.length ? total / rows.length : 0,
      latest: sumAt(latestPeriod),
      latestPeriod,
      previous: sumAt(previousPeriod),
      previousPeriod,
      count: rows.length,
      trend: periods
        .map((period) => ({ period, value: sumAt(period) }))
        .filter((point): point is { period: string; value: number } => point.value !== null),
    };
  });
}

/** Percentage change, guarding against a zero or missing baseline. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Tidy rows as CSV, one row per analytics row. */
export function toCsv(parsed: ParsedAnalytics): string {
  const header = [...parsed.dimensions.map((d) => dimensionTitle(d)), "Value"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of parsed.rows) {
    // Periods wear the same label as on screen, so an export matches the table
    // it was taken from.
    const cells = parsed.dimensions.map((dimension) =>
      dimension === "pe"
        ? formatPeriod(String(row[dimension]))
        : labelFor(parsed, String(row[dimension])),
    );
    lines.push([...cells, String(row.value)].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

/** A pivot matrix as CSV, including the totals row and column. */
export function pivotToCsv(pivot: PivotResult, rowTitle: string): string {
  const header = [rowTitle, ...pivot.columnLabels, "Total"];
  const lines = [header.map(csvCell).join(",")];
  pivot.rowLabels.forEach((label, r) => {
    const cells = pivot.cells[r].map((value) => (value === null ? "" : String(value)));
    lines.push([label, ...cells, String(pivot.rowTotals[r])].map(csvCell).join(","));
  });
  lines.push(
    ["Total", ...pivot.columnTotals.map(String), String(pivot.grandTotal)]
      .map(csvCell)
      .join(","),
  );
  return lines.join("\r\n");
}

/** Any table as CSV, with the same formula guard as every other export. */
export function rowsToCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  // Guard against a leading =, +, - or @ being read as a formula on open.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function dimensionTitle(dimension: string): string {
  switch (dimension) {
    case "dx":
      return "Data";
    case "pe":
      return "Period";
    case "ou":
      return "Organisation unit";
    case "co":
      return "Category";
    default:
      return dimension;
  }
}

export type PeriodReduction = "latest" | "sum" | "mean";

export const PERIOD_REDUCTIONS: { value: PeriodReduction; label: string; describe: string }[] = [
  { value: "latest", label: "Latest period", describe: "the latest period in the result" },
  { value: "sum", label: "Total", describe: "summed across every period" },
  { value: "mean", label: "Average", describe: "averaged across every period" },
];

/**
 * Collapse the period dimension so a result can be ranked or split as a share.
 *
 * Which reduction applies is always stated in the chart, because summing a
 * coverage rate across twelve months produces a number that means nothing.
 */
export function collapsePeriods(
  parsed: ParsedAnalytics,
  mode: PeriodReduction,
): ParsedAnalytics {
  if (!parsed.dimensions.includes("pe")) return parsed;

  const keep = parsed.dimensions.filter((dimension) => dimension !== "pe");
  const periods = dimensionValues(parsed, "pe", "time");
  const latest = periods.at(-1);

  const source =
    mode === "latest" ? parsed.rows.filter((row) => row.pe === latest) : parsed.rows;

  const groups = new Map<string, { row: AnalyticsRow; total: number; count: number }>();
  for (const row of source) {
    const key = keep.map((dimension) => String(row[dimension])).join("\u0000");
    const existing = groups.get(key);
    if (existing) {
      existing.total += row.value;
      existing.count += 1;
    } else {
      const base: AnalyticsRow = { value: 0 };
      for (const dimension of keep) base[dimension] = row[dimension];
      groups.set(key, { row: base, total: row.value, count: 1 });
    }
  }

  const rows = [...groups.values()].map(({ row, total, count }) => ({
    ...row,
    value: mode === "mean" ? total / count : total,
  }));

  return {
    dimensions: keep,
    rows,
    labels: parsed.labels,
    hierarchy: parsed.hierarchy,
    isEmpty: rows.length === 0,
  };
}

export interface CategoryValue {
  id: string;
  name: string;
  value: number;
}

/** One value per item of a dimension, ranked high to low. */
export function categoryTotals(
  parsed: ParsedAnalytics,
  dimension: string,
): CategoryValue[] {
  const totals = new Map<string, number>();
  for (const row of parsed.rows) {
    const key = String(row[dimension] ?? "");
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + row.value);
  }

  return [...totals.entries()]
    .map(([id, value]) => ({ id, name: labelFor(parsed, id), value }))
    .sort((a, b) => b.value - a.value);
}
