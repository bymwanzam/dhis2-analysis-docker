"use client";

import * as React from "react";
import type { PivotResult } from "@/lib/dhis2/analytics";
import { formatCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { heatFill } from "./palette";

/**
 * A pivot table that can wear its values as a sequential fill.
 *
 * The fill is one hue anchored to the chart surface — near zero recedes into
 * the surface, the maximum is the accent — and it is capped so the value text
 * stays in ink and readable on the darkest cell in both themes. Numbers are
 * always present, so the colour is a second reading of the value, not the
 * only one.
 */
export function HeatTable({
  pivot,
  rowTitle,
  showHeat = true,
  showTotals = true,
  maxHeight = 560,
}: {
  pivot: PivotResult;
  rowTitle: string;
  showHeat?: boolean;
  showTotals?: boolean;
  maxHeight?: number;
}) {
  if (!pivot.rowKeys.length || !pivot.columnKeys.length) {
    return <p className="px-5 py-10 text-center text-sm text-ink-2">No values to show.</p>;
  }

  return (
    <div className="overflow-auto rounded-lg border border-hair" style={{ maxHeight }}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-surface-2">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-30 min-w-48 border-b border-r border-hair bg-surface-2 px-3 py-2 text-left text-xs font-medium text-ink-2"
            >
              {rowTitle}
            </th>
            {pivot.columnLabels.map((label, index) => (
              <th
                key={pivot.columnKeys[index]}
                scope="col"
                className="whitespace-nowrap border-b border-hair px-3 py-2 text-right text-xs font-medium text-ink-2"
              >
                {label}
              </th>
            ))}
            {showTotals ? (
              <th
                scope="col"
                className="whitespace-nowrap border-b border-l border-hair px-3 py-2 text-right text-xs font-semibold text-ink"
              >
                Total
              </th>
            ) : null}
          </tr>
        </thead>

        <tbody>
          {pivot.rowLabels.map((label, r) => (
            <tr key={pivot.rowKeys[r]} className="group">
              <th
                scope="row"
                className="sticky left-0 z-10 max-w-64 truncate border-b border-r border-hair bg-surface px-3 py-1.5 text-left text-sm font-normal text-ink group-hover:bg-surface-2"
                title={label}
              >
                {label}
              </th>
              {pivot.cells[r].map((value, c) => (
                <td
                  key={pivot.columnKeys[c]}
                  className="border-b border-hair px-3 py-1.5 text-right tabular-nums text-ink"
                  style={
                    showHeat
                      ? { background: heatFill(value, pivot.min, pivot.max) }
                      : undefined
                  }
                  title={value === null ? "No data" : formatNumber(value)}
                >
                  {value === null ? <span className="text-muted">–</span> : formatCompact(value)}
                </td>
              ))}
              {showTotals ? (
                <td className="border-b border-l border-hair px-3 py-1.5 text-right font-medium tabular-nums text-ink">
                  {formatCompact(pivot.rowTotals[r])}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>

        {showTotals ? (
          <tfoot className="sticky bottom-0 bg-surface-2">
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-t border-hair bg-surface-2 px-3 py-2 text-left text-xs font-semibold text-ink"
              >
                Total
              </th>
              {pivot.columnTotals.map((total, index) => (
                <td
                  key={pivot.columnKeys[index]}
                  className={cn(
                    "border-t border-hair px-3 py-2 text-right text-xs font-medium tabular-nums text-ink",
                  )}
                >
                  {formatCompact(total)}
                </td>
              ))}
              <td className="border-l border-t border-hair px-3 py-2 text-right text-xs font-semibold tabular-nums text-ink">
                {formatCompact(pivot.grandTotal)}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
