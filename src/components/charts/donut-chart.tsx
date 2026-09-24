"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCompact, formatNumber } from "@/lib/format";
import { CHART_INK, seriesColor } from "./palette";
import { SeriesTooltip } from "./chart-tooltip";

export interface Slice {
  id: string;
  name: string;
  value: number;
}

/** Part-to-whole is only legible at a glance; past six slices use bars. */
export const MAX_SLICES = 6;

export function DonutChart({
  slices,
  height = 300,
  centerLabel,
  valueFormatter = (value: number) => formatNumber(value),
}: {
  slices: Slice[];
  height?: number;
  centerLabel?: string;
  valueFormatter?: (value: number) => string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip
            isAnimationActive={false}
            content={<SeriesTooltip format={valueFormatter} total={total} />}
          />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="86%"
            paddingAngle={1}
            isAnimationActive={false}
            stroke={CHART_INK.surface}
            strokeWidth={2}
          >
            {slices.map((slice, index) => (
              <Cell key={slice.id} fill={seriesColor(index)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-ink">{formatCompact(total)}</span>
        {centerLabel ? (
          <span className="mt-0.5 max-w-32 text-center text-xs text-muted">{centerLabel}</span>
        ) : null}
      </div>
    </div>
  );
}
