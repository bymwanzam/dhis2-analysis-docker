"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Input, Label, Select, Spinner } from "@/components/ui/primitives";
import { useAsyncData, useDebounced } from "@/lib/hooks";
import { searchMetadata, type MetadataResource } from "@/lib/dhis2/client";
import type { DimensionItem, IdName } from "@/lib/dhis2/types";
import { cn } from "@/lib/utils";
import { DATA_SOURCES, findDataSource, toDimensionItem } from "./data-sources";

/** The mixed data item list tags each record with the type analytics needs. */
type DataRecord = IdName & { dimensionItemType?: string };

/**
 * Picks the data dimension of a query.
 *
 * Search runs against the DHIS2 metadata endpoints through the proxy, so it
 * always reflects the server being analysed rather than a bundled list.
 */
export function DataPicker({
  selected,
  onChange,
}: {
  selected: DimensionItem[];
  onChange: (items: DimensionItem[]) => void;
}) {
  const [source, setSource] = React.useState<MetadataResource>("dataItems");
  const [term, setTerm] = React.useState("");

  const debouncedTerm = useDebounced(term, 350);
  const option = findDataSource(source);

  const { data, error, loading } = useAsyncData(
    (signal) =>
      searchMetadata<DataRecord>(source, {
        query: debouncedTerm,
        fields: option.fields,
        pageSize: 50,
        signal,
      }),
    [source, debouncedTerm],
  );

  const results = data?.items ?? [];

  const selectedIds = React.useMemo(
    () => new Set(selected.map((item) => item.id)),
    [selected],
  );

  function toggle(item: DataRecord) {
    const entry = toDimensionItem(option, item);

    if (selectedIds.has(entry.id)) {
      onChange(selected.filter((existing) => existing.id !== entry.id));
      return;
    }
    onChange([...selected, entry]);
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="data-source">Data type</Label>
        <Select
          id="data-source"
          className="mt-1"
          value={source}
          onChange={(event) => setSource(event.target.value as MetadataResource)}
        >
          {DATA_SOURCES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-muted">{option.hint}</p>
      </div>

      <div>
        <Label htmlFor="data-search" className="sr-only">
          Search {option.label.toLowerCase()}
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            id="data-search"
            className="pl-8"
            placeholder={`Search ${option.label.toLowerCase()}…`}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
      </div>

      {selected.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onChange(selected.filter((entry) => entry.id !== item.id))}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-hair bg-surface-2 py-1 pl-2.5 pr-1.5 text-xs text-ink hover:border-critical"
                title={`Remove ${item.displayName}`}
              >
                <span className="truncate">{item.displayName}</span>
                <X className="size-3 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="max-h-64 overflow-y-auto rounded-lg border border-hair">
        {loading ? (
          <div className="px-3 py-6 text-center">
            <Spinner label="Searching…" />
          </div>
        ) : error ? (
          <p className="px-3 py-6 text-center text-xs text-critical">{error}</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-2">
            {debouncedTerm.trim() ? (
              <>Nothing matched “{debouncedTerm}”.</>
            ) : (
              <>
                This server returned no {option.label.toLowerCase()}. The account may not
                have been given access to them, or the server holds none.
              </>
            )}
          </p>
        ) : (
          <ul>
            {results.map((item) => {
              const id = toDimensionItem(option, item).id;
              const checked = selectedIds.has(id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                      checked ? "bg-surface-2 text-ink" : "text-ink hover:bg-surface-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded border",
                        checked ? "border-accent bg-accent text-white" : "border-hair",
                      )}
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span className="truncate">{item.displayName}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted">
        {selected.length} selected
      </p>
    </div>
  );
}
