"use client";

import * as React from "react";
import {
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  classIndex,
  fitLabel,
  type MapClass,
  type MapLayout,
} from "@/lib/dhis2/geo";
import { formatNumber, formatTick } from "@/lib/format";
import { cn } from "@/lib/utils";
import { mapClassFill } from "./palette";

const NO_DATA_PATTERN = "map-no-data";

/**
 * Neutral grey for "No data": no hue, so it never reads as a class. Built
 * from the theme's own muted ink, so a repainted panel does not change it.
 */
export const NO_DATA_FILL = "color-mix(in oklab, var(--base-muted) 38%, var(--surface))";

/**
 * Organisation units coloured by value.
 *
 * Drawn as plain SVG from DHIS2's own boundaries, with no tile layer: nothing
 * leaves this app for a third-party map server, the fills are CSS custom
 * properties like every other chart so a theme change repaints it, and the
 * chart image export reads it the same way it reads a Recharts plot.
 *
 * A unit with no value is neutral grey with a faint hatch, never filled as
 * zero — a gap in reporting and a reported zero are different findings. The
 * hatch keeps it apart from the palest class for a reader who cannot tell the
 * grey from a light blue.
 *
 * Areas carry their name where it fits, wrapped over up to three lines, in
 * ink with a halo in the surface colour so it reads on the palest and the
 * darkest class alike. An area too small for a readable label goes without —
 * the name is in the tooltip and the table.
 *
 * The legend, when given, sits to the right of the map on a wide screen and
 * drops below it on a narrow one.
 */
