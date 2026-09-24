/** Number, date and label formatting shared by tiles, axes and tables. */

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Big standalone figures: 1,284 / 12.9K / 4.2M. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (Math.abs(value) < 10_000) return formatNumber(value);
  return compact.format(value);
}

/** Table and tooltip values: full precision, thousands separated. */
export function formatNumber(
  value: number | null | undefined,
  maximumFractionDigits = 2,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}

/** Axis ticks: short, clean, no decimals below the compact threshold. */
export function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return compact.format(value);
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)}%`;
}

/**
 * DHIS2 period identifiers into something a person reads.
 * 202401 -> Jan 2024 · 2024Q1 -> Q1 2024 · 2024W03 -> W03 2024 · 20240115 -> 15 Jan 2024
 */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatPeriod(period: string): string {
  if (!period) return "";
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(period);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  m = /^(\d{4})(\d{2})$/.exec(period);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  m = /^(\d{4})Q(\d)$/.exec(period);
  if (m) return `Q${m[2]} ${m[1]}`;
  m = /^(\d{4})W(\d{1,2})$/.exec(period);
  if (m) return `W${m[2].padStart(2, "0")} ${m[1]}`;
  m = /^(\d{4})S(\d)$/.exec(period);
  if (m) return `S${m[2]} ${m[1]}`;
  if (/^\d{4}$/.test(period)) return period;
  return period;
}

/** Sortable key for DHIS2 periods so charts run left-to-right in time. */
export function periodSortKey(period: string): string {
  const m = /^(\d{4})(Q|W|S)(\d{1,2})$/.exec(period);
  if (m) return `${m[1]}-${m[2]}-${m[3].padStart(2, "0")}`;
  return period;
}

export function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
