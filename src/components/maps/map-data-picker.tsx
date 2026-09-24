"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input, Label, Spinner } from "@/components/ui/primitives";
import { searchMetadata, type MetadataResource } from "@/lib/dhis2/client";
import type { MapDataType } from "@/lib/dhis2/map-scope";
import type { IdName } from "@/lib/dhis2/types";
import { useAsyncData, useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export interface MapDataItem {
  id: string;
  displayName: string;
  /** The indicator type's name, e.g. "Per cent" or "Per 1 000". */
  typeName?: string;
}

type IndicatorRecord = IdName & { indicatorType?: { displayName?: string; factor?: number } };

/**
 * Where each data type's list comes from. Coverage is the percentage subset of
 * indicators — an indicator type with a factor of 100 — so a coverage is also
 * listed among Indicators, where anyone looking for it there will find it.
 */
const SOURCES: Record<
  MapDataType,
  { resource: MetadataResource; fields: string; filters: string[]; noun: string }
> = {
  count: {
    resource: "dataElements",
    fields: "id,displayName",
    filters: ["domainType:eq:AGGREGATE"],
    noun: "data elements",
  },
  coverage: {
    resource: "indicators",
    fields: "id,displayName,indicatorType[displayName,factor]",
    filters: ["indicatorType.factor:eq:100"],
    noun: "coverage indicators",
  },
  indicator: {
    resource: "indicators",
    fields: "id,displayName,indicatorType[displayName,factor]",
    filters: [],
    noun: "indicators",
  },
};

/** Picks the one data element or indicator the map is coloured by. */
export function MapDataPicker({
  type,
  value,
  onChange,
}: {
  type: MapDataType;
  value: MapDataItem | null;
  onChange: (item: MapDataItem) => void;
}) {
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 350);
  const source = SOURCES[type];

  const { data, error, loading } = useAsyncData(
    (signal) =>
      searchMetadata<IndicatorRecord>(source.resource, {
        query: debounced,
        fields: source.fields,
        extraFilters: source.filters,
        pageSize: 50,
        signal,
      }),
    [type, debounced],
  );

  const results = data?.items ?? [];

  return (
    <div className="space-y-2">
      <Label htmlFor="map-data-search" className="sr-only">
        Search {source.noun}
      </Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <Input
          id="map-data-search"
          className="pl-8"
          placeholder={`Search ${source.noun}…`}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-hair" role="listbox" aria-label={source.noun}>
        {loading ? (
          <div className="px-3 py-6 text-center">
            <Spinner label="Searching…" />
          </div>
        ) : error ? (
          <p className="px-3 py-6 text-center text-xs text-critical">{error}</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-2">
            {debounced.trim()
              ? `Nothing matched “${debounced}”.`
              : `This server returned no ${source.noun}, or the account cannot see them.`}
          </p>
        ) : (
          <ul>
            {results.map((item) => {
              const active = value?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() =>
                      onChange({
                        id: item.id,
                        displayName: item.displayName,
                        typeName: item.indicatorType?.displayName,
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                      active ? "bg-surface-2 font-medium text-ink" : "text-ink hover:bg-surface-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-3 shrink-0 rounded-full border",
                        active ? "border-accent bg-accent" : "border-hair",
                      )}
                    />
                    <span className="truncate" title={item.displayName}>
                      {item.displayName}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
