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
 * Colour schemes for a choropleth: single-hue ordinal ramps of six steps,
 * as CSS tokens (`--map-<scheme>-1` … `-6`, low to high) stepped separately
 * for the light and dark surfaces in globals.css. Every ramp was generated in
 * OKLCH and passed the dataviz ordinal validator against both surfaces:
 * monotone lightness, at least 0.06 L between neighbours, and a pale end that
 * still clears the surface at 2:1. The order here is the order in the picker.
 */
export const MAP_SCHEMES = [
  { id: "blue", label: "Blue" },
  { id: "teal", label: "Teal" },
  { id: "green", label: "Green" },
  { id: "purple", label: "Purple" },
  { id: "orange", label: "Orange" },
  { id: "red", label: "Red" },
] as const;

export type MapScheme = (typeof MAP_SCHEMES)[number]["id"];

export const DEFAULT_MAP_SCHEME: MapScheme = "blue";

export const MAP_RAMP_STEPS = 6;

export function isMapScheme(value: unknown): value is MapScheme {
  return MAP_SCHEMES.some((scheme) => scheme.id === value);
}

/**
 * Which step of the ramp the nth of `count` classes takes, 1-based.
 *
 * Classes are spread over the whole ramp rather than taking its first few
 * steps: two classes are the palest and the deepest step, and neighbouring
 * classes sit as far apart as the ramp allows. There are never more classes
 * than steps — equal-interval maps draw at most five and the fixed coverage
 * scale has six.
 */
export function mapClassStep(index: number, count: number): number {
  if (count <= 1) return MAP_RAMP_STEPS;
  const clamped = Math.max(0, Math.min(count - 1, index));
  return 1 + Math.round((clamped / (count - 1)) * (MAP_RAMP_STEPS - 1));
}

/** Fill for one class of a choropleth, from the chosen scheme's ramp. */
export function mapClassFill(
  index: number,
  count: number,
  scheme: MapScheme = DEFAULT_MAP_SCHEME,
): string {
  return `var(--map-${scheme}-${mapClassStep(index, count)})`;
}

/** A scheme's whole ramp, low to high, for a picker swatch. */
export function mapRamp(scheme: MapScheme): string[] {
  return Array.from(
    { length: MAP_RAMP_STEPS },
    (_, step) => `var(--map-${scheme}-${step + 1})`,
  );
}
