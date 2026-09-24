"use client";

import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  ChartColumnBig,
  ChartPie,
  Layers,
  LineChart,
  Map as MapIcon,
} from "lucide-react";
import { ChartFrame, ChartLegend, type ChartView } from "@/components/charts/chart-frame";
import { CategoryBarChart } from "@/components/charts/category-bar-chart";
import { Column, DataTable } from "@/components/charts/data-table";
import { DonutChart, MAX_SLICES } from "@/components/charts/donut-chart";
import { StatTile } from "@/components/charts/stat-tile";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { useConnection } from "@/components/connection-provider";
import { QueryPanel } from "@/components/query/query-panel";
import { DEFAULT_QUERY, toAnalyticsQuery } from "@/components/query/query-state";
import { useAnalyticsSession } from "@/components/query/use-analytics";
import { MapBody, MapTable, useMapModel, type MapModel } from "@/components/explore/map-view";
import { Alert, EmptyState, Segmented, Select } from "@/components/ui/primitives";
import {
  PERIOD_REDUCTIONS,
  buildSeries,
  categoryTotals,
  combineSeries,
  collapsePeriods,
  dimensionTitle,
  dimensionValues,
  labelFor,
  percentChange,
  summarize,
  toCsv,
  type ParsedAnalytics,
  type PeriodReduction,
} from "@/lib/dhis2/analytics";
import { describeSummedOver } from "@/lib/dhis2/geo";
import { formatNumber, formatPeriod } from "@/lib/format";
import { downloadCsv } from "@/lib/download";

type ChartType = "line" | "columns" | "stacked" | "bars" | "donut" | "map";

const CHART_TYPES: { value: ChartType; label: string; icon: React.ReactNode }[] = [
  { value: "line", label: "Trend", icon: <LineChart className="size-3.5" /> },
  { value: "columns", label: "Columns", icon: <ChartColumnBig className="size-3.5" /> },
  { value: "stacked", label: "Stacked", icon: <Layers className="size-3.5" /> },
  { value: "bars", label: "Ranked", icon: <BarChart3 className="size-3.5" /> },
  { value: "donut", label: "Share", icon: <ChartPie className="size-3.5" /> },
  { value: "map", label: "Map", icon: <MapIcon className="size-3.5" /> },
];

const TIME_CHARTS: ChartType[] = ["line", "columns", "stacked"];

