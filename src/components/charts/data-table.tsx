"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  render: (row: T) => React.ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number;
  width?: string;
}

/**
 * The table view behind every chart. It is the relief for hues that sit below
 * 3:1 on the light surface, and the place ranked-out series stay readable, so
 * nothing in a result is gated behind colour.
 */
export function DataTable<T>({
  columns,
  rows,
  caption,
  maxHeight = 420,
  emptyMessage = "No values to show.",
}: {
  columns: Column<T>[];
  rows: T[];
  caption?: string;
  maxHeight?: number;
  emptyMessage?: string;
}) {
  const [sort, setSort] = React.useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;

    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return sort.direction === "asc" ? result : -result;
    });
  }, [rows, sort, columns]);

  function toggle(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
  }

  if (!rows.length) {
    return <p className="px-5 py-10 text-center text-sm text-ink-2">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-auto rounded-lg border border-hair" style={{ maxHeight }}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const sortable = Boolean(column.sortValue);
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={
                    active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={cn(
                    "border-b border-hair px-3 py-2 text-xs font-medium text-ink-2",
                    column.numeric ? "text-right" : "text-left",
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-ink",
                        column.numeric ? "flex-row-reverse" : "",
                        active ? "text-ink" : "",
                      )}
                    >
                      {column.header}
                      {active ? (
                        sort!.direction === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={index} className="border-b border-hair last:border-0 hover:bg-surface-2">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-1.5 text-ink",
                    column.numeric ? "text-right tabular-nums" : "",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
