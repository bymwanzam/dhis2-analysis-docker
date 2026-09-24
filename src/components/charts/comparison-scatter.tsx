"use client";

import * as React from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { formatNumber, formatPercent, formatTick, truncate } from "@/lib/format";
import type { ComparisonRow } from "@/lib/dhis2/quality";
import { CHART_INK } from "./palette";

/**
 * Two items plotted against each other, one point per organisation unit.
 *
 * The diagonal is equality. A unit whose two values agree sits exactly on it,
 * and every point off the line is a disagreement — distance from the line is
 * the size of the problem.
 *
 * Mismatched points are red **and** triangular. Colour alone would hide the
 * one thing this chart exists to show from a red-green reader. Matching units
 * stay in the neutral series blue rather than status green: the pair agreeing
 * does not prove either number is right.
 */
export function ComparisonScatter({
  rows,
  aName,
  bName,
  height = 340,
}: {
  rows: ComparisonRow[];
  aName: string;
  bName: string;
  height?: number;
}) {
  const points = React.useMemo(
    () =>
      rows
        .filter((row) => row.a !== null && row.b !== null)
        .map((row) => ({ ...row, x: row.b as number, y: row.a as number })),
    [rows],
  );

  const matching = points.filter((point) => point.flag === "match");
  const mismatched = points.filter((point) => point.flag !== "match");

  const extent = points.length
    ? Math.max(...points.map((point) => Math.max(point.x, point.y)))
    : 0;

  if (!points.length) {
    return (
      <p className="px-5 py-10 text-center text-sm text-ink-2">
        No organisation unit reported both items, so there is nothing to plot.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 12 }}>
        <CartesianGrid stroke={CHART_INK.grid} strokeWidth={1} />

        <XAxis
          type="number"
          dataKey="x"
          name={bName}
          tick={{ fill: CHART_INK.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.axis }}
          tickFormatter={formatTick}
          label={{
            value: truncate(bName, 42),
            position: "insideBottom",
            offset: -16,
            fill: CHART_INK.secondary,
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={aName}
          tick={{ fill: CHART_INK.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={formatTick}
          label={{
            value: truncate(aName, 28),
            angle: -90,
            position: "insideLeft",
            fill: CHART_INK.secondary,
            fontSize: 11,
            style: { textAnchor: "middle" },
          }}
        />
        <ZAxis range={[70, 70]} />

        {extent > 0 ? (
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: extent, y: extent },
            ]}
            stroke={CHART_INK.axis}
            strokeWidth={1}
            label={{
              value: "A = B",
              position: "insideTopRight",
              fill: CHART_INK.muted,
              fontSize: 11,
            }}
          />
        ) : null}

        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
          content={<ScatterTooltip aName={aName} bName={bName} />}
        />

        <Scatter
          name="Matches"
          data={matching}
          fill="var(--series-1)"
          stroke={CHART_INK.surface}
          strokeWidth={2}
          shape="circle"
          isAnimationActive={false}
        />
        <Scatter
          name="Does not match"
          data={mismatched}
          fill="var(--critical)"
          stroke={CHART_INK.surface}
          strokeWidth={2}
          shape="triangle"
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function ScatterTooltip({
  active,
  payload,
  aName,
  bName,
}: {
  active?: boolean;
  payload?: { payload?: ComparisonRow }[];
  aName: string;
  bName: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="pointer-events-none max-w-72 rounded-lg border border-hair bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-ink">{row.name}</p>
      <dl className="mt-1.5 space-y-0.5 text-xs">
        <Row label={truncate(aName, 26)} value={formatNumber(row.a)} />
        <Row label={truncate(bName, 26)} value={formatNumber(row.b)} />
        <Row
          label="Difference"
          value={row.difference === null ? "–" : formatNumber(row.difference)}
        />
        <Row label="Gap" value={row.gap === null ? "–" : formatPercent(row.gap)} />
      </dl>
      <p className="mt-1.5 border-t border-hair pt-1.5 text-xs text-ink-2">{row.note}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="truncate text-ink-2">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
