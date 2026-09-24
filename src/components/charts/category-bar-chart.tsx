"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesDescriptor } from "@/lib/dhis2/analytics";
import { formatCompact, formatNumber, formatTick, truncate } from "@/lib/format";
import { CHART_INK, seriesColor } from "./palette";
import { SeriesTooltip } from "./chart-tooltip";

type Point = Record<string, string | number | null>;

const AXIS_TICK = { fill: CHART_INK.muted, fontSize: 11 } as const;
const CATEGORY_TICK = { fill: CHART_INK.secondary, fontSize: 11 } as const;
const BAR_THICKNESS = 24;
const SURFACE_GAP = 2;
const END_RADIUS = 4;

/**
 * Magnitude across categories.
 *
 * Bars are capped at 24px so the band keeps its air, the data end is rounded
 * 4px while the baseline end stays square, and touching marks are separated
 * by a 2px gap in the surface colour rather than by a stroke.
 */
export function CategoryBarChart({
  data,
  series,
  orientation = "bars",
  stacked = false,
  height,
  categoryWidth = 150,
  valueFormatter = (value: number) => formatNumber(value),
}: {
  data: Point[];
  series: SeriesDescriptor[];
  /** "bars" = horizontal, ranked. "columns" = vertical, time or ordered categories. */
  orientation?: "bars" | "columns";
  stacked?: boolean;
  height?: number;
  categoryWidth?: number;
  valueFormatter?: (value: number) => string;
}) {
  const names = React.useMemo(
    () => Object.fromEntries(series.map((item) => [item.id, item.name])),
    [series],
  );

  const isBars = orientation === "bars";
  const single = series.length === 1;
  const seriesIds = series.map((item) => item.id);

  const plotHeight =
    height ?? (isBars ? Math.max(180, data.length * 34 + 48) : 320);

  return (
    <ResponsiveContainer width="100%" height={plotHeight}>
      <BarChart
        data={data}
        layout={isBars ? "vertical" : "horizontal"}
        margin={{
          top: 8,
          right: isBars && single ? 64 : 16,
          bottom: 4,
          left: isBars ? 4 : 4,
        }}
        barGap={SURFACE_GAP}
        barCategoryGap="22%"
      >
        <CartesianGrid
          horizontal={!isBars}
          vertical={isBars}
          stroke={CHART_INK.grid}
          strokeWidth={1}
        />

        {isBars ? (
          <>
            <XAxis
              type="number"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTick}
            />
            <YAxis
              type="category"
              dataKey="__label"
              tick={CATEGORY_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              width={categoryWidth}
              interval={0}
              tickFormatter={(value: string) => truncate(value, 24)}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="__label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={formatTick}
            />
          </>
        )}

        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          isAnimationActive={false}
          content={
            <SeriesTooltip format={valueFormatter} nameFor={(key) => names[key] ?? key} />
          }
        />

        {series.map((item, index) => {
          const color = seriesColor(index);
          const shared = {
            dataKey: item.id,
            name: item.name,
            fill: color,
            maxBarSize: BAR_THICKNESS,
            isAnimationActive: false,
          } as const;

          if (stacked && series.length > 1) {
            return (
              <Bar
                key={item.id}
                {...shared}
                stackId="total"
                shape={
                  <StackSegment
                    seriesId={item.id}
                    seriesIds={seriesIds}
                    isBars={isBars}
                  />
                }
              />
            );
          }

          return (
            <Bar
              key={item.id}
              {...shared}
              radius={isBars ? [0, END_RADIUS, END_RADIUS, 0] : [END_RADIUS, END_RADIUS, 0, 0]}
            >
              {isBars && single ? (
                <LabelList
                  dataKey={item.id}
                  position="right"
                  offset={8}
                  fill={CHART_INK.secondary}
                  fontSize={11}
                  formatter={(value) => formatCompact(Number(value))}
                />
              ) : null}
            </Bar>
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: Record<string, string | number | null>;
}

/**
 * A stacked segment separated by surface, not by a border: each segment below
 * the top one gives back 2px on the side it touches its neighbour, and only
 * the outermost segment carries the rounded data end.
 */
function StackSegment({
  seriesId,
  seriesIds,
  isBars,
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill,
  payload,
}: ShapeProps & { seriesId: string; seriesIds: string[]; isBars: boolean }) {
  if (width <= 0 || height <= 0) return <g />;

  const outermost = [...seriesIds]
    .reverse()
    .find((id) => typeof payload?.[id] === "number" && (payload[id] as number) !== 0);
  const isOuter = outermost === seriesId;

  const rectX = x;
  let rectY = y;
  let rectW = width;
  let rectH = height;

  if (!isOuter) {
    if (isBars) rectW = Math.max(1, width - SURFACE_GAP);
    else {
      rectY = y + SURFACE_GAP;
      rectH = Math.max(1, height - SURFACE_GAP);
    }
  }

  const radius = isOuter ? END_RADIUS : 0;
  const path = isBars
    ? roundedPath(rectX, rectY, rectW, rectH, { tr: radius, br: radius })
    : roundedPath(rectX, rectY, rectW, rectH, { tl: radius, tr: radius });

  return <path d={path} fill={fill} />;
}

/** Rectangle with per-corner radii, so only the data end is rounded. */
function roundedPath(
  x: number,
  y: number,
  width: number,
  height: number,
  { tl = 0, tr = 0, br = 0, bl = 0 }: { tl?: number; tr?: number; br?: number; bl?: number },
): string {
  const limit = Math.min(width, height) / 2;
  const a = Math.min(tl, limit);
  const b = Math.min(tr, limit);
  const c = Math.min(br, limit);
  const d = Math.min(bl, limit);

  return [
    `M${x + a},${y}`,
    `H${x + width - b}`,
    b ? `A${b},${b} 0 0 1 ${x + width},${y + b}` : "",
    `V${y + height - c}`,
    c ? `A${c},${c} 0 0 1 ${x + width - c},${y + height}` : "",
    `H${x + d}`,
    d ? `A${d},${d} 0 0 1 ${x},${y + height - d}` : "",
    `V${y + a}`,
    a ? `A${a},${a} 0 0 1 ${x + a},${y}` : "",
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}
