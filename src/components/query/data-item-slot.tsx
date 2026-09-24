"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Input, Select, Spinner } from "@/components/ui/primitives";
import { searchMetadata, type MetadataResource } from "@/lib/dhis2/client";
import type { DimensionItem, IdName } from "@/lib/dhis2/types";
import { useAsyncData, useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { DATA_SOURCES, findDataSource, toDimensionItem } from "./data-sources";

/**
 * Picks exactly one data item.
 *
 * A comparison has two named sides rather than a list, so each side gets its
 * own slot, its own colour key and its own metadata type — comparing a raw
 * data element against the indicator calculated from it is a routine check.
 */
export function DataItemSlot({
  label,
  keyColor,
  value,
  onChange,
  exclude,
}: {
  label: string;
  /** The colour this side wears in every chart on the page. */
  keyColor: string;
  value: DimensionItem | null;
  onChange: (item: DimensionItem | null) => void;
  /** The other side, which cannot be picked twice. */
  exclude?: string | null;
}) {
  const [source, setSource] = React.useState<MetadataResource>("dataElements");
  const [term, setTerm] = React.useState("");

  const debouncedTerm = useDebounced(term, 350);
  const option = findDataSource(source);

  const { data, error, loading } = useAsyncData(
    (signal) =>
      value
        ? Promise.resolve({ items: [] as IdName[] })
        : searchMetadata<IdName>(source, { query: debouncedTerm, pageSize: 50, signal }),
    [source, debouncedTerm, value?.id ?? ""],
  );

  const results = data?.items ?? [];

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: keyColor }}
        />
        {label}
      </p>

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-hair bg-surface-2 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink" title={value.displayName}>
            {value.displayName}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-md p-1 text-muted hover:text-critical"
            title={`Clear ${label}`}
          >
            <X className="size-3.5" aria-hidden />
            <span className="sr-only">Clear {label}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select
              className="h-8 w-36 shrink-0 text-xs"
              value={source}
              onChange={(event) => setSource(event.target.value as MetadataResource)}
              aria-label={`Metadata type for ${label}`}
            >
              {DATA_SOURCES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>

            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="Search…"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                aria-label={`Search for ${label}`}
              />
            </div>
          </div>

          <div className="max-h-44 overflow-y-auto rounded-lg border border-hair">
            {loading ? (
              <div className="px-3 py-5 text-center">
                <Spinner label="Searching…" />
              </div>
            ) : error ? (
              <p className="px-3 py-5 text-center text-xs text-critical">{error}</p>
            ) : !results.length ? (
              <p className="px-3 py-5 text-center text-xs text-ink-2">
                Nothing matched “{debouncedTerm}”.
              </p>
            ) : (
              <ul>
                {results.map((item) => {
                  const entry = toDimensionItem(option, item);
                  const taken = exclude === entry.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={taken}
                        onClick={() => onChange(entry)}
                        title={taken ? "Already chosen on the other side" : entry.displayName}
                        className={cn(
                          "w-full truncate px-3 py-1.5 text-left text-sm transition-colors",
                          taken
                            ? "cursor-not-allowed text-muted"
                            : "text-ink hover:bg-surface-2",
                        )}
                      >
                        {entry.displayName}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
