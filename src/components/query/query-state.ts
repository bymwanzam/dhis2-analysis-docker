import type { AnalyticsQuery } from "@/lib/dhis2/analytics";
import type { DimensionItem } from "@/lib/dhis2/types";
import { toOuDimension, type OrgUnitSelection } from "./org-unit-picker";

/** Everything the three pickers produce, in one serialisable shape. */
export interface QueryState {
  data: DimensionItem[];
  periods: string[];
  orgUnits: OrgUnitSelection;
  aggregationType: string;
  includeCategories: boolean;
}

export const DEFAULT_QUERY: QueryState = {
  data: [],
  periods: ["LAST_12_MONTHS"],
  orgUnits: { units: [], level: "", useUserOrgUnit: true },
  aggregationType: "DEFAULT",
  includeCategories: false,
};

export const AGGREGATION_TYPES = [
  { value: "DEFAULT", label: "As configured" },
  { value: "SUM", label: "Sum" },
  { value: "AVERAGE", label: "Average" },
  { value: "AVERAGE_SUM_ORG_UNIT", label: "Average, summed by org unit" },
  { value: "LAST", label: "Last value" },
  { value: "COUNT", label: "Count" },
  { value: "MIN", label: "Minimum" },
  { value: "MAX", label: "Maximum" },
] as const;

export function toAnalyticsQuery(state: QueryState): AnalyticsQuery {
  return {
    dx: state.data.map((item) => item.id),
    pe: state.periods,
    ou: toOuDimension(state.orgUnits),
    aggregationType: state.aggregationType,
    includeCategories: state.includeCategories,
  };
}

/** What is still missing before the query can run. */
export function missingParts(state: QueryState): string[] {
  const missing: string[] = [];
  if (!state.data.length) missing.push("a data item");
  if (!state.periods.length) missing.push("a period");
  if (!toOuDimension(state.orgUnits).length) missing.push("an organisation unit");
  return missing;
}

/** A stable key for the current selection, used to spot unrun changes. */
export function querySignature(state: QueryState): string {
  return JSON.stringify(toAnalyticsQuery(state));
}
