"use client";

import * as React from "react";
import Link from "next/link";
import { Grid3x3, Repeat } from "lucide-react";
import { ChartFrame, ScaleLegend } from "@/components/charts/chart-frame";
import { HeatTable } from "@/components/charts/heat-table";
import { heatScaleStops } from "@/components/charts/palette";
import { useConnection } from "@/components/connection-provider";
import { QueryPanel } from "@/components/query/query-panel";
import { DEFAULT_QUERY, toAnalyticsQuery } from "@/components/query/query-state";
import { useAnalyticsSession } from "@/components/query/use-analytics";
import { Alert, Button, Checkbox, EmptyState, Label, Select } from "@/components/ui/primitives";
import {
  buildPivot,
  dimensionTitle,
  dimensionValues,
  pivotToCsv,
} from "@/lib/dhis2/analytics";
import { formatCompact, formatPeriod } from "@/lib/format";
import { downloadCsv, stamped } from "@/lib/download";

/**
 * Cross-tabulation.
 *
 * Any two dimensions of the result become rows and columns; whatever is left
 * is summed into the cells, and the header says so rather than leaving the
 * reader to guess what a cell contains.
 */
export function PivotWorkbench() {
  const { status, loading: checking } = useConnection();
  const connected = status?.connected === true;

  const { query, setQuery, hydrated, result, error, running, dirty, run } =
    useAnalyticsSession("dhis2.pivot.query", DEFAULT_QUERY, toAnalyticsQuery);

  const [rowDimension, setRowDimension] = React.useState("ou");
  const [columnDimension, setColumnDimension] = React.useState("pe");
  const [showHeat, setShowHeat] = React.useState(true);
  const [showTotals, setShowTotals] = React.useState(true);

  const dimensions = result?.dimensions ?? [];

  const rowDim = dimensions.includes(rowDimension) ? rowDimension : (dimensions[0] ?? "ou");
  const colDim =
    dimensions.includes(columnDimension) && columnDimension !== rowDim
      ? columnDimension
      : (dimensions.find((dimension) => dimension !== rowDim) ?? "pe");

  const collapsedInto = dimensions.filter(
    (dimension) => dimension !== rowDim && dimension !== colDim,
  );

  const pivot = React.useMemo(() => {
    if (!result || result.isEmpty) return null;
    return buildPivot(result, {
      rowDimension: rowDim,
      columnDimension: colDim,
      rowOrder: rowDim === "pe" ? "time" : "total",
      columnOrder: colDim === "pe" ? "time" : "name",
      formatRow: rowDim === "pe" ? formatPeriod : undefined,
      formatColumn: colDim === "pe" ? formatPeriod : undefined,
    });
  }, [result, rowDim, colDim]);

  if (!checking && !connected) {
    return (
      <Alert tone="error" title="No DHIS2 connection">
        Add a server URL and access token on the{" "}
        <Link href="/connect" className="font-medium text-accent underline">
          connection page
        </Link>{" "}
        before running a query.
      </Alert>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[336px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <QueryPanel
          state={query}
          onChange={setQuery}
          onRun={() => void run()}
          running={running}
          dirty={dirty}
          disabled={!connected || !hydrated}
        />
      </aside>

      <div className="min-w-0 space-y-5">
        {error ? (
          <Alert tone="error" title="The query did not run">
            {error}
          </Alert>
        ) : null}

        {!result ? (
          <div className="rounded-xl border border-hair bg-surface">
            <EmptyState
              icon={<Grid3x3 className="size-7" aria-hidden />}
              title={running ? "Running the query…" : "Nothing queried yet"}
            >
              Choose the query on the left and run it. The result is laid out as a matrix
              you can re-arrange and export.
            </EmptyState>
          </div>
        ) : result.isEmpty ? (
          <Alert title="The query returned no values">
            DHIS2 answered successfully but had nothing for this combination.
          </Alert>
        ) : pivot ? (
          <ChartFrame
            title={`${dimensionTitle(rowDim)} × ${dimensionTitle(colDim)}`}
            description={`${pivot.rowKeys.length} rows × ${pivot.columnKeys.length} columns${
              collapsedInto.length
                ? `, summed over ${collapsedInto.map((d) => dimensionTitle(d).toLowerCase()).join(" and ")}`
                : ""
            }`}
            onDownload={() =>
              downloadCsv(pivotToCsv(pivot, dimensionTitle(rowDim)), `${stamped("dhis2-pivot")}.csv`)
            }
            legend={
              showHeat ? (
                <ScaleLegend
                  min={pivot.min}
                  max={pivot.max}
                  stops={heatScaleStops(5)}
                  format={formatCompact}
                />
              ) : null
            }
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="pivot-rows" className="sr-only">
                    Rows
                  </Label>
                  <Select
                    id="pivot-rows"
                    className="h-8 w-auto text-xs"
                    value={rowDim}
                    onChange={(event) => setRowDimension(event.target.value)}
                  >
                    {dimensions.map((dimension) => (
                      <option key={dimension} value={dimension}>
                        Rows: {dimensionTitle(dimension)}
                      </option>
                    ))}
                  </Select>

                  <Button
                    size="sm"
                    variant="ghost"
                    title="Swap rows and columns"
                    onClick={() => {
                      setRowDimension(colDim);
                      setColumnDimension(rowDim);
                    }}
                  >
                    <Repeat className="size-3.5" aria-hidden />
                    <span className="sr-only">Swap rows and columns</span>
                  </Button>

                  <Label htmlFor="pivot-columns" className="sr-only">
                    Columns
                  </Label>
                  <Select
                    id="pivot-columns"
                    className="h-8 w-auto text-xs"
                    value={colDim}
                    onChange={(event) => setColumnDimension(event.target.value)}
                  >
                    {dimensions
                      .filter((dimension) => dimension !== rowDim)
                      .map((dimension) => (
                        <option key={dimension} value={dimension}>
                          Columns: {dimensionTitle(dimension)}
                        </option>
                      ))}
                  </Select>
                </div>

                <Checkbox
                  label={<span className="text-xs text-ink-2">Heat</span>}
                  checked={showHeat}
                  onChange={(event) => setShowHeat(event.target.checked)}
                />
                <Checkbox
                  label={<span className="text-xs text-ink-2">Totals</span>}
                  checked={showTotals}
                  onChange={(event) => setShowTotals(event.target.checked)}
                />
              </div>
            }
            footnote={
              collapsedInto.length ? (
                <>
                  Each cell sums{" "}
                  {collapsedInto
                    .map(
                      (dimension) =>
                        `${dimensionValues(result, dimension).length} ${dimensionTitle(dimension).toLowerCase()}s`,
                    )
                    .join(" and ")}
                  . Put that dimension on an axis to see the values separately.
                </>
              ) : null
            }
          >
            <div className="px-3">
              <HeatTable
                pivot={pivot}
                rowTitle={dimensionTitle(rowDim)}
                showHeat={showHeat}
                showTotals={showTotals}
              />
            </div>
          </ChartFrame>
        ) : null}
      </div>
    </div>
  );
}
