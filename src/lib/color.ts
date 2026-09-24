/**
 * Readable text on a background the user chose.
 *
 * The Maps page lets a viewer repaint the panel the map sits in. The text in
 * that panel — title, description, legend, footnotes — has to stay readable
 * on whatever they pick, so its colours are derived here from the background
 * and checked against WCAG contrast rather than guessed.
 */

type Rgb = [number, number, number];

/** #rgb or #rrggbb, case-insensitive. Anything else is not a colour here. */
export function parseHex(value: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1].split("").map((digit) => digit + digit).join("")
      : match[1];
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** `weight` of `a`, the rest `b`, mixed in sRGB. */
function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return a.map((channel, index) => channel * weight + b[index] * (1 - weight)) as Rgb;
}

/**
 * Pure black, not the theme's near-black: with black and white as the two
 * choices, one of them always clears 4.58:1 on any background, while the
 * theme's #0b0b0b leaves mid greys around #777 with neither reaching AA.
 */
const DARK_INK: Rgb = [0, 0, 0];
const LIGHT_INK: Rgb = [255, 255, 255];

/** Normal-size text: WCAG AA. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * The softest mix of ink into the background that still reads as text.
 * Starts at `preferred` and strengthens until it clears AA; the full ink is
 * the floor, and it always clears AA because it was chosen for contrast.
 */
function softenedInk(ink: Rgb, background: Rgb, preferred: number): Rgb {
  for (let weight = preferred; weight < 1; weight += 0.04) {
    const candidate = mix(ink, background, weight);
    if (contrast(candidate, background) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return ink;
}

export interface PanelInk {
  tone: "dark" | "light";
  ink: string;
  ink2: string;
  muted: string;
  hair: string;
}

/**
 * Text colours for a panel of the given background, or null when the value is
 * not a colour. Dark or light ink is whichever contrasts more; the secondary
 * and muted tints are lightened from it only as far as AA allows, so a mid
 * grey panel gets near-black secondary text rather than an unreadable grey.
 */
export function panelInk(background: string): PanelInk | null {
  const bg = parseHex(background);
  if (!bg) return null;

  const tone = contrast(DARK_INK, bg) >= contrast(LIGHT_INK, bg) ? "dark" : "light";
  const ink = tone === "dark" ? DARK_INK : LIGHT_INK;

  return {
    tone,
    ink: toHex(ink),
    ink2: toHex(softenedInk(ink, bg, 0.7)),
    muted: toHex(softenedInk(ink, bg, 0.55)),
    hair: tone === "dark" ? "rgba(0, 0, 0, 0.14)" : "rgba(255, 255, 255, 0.2)",
  };
}

/**
 * The style that repaints a panel: its background plus the ink tokens its
 * text is written in. Null for "no override", which leaves the theme alone.
 */
export function panelStyle(background: string | null): Record<string, string> | null {
  if (!background) return null;
  const ink = panelInk(background);
  if (!ink) return null;
  return {
    background: toHex(parseHex(background)!),
    "--ink": ink.ink,
    "--ink-2": ink.ink2,
    "--muted": ink.muted,
    "--hair": ink.hair,
  };
}
