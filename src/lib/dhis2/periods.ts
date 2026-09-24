/**
 * Period choices offered by the query builder.
 *
 * DHIS2 relative periods are resolved by the server against the request date,
 * so a saved query keeps meaning "the last 12 months" rather than freezing to
 * a set of months. Fixed periods are offered alongside for reporting on a
 * specific year or quarter.
 */

export interface PeriodOption {
  id: string;
  label: string;
  /** Roughly how many points the period expands to — used to warn about wide queries. */
  points: number;
}

export interface PeriodGroup {
  label: string;
  options: PeriodOption[];
}

export const RELATIVE_PERIODS: PeriodGroup[] = [
  {
    label: "Months",
    options: [
      { id: "THIS_MONTH", label: "This month", points: 1 },
      { id: "LAST_MONTH", label: "Last month", points: 1 },
      { id: "LAST_3_MONTHS", label: "Last 3 months", points: 3 },
      { id: "LAST_6_MONTHS", label: "Last 6 months", points: 6 },
      { id: "LAST_12_MONTHS", label: "Last 12 months", points: 12 },
      { id: "MONTHS_THIS_YEAR", label: "Months this year", points: 12 },
      { id: "MONTHS_LAST_YEAR", label: "Months last year", points: 12 },
    ],
  },
  {
    label: "Quarters",
    options: [
      { id: "THIS_QUARTER", label: "This quarter", points: 1 },
      { id: "LAST_QUARTER", label: "Last quarter", points: 1 },
      { id: "LAST_4_QUARTERS", label: "Last 4 quarters", points: 4 },
      { id: "QUARTERS_THIS_YEAR", label: "Quarters this year", points: 4 },
      { id: "QUARTERS_LAST_YEAR", label: "Quarters last year", points: 4 },
    ],
  },
  {
    label: "Years",
    options: [
      { id: "THIS_YEAR", label: "This year", points: 1 },
      { id: "LAST_YEAR", label: "Last year", points: 1 },
      { id: "LAST_5_YEARS", label: "Last 5 years", points: 5 },
      { id: "LAST_10_YEARS", label: "Last 10 years", points: 10 },
    ],
  },
  {
    label: "Weeks",
    options: [
      { id: "THIS_WEEK", label: "This week", points: 1 },
      { id: "LAST_WEEK", label: "Last week", points: 1 },
      { id: "LAST_4_WEEKS", label: "Last 4 weeks", points: 4 },
      { id: "LAST_12_WEEKS", label: "Last 12 weeks", points: 12 },
      { id: "LAST_52_WEEKS", label: "Last 52 weeks", points: 52 },
    ],
  },
];

export const ALL_RELATIVE_PERIODS: PeriodOption[] = RELATIVE_PERIODS.flatMap(
  (group) => group.options,
);

export function findPeriodOption(id: string): PeriodOption | undefined {
  return ALL_RELATIVE_PERIODS.find((option) => option.id === id);
}

export function isRelativePeriod(id: string): boolean {
  return /^[A-Z0-9_]+$/.test(id);
}

/** Fixed calendar years, newest first, for the "specific year" picker. */
export function fixedYears(count = 10, endYear = new Date().getFullYear()): PeriodOption[] {
  return Array.from({ length: count }, (_, index) => {
    const year = endYear - index;
    return { id: String(year), label: String(year), points: 1 };
  });
}

/** The 12 months of a given year as DHIS2 monthly periods. */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}${String(index + 1).padStart(2, "0")}`);
}

/** Estimated number of periods a selection expands to. */
export function estimatePoints(periods: string[]): number {
  return periods.reduce((total, id) => total + (findPeriodOption(id)?.points ?? 1), 0);
}