export function ChoroplethMap({
  layout,
  values,
  classes,
  names,
  valueCaption = "Value",
  renderTooltip,
  onSelect,
  canSelect,
  ariaLabel = "Map of organisation units coloured by value. The table view lists every value.",
  legend,
  showLabels = true,
}: {
  layout: MapLayout;
  values: Map<string, number>;
  classes: MapClass[];
  names?: Map<string, string>;
  /** What the value in the default tooltip is, e.g. "Mar 2026". */
  valueCaption?: string;
  /** Replaces the default tooltip body. */
  renderTooltip?: (id: string) => React.ReactNode;
  /** Called when a shape is clicked. */
  onSelect?: (id: string) => void;
  /** Whether a shape responds to a click; drives the cursor. */
  canSelect?: (id: string) => boolean;
  ariaLabel?: string;
  /** The key, drawn beside the map. */
  legend?: React.ReactNode;
  /** Names inside the areas; needs `names`. */
  showLabels?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<{
    id: string;
    x: number;
    y: number;
    width: number;
  } | null>(null);

  const fillFor = React.useCallback(
    (id: string) => {
      const value = values.get(id);
      if (value === undefined) return `url(#${NO_DATA_PATTERN})`;
      return mapClassFill(classIndex(value, classes), classes.length);
    },
    [values, classes],
  );

  // Hovering must not re-render a few thousand paths, so the shapes are built
  // once per layout and the highlight is drawn as a separate overlay.
  const shapes = React.useMemo(
    () =>
      layout.shapes.map((shape) => {
        const selectable = onSelect && (canSelect?.(shape.id) ?? true);
        const className = selectable ? "cursor-pointer" : undefined;
        return shape.type === "area" ? (
          <path
            key={shape.id}
            data-id={shape.id}
            d={shape.d}
            fill={fillFor(shape.id)}
            fillRule="evenodd"
            stroke="var(--surface)"
            strokeWidth={1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={className}
          />
        ) : (
          <circle
            key={shape.id}
            data-id={shape.id}
            cx={shape.cx}
            cy={shape.cy}
            r={5}
            fill={fillFor(shape.id)}
            stroke="var(--surface)"
            strokeWidth={2}
            className={className}
          />
        );
      }),
    [layout, fillFor, onSelect, canSelect],
  );

  const labels = React.useMemo(() => {
    if (!showLabels || !names) return null;
    return layout.shapes.map((shape) => {
      if (shape.type !== "area" || !shape.label) return null;
      const name = names.get(shape.id);
      const lines = name ? fitLabel(name, shape.label) : null;
      if (!lines) return null;
      const top = shape.label.y - ((lines.length - 1) * LABEL_LINE_HEIGHT) / 2;
      return (
        <text
          key={shape.id}
          x={shape.label.x}
          y={top}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={LABEL_FONT_SIZE}
          fontWeight={500}
          fill="var(--ink)"
          stroke="var(--surface)"
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          <title>{name}</title>
          {lines.map((line, index) => (
            <tspan key={index} x={shape.label!.x} dy={index === 0 ? 0 : LABEL_LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
        </text>
      );
    });
  }, [layout, names, showLabels]);

  const hovered = hover ? layout.shapes.find((shape) => shape.id === hover.id) : undefined;

  function idAt(event: React.PointerEvent | React.MouseEvent): string | null {
    return (event.target as Element).getAttribute?.("data-id") ?? null;
  }

  function track(event: React.PointerEvent<SVGSVGElement>) {
    const id = idAt(event);
    const box = containerRef.current?.getBoundingClientRect();
    if (!id || !box) {
      setHover(null);
      return;
    }
    setHover({ id, x: event.clientX - box.left, y: event.clientY - box.top, width: box.width });
  }

  function select(event: React.MouseEvent<SVGSVGElement>) {
    const id = idAt(event);
    if (!id || !onSelect || !(canSelect?.(id) ?? true)) return;
    setHover(null);
    onSelect(id);
  }

  const hoveredValue = hover ? values.get(hover.id) : undefined;

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
    {/* The map keeps the theme's ink even when the panel around it is
        repainted: its labels, halo and tooltip are drawn against the fills,
        not against the panel. */}
    <div ref={containerRef} className="theme-ink relative min-w-0 flex-1">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="mx-auto block h-auto max-h-[560px] w-full"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={track}
        onPointerLeave={() => setHover(null)}
        onClick={select}
      >
        <defs>
          <pattern
            id={NO_DATA_PATTERN}
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={6} height={6} fill={NO_DATA_FILL} />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--surface)" strokeOpacity={0.5} strokeWidth={1} />
          </pattern>
        </defs>

        <g>{shapes}</g>
        {labels ? (
          <g pointerEvents="none" aria-hidden>
            {labels}
          </g>
        ) : null}

        {hovered ? (
          hovered.type === "area" ? (
            <path
              d={hovered.d}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : (
            <circle
              cx={hovered.cx}
              cy={hovered.cy}
              r={6}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={2}
              pointerEvents="none"
            />
          )
        ) : null}
      </svg>

      {hover ? (
        <div
          className="pointer-events-none absolute z-10 min-w-44 max-w-80 rounded-lg border border-hair bg-surface px-3 py-2 shadow-lg"
          style={{
            top: hover.y + 14,
            // Flip to the left of the pointer near the right edge.
            ...(hover.x > hover.width - 260
              ? { right: hover.width - hover.x + 14 }
              : { left: hover.x + 14 }),
          }}
        >
          {renderTooltip ? (
            renderTooltip(hover.id)
          ) : (
            <>
              <p className="text-xs font-medium text-ink">{names?.get(hover.id) ?? hover.id}</p>
              <p className="mt-1 flex items-baseline justify-between gap-4 text-xs">
                <span className="text-ink-2">{valueCaption}</span>
                <span className="font-medium tabular-nums text-ink">
                  {hoveredValue === undefined ? "No data" : formatNumber(hoveredValue)}
                </span>
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
    {legend ? (
      <aside
        data-chart-legend
        aria-label="Map key"
        className="shrink-0 border-t border-hair pt-3 md:w-52 md:border-l md:border-t-0 md:pl-4 md:pt-0"
      >
        {legend}
      </aside>
    ) : null}
    </div>
  );
}

function defaultRange(range: MapClass): string {
  return range.from === range.to
    ? formatTick(range.from)
    : `${formatTick(range.from)} – ${formatTick(range.to)}`;
}

/**
 * The key for the classes, required whenever magnitude is a colour.
 *
 * Drawn as a list of swatches so the chart image export picks it up the same
 * way it reads a series legend.
 */
export function MapLegend({
  classes,
  showNoData,
  formatRange = defaultRange,
  title,
  orientation = "horizontal",
  className,
}: {
  classes: MapClass[];
  showNoData: boolean;
  formatRange?: (range: MapClass, index: number) => string;
  /** What the colour measures, shown before the swatches. */
  title?: string;
  /** Vertical sits beside a map; horizontal above it. */
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  if (!classes.length && !showNoData) return null;
  const vertical = orientation === "vertical";

  return (
    <div
      className={cn(
        vertical ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-x-4 gap-y-1.5",
        className,
      )}
    >
      {title ? <span className="text-xs font-medium text-ink">{title}</span> : null}
      <ul
        className={cn(
          vertical ? "flex flex-col gap-1.5" : "flex flex-wrap items-center gap-x-4 gap-y-1.5",
        )}
        aria-label="Map key"
      >
        {classes.map((range, index) => (
          <li key={index} className="flex items-center gap-1.5 text-xs text-ink-2">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-sm"
              style={{ background: mapClassFill(index, classes.length) }}
            />
            <span className="tabular-nums">{formatRange(range, index)}</span>
          </li>
        ))}
        {showNoData ? (
          <li className="flex items-center gap-1.5 text-xs text-ink-2">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-sm"
              style={{ background: NO_DATA_FILL }}
            />
            <span>No data</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
