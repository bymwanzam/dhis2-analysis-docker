"use client";

import * as React from "react";

export interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | null;
  color?: string;
}

/**
 * Hover layer for every chart form. An HTML chart is interactive by default,
 * so the tooltip is not an extra — it is where the values the chart does not
 * directly label are read.
 */
export function SeriesTooltip({
  active,
  payload,
  label,
  format,
  nameFor,
  total,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: React.ReactNode;
  format: (value: number) => string;
  nameFor?: (key: string) => string;
  /** Show each row as a share of this total. */
  total?: number;
}) {
  if (!active || !payload?.length) return null;

  const rows = payload
    .filter((entry) => entry.value !== null && entry.value !== undefined)
    .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));

  if (!rows.length) return null;

  return (
    <div className="pointer-events-none min-w-44 max-w-72 rounded-lg border border-hair bg-surface px-3 py-2 shadow-lg">
      {label ? <p className="mb-1.5 text-xs font-medium text-ink">{label}</p> : null}
      <ul className="space-y-1">
        {rows.map((entry, index) => {
          const key = String(entry.dataKey ?? index);
          const name = nameFor ? nameFor(key) : String(entry.name ?? key);
          const value = Number(entry.value);
          return (
            <li key={key} className="flex items-baseline justify-between gap-4 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: entry.color }}
                />
                <span className="truncate">{name}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums text-ink">
                {format(value)}
                {total ? (
                  <span className="ml-1 font-normal text-muted">
                    {((value / total) * 100).toFixed(1)}%
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
