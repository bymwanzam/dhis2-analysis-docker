"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesDescriptor } from "@/lib/dhis2/analytics";
import { formatNumber, formatTick, truncate } from "@/lib/format";
import { CHART_INK, seriesColor } from "./palette";
import { SeriesTooltip } from "./chart-tooltip";

type Point = Record<string, string | number | null>;

const AXIS_TICK = { fill: CHART_INK.muted, fontSize: 11 } as const;
const LABEL_GAP_PX = 16;

/**
 * Change over time: 2px lines, markers at ≥8px with a surface ring, a
 * hairline horizontal grid and no second y-axis — ever. Two measures of
 * different scale get two charts, not two scales.
 */
export function TimeSeriesChart({
  data,
  series,
  height = 320,
  valueFormatter = (value: number) => formatNumber(value),
  referenceValue = null,
  referenceLabel,
}: {
  data: Point[];
  series: SeriesDescriptor[];
  height?: number;
  valueFormatter?: (value: number) => string;
  /** A horizontal baseline to read the line against, such as an overall ratio. */
  referenceValue?: number | null;
  referenceLabel?: string;
}) {
  const names = React.useMemo(
    () => Object.fromEntries(series.map((item) => [item.id, item.name])),
    [series],
  );

  const lastIndex = data.length - 1;
  const showEveryDot = data.length <= 12;

  // Direct end-labels only while they cannot collide: measure the gap between
  // final values in pixels first, and fall back to the legend when they crowd.
  const endLabels = React.useMemo(() => {
    if (series.length > 4 || data.length === 0) return false;
    const values = series
      .map((item) => data[lastIndex]?.[item.id])
      .filter((value): value is number => typeof value === "number");
    if (values.length !== series.length) return false;

    const all = data.flatMap((point) =>
      series
        .map((item) => point[item.id])
        .filter((value): value is number => typeof value === "number"),
    );
    if (!all.length) return false;

    const span = Math.max(...all) - Math.min(...all);
    if (span === 0) return values.length === 1;

    const plotHeight = height - 48;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.every((value, index) => {
      if (index === 0) return true;
      return ((value - sorted[index - 1]) / span) * plotHeight >= LABEL_GAP_PX;
    });
  }, [data, series, height, lastIndex]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: endLabels ? 92 : 16, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeWidth={1} />
        <XAxis
          dataKey="__label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.axis }}
          minTickGap={16}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={formatTick}
        />
        {referenceValue !== null && Number.isFinite(referenceValue) ? (
          <ReferenceLine
            y={referenceValue}
            stroke={CHART_INK.axis}
            strokeWidth={1}
            label={
              referenceLabel
                ? {
                    value: referenceLabel,
                    position: "right",
                    fill: CHART_INK.muted,
                    fontSize: 11,
                  }
                : undefined
            }
          />
        ) : null}

        <Tooltip
          cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
          isAnimationActive={false}
          content={
            <SeriesTooltip
              format={valueFormatter}
              nameFor={(key) => names[key] ?? key}
            />
          }
        />
        {series.map((item, index) => {
          const color = seriesColor(index);
          return (
            <Line
              key={item.id}
              type="linear"
              dataKey={item.id}
              name={item.name}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls={false}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: color, stroke: CHART_INK.surface, strokeWidth: 2 }}
              dot={(props: DotProps) => (
                <EndDot
                  {...props}
                  key={`${item.id}-${props.index}`}
                  color={color}
                  showAll={showEveryDot}
                  lastIndex={lastIndex}
                  label={endLabels && props.index === lastIndex ? item.name : undefined}
                  labelValue={valueFormatter}
                />
              )}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

interface DotProps {
  cx?: number;
  cy?: number;
  index: number;
  value?: number | null;
}

/**
 * Markers carry a 2px surface ring so they stay legible where lines cross.
 * Past 12 points only the endpoint is marked — a dot on every point turns the
 * line into noise.
 */
function EndDot({
  cx,
  cy,
  index,
  value,
  color,
  showAll,
  lastIndex,
  label,
  labelValue,
}: DotProps & {
  color: string;
  showAll: boolean;
  lastIndex: number;
  label?: string;
  labelValue: (value: number) => string;
}) {
  if (cx === undefined || cy === undefined || value === null || value === undefined) {
    return <g />;
  }
  if (!showAll && index !== lastIndex && !label) return <g />;

  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={color} stroke={CHART_INK.surface} strokeWidth={2} />
      {label ? (
        <text
          x={cx + 10}
          y={cy}
          dominantBaseline="middle"
          fontSize={11}
          fill={CHART_INK.secondary}
        >
          <tspan fontWeight={600}>{labelValue(value)}</tspan>
          <tspan x={cx + 10} dy={12} fill={CHART_INK.muted}>
            {truncate(label, 14)}
          </tspan>
        </text>
      ) : null}
    </g>
  );
}
