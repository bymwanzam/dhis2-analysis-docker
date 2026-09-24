"use client";

import * as React from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { formatCompact, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * When the story is one number, the number is the chart.
 *
 * Direction is carried by an arrow and a named comparison period, not by
 * colour alone — and never coloured good/bad unless the caller says which
 * direction is good, because for half of DHIS2 indicators up is the bad news.
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  higherIsBetter,
  trend,
  hint,
  className,
}: {
  label: string;
  value: number | null;
  unit?: string;
  /** Percentage change against the comparison period. */
  delta?: number | null;
  deltaLabel?: string;
  higherIsBetter?: boolean;
  trend?: number[];
  hint?: string;
  className?: string;
}) {
  const direction = delta === null || delta === undefined ? 0 : Math.sign(delta);
  const Arrow = direction > 0 ? ArrowUpRight : direction < 0 ? ArrowDownRight : ArrowRight;

  const tone =
    higherIsBetter === undefined || direction === 0
      ? "text-ink-2"
      : (direction > 0) === higherIsBetter
        ? "text-success-text"
        : "text-critical";

  return (
    <div className={cn("rounded-xl border border-hair bg-surface px-4 py-3.5", className)}>
      <p className="truncate text-xs font-medium text-ink-2" title={label}>
        {label}
      </p>

      <div className="mt-1.5 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold leading-none text-ink">
          {formatCompact(value)}
          {unit ? <span className="ml-1 text-sm font-normal text-ink-2">{unit}</span> : null}
        </p>
        {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
      </div>

      {delta !== null && delta !== undefined ? (
        <p className={cn("mt-2 flex items-center gap-1 text-xs font-medium", tone)}>
          <Arrow className="size-3.5" aria-hidden />
          {formatPercent(delta)}
          {deltaLabel ? <span className="font-normal text-muted">{deltaLabel}</span> : null}
        </p>
      ) : hint ? (
        <p className="mt-2 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Twelve-point trend in the de-emphasis hue, current period in the accent. */
function Sparkline({ values, width = 76, height = 26 }: { values: number[]; width?: number; height?: number }) {
  const points = values.slice(-12);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const coords = points.map((value, index) => ({
    x: index * step,
    y: height - ((value - min) / span) * (height - 4) - 2,
  }));

  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const last = coords.at(-1);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend over the last ${points.length} periods`}
      className="shrink-0 overflow-visible"
    >
      <path d={path} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {last ? (
        <circle cx={last.x} cy={last.y} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
      ) : null}
    </svg>
  );
}
