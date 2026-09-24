/**
 * Chart colour roles.
 *
 * Every value here is a CSS custom property, so a theme change repaints the
 * SVG without React re-rendering, and light/dark stay two selected palettes
 * rather than one flipped palette.
 *
 * The categorical order is fixed and validated (adjacent-pair CVD ΔE ≥ 8 in
 * both modes). Slots are assigned by entity, in order, and never cycled — a
 * ninth series is not a colour, it is a signal to rank and cap.
 */

export const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

export const MAX_SERIES = SERIES_COLORS.length;

/**
 * Colour for the nth series. Past the palette size the caller has already
 * gone wrong — cap the series list instead of asking for slot 9.
 */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % MAX_SERIES];
}

/**
 * Charts that place every pair of colours side by side (scatter, choropleth,
 * small multiples) only clear the separation floors for the first three slots.
 */
export const MAX_SERIES_ALL_PAIRS = 3;

export const CHART_INK = {
  primary: "var(--ink)",
  secondary: "var(--ink-2)",
  muted: "var(--muted)",
  grid: "var(--grid)",
  axis: "var(--axis)",
  surface: "var(--surface)",
} as const;

/**
 * Sequential fill for magnitude, as a single hue anchored to the chart
 * surface: near-zero recedes into the surface, the maximum is the accent.
 * Capping the mix keeps ink legible on the darkest cell in both themes.
 */
export function heatFill(
  value: number | null,
  min: number,
  max: number,
  { maxMix = 55 }: { maxMix?: number } = {},
): string {
  if (value === null || !Number.isFinite(value)) return "transparent";
  const span = max - min;
  const intensity = span <= 0 ? (value > 0 ? 1 : 0) : (value - min) / span;
  const mix = Math.round(4 + Math.max(0, Math.min(1, intensity)) * (maxMix - 4));
  return `color-mix(in oklab, var(--accent) ${mix}%, var(--surface))`;
}

/** Evenly spaced stops for the sequential scale legend. */
export function heatScaleStops(steps = 5): string[] {
  return Array.from({ length: steps }, (_, index) =>
    heatFill(index, 0, steps - 1),
  );
}

/**
 * Fill for one class of a choropleth, on the same single-hue ramp as the heat
 * table.
 *
 * The ramp starts well off the surface rather than at it: a map has no number
 * printed in each shape, so the lowest class has to stay distinguishable from
 * the page and from the hatched "No data" fill. It also runs darker than the
 * heat table's cap, because no ink sits on top of it.
 */
export function mapClassFill(index: number, count: number): string {
  const low = 16;
  const high = 90;
  const mix = count <= 1 ? high : Math.round(low + (index / (count - 1)) * (high - low));
  return `color-mix(in oklab, var(--accent) ${mix}%, var(--surface))`;
}