export function ExploreWorkbench() {
  const { status, loading: checking } = useConnection();
  const connected = status?.connected === true;

  const { query, setQuery, hydrated, result, resultQuery, error, running, dirty, run } =
    useAnalyticsSession("dhis2.explore.query", DEFAULT_QUERY, toAnalyticsQuery);

  const [chartType, setChartType] = React.useState<ChartType>("line");
  const [reduction, setReduction] = React.useState<PeriodReduction>("latest");
  const [view, setView] = React.useState<ChartView>("chart");
  const [mapItem, setMapItem] = React.useState<string | null>(null);

  /* ------------------------------------------------------------ shaping */

  /**
   * Every dimension except time, combined into one series each.
   *
   * There is nothing to choose between: picking one dimension would sum the
   * others away, so all of them are plotted and the reader is never shown a
   * total they did not ask for.
   */
  const combined = React.useMemo(
    () => (result ? combineSeries(result, "pe") : null),
    [result],
  );

  const breakdownDim = combined?.seriesDimension ?? "dx";
  const breakdownTitle = combined?.title ?? dimensionTitle("dx");

  const timeSeries = React.useMemo(() => {
    if (!combined || !result?.dimensions.includes("pe")) return null;
    return buildSeries(combined.parsed, {
      xDimension: "pe",
      seriesDimension: combined.seriesDimension,
      xOrder: "time",
      formatX: formatPeriod,
    });
  }, [combined, result]);

  const collapsed = React.useMemo(
    () => (result ? collapsePeriods(result, reduction) : null),
    [result, reduction],
  );

  // Periods are already folded away here, so every dimension that remains is
  // combined into the category being ranked.
  const collapsedCombined = React.useMemo(
    () => (collapsed ? combineSeries(collapsed) : null),
    [collapsed],
  );

  const categories = React.useMemo(
    () =>
      collapsedCombined
        ? categoryTotals(collapsedCombined.parsed, collapsedCombined.seriesDimension)
        : [],
    [collapsedCombined],
  );

  const summaries = React.useMemo(
    () =>
      combined ? summarize(combined.parsed, combined.seriesDimension).slice(0, 4) : [],
    [combined],
  );

  const periodCount = result?.dimensions.includes("pe")
    ? dimensionValues(result, "pe").length
    : 0;

  const donutUsable =
    categories.length > 1 &&
    categories.length <= MAX_SLICES &&
    categories.every((item) => item.value >= 0);

  // A stale selection must not silently drop categories or draw a negative
  // slice, so the chart falls back instead of half-rendering.
  const effectiveChart: ChartType =
    chartType === "donut" && !donutUsable ? "bars" : chartType;

  const isTimeChart = TIME_CHARTS.includes(effectiveChart);
  const isMap = effectiveChart === "map";
  const reductionLabel =
    PERIOD_REDUCTIONS.find((option) => option.value === reduction)?.describe ?? "";

  const map = useMapModel({
    enabled: isMap,
    collapsed,
    ou: resultQuery?.ou ?? null,
    selectedItem: mapItem,
  });
  const mapItemName = map.dataItems.find((item) => item.id === map.dataItem)?.name ?? "Value";

  /* -------------------------------------------------------------- render */

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
              icon={<LineChart className="size-7" aria-hidden />}
              title={running ? "Running the query…" : "Nothing queried yet"}
            >
              Choose a data item, a period and an organisation unit on the left, then run
              the query. Results appear here as a chart, a set of figures and a table.
            </EmptyState>
          </div>
        ) : result.isEmpty ? (
          <Alert title="The query returned no values">
            DHIS2 answered successfully but had nothing for this combination. Widen the
            period, pick a higher organisation unit, or check that analytics tables have
            been generated since the data was captured.
          </Alert>
        ) : (
          <>
            {summaries.length ? (
              <section aria-label="Key figures">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xs font-medium text-ink-2">
                    {periodCount > 1 ? "Latest period" : "Total"}, by{" "}
                    {breakdownTitle.toLowerCase()}
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {summaries.map((summary) => (
                  <StatTile
                    key={summary.id}
                    label={summary.name}
                    value={periodCount > 1 ? summary.latest : summary.total}
                    delta={
                      periodCount > 1
                        ? percentChange(summary.latest, summary.previous)
                        : undefined
                    }
                    deltaLabel={
                      summary.previousPeriod
                        ? `vs ${formatPeriod(summary.previousPeriod)}`
                        : undefined
                    }
                    trend={periodCount > 2 ? summary.trend.map((point) => point.value) : undefined}
                    hint={
                      summary.latestPeriod
                        ? `Latest: ${formatPeriod(summary.latestPeriod)}`
                        : undefined
                    }
                  />
                  ))}
                </div>
              </section>
            ) : null}

            <ChartFrame
              title={
                isMap
                  ? `${mapItemName} by organisation unit`
                  : chartTitle(effectiveChart, result, breakdownTitle)
              }
              description={
                isTimeChart
                  ? `${periodCount} period${periodCount === 1 ? "" : "s"}, broken down by ${breakdownTitle.toLowerCase()}`
                  : isMap
                    ? `Coloured in equal steps from lowest to highest, ${periodCount > 1 ? reductionLabel : "for the one period in the result"}`
                    : `${breakdownTitle} ranked by value, ${reductionLabel}`
              }
              view={view}
              onViewChange={setView}
              onDownload={() => downloadCsv(toCsv(result), "dhis2-analysis.csv")}
              legend={
                view === "chart" && !isMap ? (
                  <ChartLegend
                    series={
                      isTimeChart
                        ? (timeSeries?.series ?? [])
                        : effectiveChart === "donut"
                          ? categories.map((item) => ({ id: item.id, name: item.name }))
                          : []
                    }
                    shape={effectiveChart === "line" ? "line" : "dot"}
                  />
                ) : null
              }
              toolbar={
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    ariaLabel="Chart type"
                    value={effectiveChart}
                    onChange={setChartType}
                    options={CHART_TYPES.filter(
                      (option) => option.value !== "donut" || donutUsable,
                    )}
                  />
                  {isMap && map.dataItems.length > 1 ? (
                    <Select
                      aria-label="Data item shown on the map"
                      value={map.dataItem ?? ""}
                      onChange={(event) => setMapItem(event.target.value)}
                      className="h-8 max-w-56 text-xs"
                    >
                      {map.dataItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {!isTimeChart && periodCount > 1 ? (
                    <Segmented
                      ariaLabel="How periods are combined"
                      value={reduction}
                      onChange={setReduction}
                      options={PERIOD_REDUCTIONS.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                    />
                  ) : null}
                </div>
              }
              footnote={
                isMap ? (
                  <MapFootnotes model={map} />
                ) : (
                  <Footnotes
                    hidden={isTimeChart ? (timeSeries?.hiddenSeries.length ?? 0) : 0}
                  />
                )
              }
            >
              {view === "table" && isMap ? (
                <MapTable model={map} parsed={result} />
              ) : view === "table" ? (
                <ResultTable parsed={result} />
              ) : isMap ? (
                <MapBody
                  model={map}
                  valueCaption={mapValueCaption(reduction, result, periodCount)}
                />
              ) : (
                <ChartBody
                  chartType={effectiveChart}
                  timeSeries={timeSeries}
                  categories={categories}
                  breakdownTitle={breakdownTitle}
                  measureName={measureName(result, breakdownDim)}
                />
              )}
            </ChartFrame>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- chart body */

function ChartBody({
  chartType,
  timeSeries,
  categories,
  breakdownTitle,
  measureName,
}: {
  chartType: ChartType;
  timeSeries: ReturnType<typeof buildSeries> | null;
  categories: { id: string; name: string; value: number }[];
  breakdownTitle: string;
  measureName: string;
}) {
  // One category is a number, not a chart — a single bar says nothing a
  // figure does not say better.
  if (!TIME_CHARTS.includes(chartType) && categories.length === 1) {
    return (
      <div className="px-3 py-6">
        <StatTile
          label={categories[0].name}
          value={categories[0].value}
          hint={`Only one ${breakdownTitle.toLowerCase()} in this result`}
        />
      </div>
    );
  }

  if (chartType === "donut") {
    return (
      <DonutChart
        slices={categories}
        centerLabel={`across ${categories.length} ${breakdownTitle.toLowerCase()}`}
      />
    );
  }

  if (chartType === "bars") {
    return (
      <CategoryBarChart
        orientation="bars"
        data={categories.map((item) => ({
          __x: item.id,
          __label: item.name,
          value: item.value,
        }))}
        series={[{ id: "value", name: measureName }]}
      />
    );
  }

  if (!timeSeries || !timeSeries.data.length) {
    return (
      <EmptyState title="No period dimension in this result">
        Add a period to the query to chart change over time.
      </EmptyState>
    );
  }

  if (chartType === "line") {
    return <TimeSeriesChart data={timeSeries.data} series={timeSeries.series} />;
  }

  return (
    <CategoryBarChart
      orientation="columns"
      stacked={chartType === "stacked"}
      data={timeSeries.data}
      series={timeSeries.series}
    />
  );
}

/* ----------------------------------------------------------- table view */

interface TableRow {
  cells: string[];
  value: number;
}

function ResultTable({ parsed }: { parsed: ParsedAnalytics }) {
  const rows: TableRow[] = React.useMemo(
    () =>
      parsed.rows.map((row) => ({
        cells: parsed.dimensions.map((dimension) =>
          dimension === "pe"
            ? formatPeriod(String(row[dimension]))
            : labelFor(parsed, String(row[dimension])),
        ),
        value: row.value,
      })),
    [parsed],
  );

  const columns: Column<TableRow>[] = React.useMemo(
    () => [
      ...parsed.dimensions.map((dimension, index) => ({
        key: dimension,
        header: dimensionTitle(dimension),
        render: (row: TableRow) => row.cells[index],
        sortValue: (row: TableRow) => row.cells[index],
      })),
      {
        key: "value",
        header: "Value",
        numeric: true,
        render: (row: TableRow) => formatNumber(row.value),
        sortValue: (row: TableRow) => row.value,
      },
    ],
    [parsed.dimensions],
  );

  return (
    <div className="px-3">
      <DataTable columns={columns} rows={rows} caption="Every value returned by the query" />
    </div>
  );
}

/* -------------------------------------------------------------- footnotes */

function Footnotes({ hidden }: { hidden: number }) {
  const notes: React.ReactNode[] = [];

  if (hidden > 0) {
    notes.push(
      <span key="hidden">
        {hidden} more ranked below the chart&rsquo;s colour limit — switch to the table to
        see every value.
      </span>,
    );
  }

  if (!notes.length) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">{notes}</span>
  );
}

/**
 * What the map is not showing, said on the map. Each of these changes how the
 * colours should be read, so none of them is left for the reader to discover.
 */
function MapFootnotes({ model }: { model: MapModel }) {
  if (model.loading || model.error) return null;
  const notes: React.ReactNode[] = [];

  if (model.summedOver.length) {
    notes.push(
      <span key="summed">
        Each unit&rsquo;s value is summed across {describeSummedOver(model.summedOver)}.
      </span>,
    );
  }
  if (model.levelCount > 1) {
    notes.push(
      <span key="levels">
        Units from {model.levelCount} hierarchy levels share one colour scale, so larger
        units read darker for their size alone — pick a single level to compare like with
        like.
      </span>,
    );
  }
  if (model.noDataCount > 0) {
    notes.push(
      <span key="nodata">
        {model.noDataCount} unit{model.noDataCount === 1 ? "" : "s"} returned no value and{" "}
        {model.noDataCount === 1 ? "is" : "are"} shown in grey as No data, not as zero.
      </span>,
    );
  }
  if (model.unmappedCount > 0) {
    notes.push(
      <span key="unmapped">
        {model.unmappedCount} unit{model.unmappedCount === 1 ? " has" : "s have"} a value but
        no coordinates in DHIS2 — see the table.
      </span>,
    );
  }

  if (!notes.length) return null;
  return <span className="flex flex-wrap items-center gap-x-4 gap-y-1">{notes}</span>;
}

/* ------------------------------------------------------------- utilities */

/** What one unit's value on the map is, in the tooltip's words. */
function mapValueCaption(
  reduction: PeriodReduction,
  parsed: ParsedAnalytics,
  periodCount: number,
): string {
  const periods = parsed.dimensions.includes("pe") ? dimensionValues(parsed, "pe", "time") : [];
  if (periodCount <= 1) return periods[0] ? formatPeriod(periods[0]) : "Value";
  if (reduction === "latest") return formatPeriod(periods.at(-1) ?? "");
  if (reduction === "sum") return `Total, ${periodCount} periods`;
  return `Average, ${periodCount} periods`;
}

function chartTitle(
  chartType: ChartType,
  parsed: ParsedAnalytics,
  breakdownTitle: string,
): string {
  const items = dimensionValues(parsed, "dx", "total");
  const single = items.length === 1 ? labelFor(parsed, items[0]) : null;

  if (TIME_CHARTS.includes(chartType)) {
    return single ? `${single} over time` : "Values over time";
  }
  const by = breakdownTitle.toLowerCase();
  return single ? `${single} by ${by}` : `Values by ${by}`;
}

function measureName(parsed: ParsedAnalytics, breakdownDim: string): string {
  if (breakdownDim === "dx") return "Value";
  const items = dimensionValues(parsed, "dx", "total");
  return items.length === 1 ? labelFor(parsed, items[0]) : "Value";
}
