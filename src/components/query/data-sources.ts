import type { MetadataResource } from "@/lib/dhis2/client";
import type { DimensionItem, IdName } from "@/lib/dhis2/types";

export interface DataSourceOption {
  value: MetadataResource;
  label: string;
  /** Analytics needs a suffix for some object types (reporting rates). */
  suffix?: string;
  /** Fields this list needs, when id and displayName are not enough. */
  fields?: string;
  hint: string;
}

/** The metadata lists that can supply the data dimension of a query. */
export const DATA_SOURCES: DataSourceOption[] = [
  {
    value: "dataItems",
    label: "All data items",
    fields: "id,displayName,dimensionItemType",
    hint: "Every queryable measure in one list, whatever its type",
  },
  {
    value: "indicators",
    label: "Indicators",
    hint: "Calculated numerator / denominator measures",
  },
  { value: "dataElements", label: "Data elements", hint: "Raw captured values" },
  {
    value: "programIndicators",
    label: "Program indicators",
    hint: "Tracker and event measures",
  },
  {
    value: "dataSets",
    label: "Reporting rates",
    suffix: ".REPORTING_RATE",
    hint: "Share of expected reports actually submitted",
  },
];

export function findDataSource(value: MetadataResource): DataSourceOption {
  return DATA_SOURCES.find((option) => option.value === value) ?? DATA_SOURCES[0];
}

/**
 * Turn a metadata record into the dimension item analytics expects.
 *
 * A reporting rate is addressed as `<dataSetId>.REPORTING_RATE`. Which records
 * need that suffix depends on the list: the data set list is entirely
 * reporting rates, while the mixed data item list says so per record.
 */
export function toDimensionItem(
  option: DataSourceOption,
  item: IdName & { dimensionItemType?: string },
): DimensionItem {
  const suffix =
    option.suffix ?? (item.dimensionItemType === "REPORTING_RATE" ? ".REPORTING_RATE" : "");

  return {
    id: `${item.id}${suffix}`,
    displayName: suffix ? `${item.displayName} (reporting rate)` : item.displayName,
  };
}
