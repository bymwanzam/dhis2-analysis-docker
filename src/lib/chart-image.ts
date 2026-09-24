"use client";

/**
 * Charts as raster images.
 *
 * A chart on screen is an SVG whose colours are CSS custom properties, plus a
 * title and a legend that live in HTML around it. Serialising the SVG on its
 * own would lose all three: `var(--series-1)` means nothing outside the
 * document, and a picture of bars with no title and no key is not a chart.
 *
 * So the export resolves every paint value to what the browser actually drew,
 * wraps the title and description to the width of the figure, and draws the
 * legend where the page put it — beside a map, above a line chart. What lands
 * in the file is what the reader needs to make sense of it, with no dependency
 * beyond the platform.
 */

export type ImageFormat = "png" | "jpeg";

/** Drawn at twice the on-screen size so the file survives a projector. */
const SCALE = 2;
const PAD = 20;
const LINE_GAP = 4;
const HEADER_GAP = 12;

/** The paint and text properties that decide what the plot looks like. */
const PAINTED = [
  "fill",
  "fillOpacity",
  "stroke",
  "strokeOpacity",
  "strokeWidth",
  "strokeDasharray",
  "strokeLinecap",
  "strokeLinejoin",
  "paintOrder",
  "stopColor",
  "stopOpacity",
  "opacity",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "textAnchor",
  "dominantBaseline",
  "visibility",
] as const;

interface Palette {
  surface: string;
  ink: string;
  ink2: string;
  font: string;
}

function palette(frame: HTMLElement): Palette {
  const root = getComputedStyle(document.documentElement);
  const local = getComputedStyle(frame);
  const token = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;

  // A transparent frame would make a JPEG come out black, so the surface
  // always falls back to an opaque colour.
  const background = local.backgroundColor;
  const opaque = background && !/rgba\(.*,\s*0\)$/.test(background);

  return {
    surface: opaque ? background : token("--surface", "#ffffff"),
    // Read from the frame, not the root: a repainted frame re-inks its text,
    // and the title must be drawn in the ink that suits its background.
    ink: local.getPropertyValue("--ink").trim() || token("--ink", "#111827"),
    ink2: local.getPropertyValue("--ink-2").trim() || token("--ink-2", "#4b5563"),
    font: local.fontFamily || "system-ui, sans-serif",
  };
}

interface TextStyle {
  font: string;
  color: string;
  size: number;
  lineHeight: number;
}

/** The font and ink an element was drawn in, as canvas understands them. */
function textStyle(element: Element, fallback: Palette): TextStyle {
  const computed = getComputedStyle(element);
  const size = parseFloat(computed.fontSize) || 12;
  const lineHeight = parseFloat(computed.lineHeight) || size * 1.4;
  return {
    font: `${computed.fontWeight} ${size}px ${computed.fontFamily || fallback.font}`,
    color: computed.color || fallback.ink,
    size,
    lineHeight,
  };
}

/** Break text into lines no wider than `width`, as the page would. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface HeaderBlock {
  lines: string[];
  style: TextStyle;
}

/** The title and description, wrapped to the width of the image. */
function layOutHeader(
  context: CanvasRenderingContext2D,
  frame: HTMLElement,
  colors: Palette,
  width: number,
): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  for (const hook of ["data-chart-title", "data-chart-description"]) {
    const node = frame.querySelector(`[${hook}]`);
    const text = (node?.textContent ?? "").trim();
    if (!node || !text) continue;
    const style = textStyle(node, colors);
    context.font = style.font;
    blocks.push({ lines: wrap(context, text, width), style });
  }
  return blocks;
}

function isPainted(color: string): boolean {
  return Boolean(color) && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Each side of an element's border that is actually drawn, as a filled strip. */
function drawBorders(
  context: CanvasRenderingContext2D,
  computed: CSSStyleDeclaration,
  box: Box,
): void {
  const sides = [
    ["Top", (w: number) => [box.x, box.y, box.width, w]],
    ["Right", (w: number) => [box.x + box.width - w, box.y, w, box.height]],
    ["Bottom", (w: number) => [box.x, box.y + box.height - w, box.width, w]],
    ["Left", (w: number) => [box.x, box.y, w, box.height]],
  ] as const;

  for (const [side, strip] of sides) {
    const width = parseFloat(computed.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
    const style = computed.getPropertyValue(`border-${side.toLowerCase()}-style`);
    const color = computed.getPropertyValue(`border-${side.toLowerCase()}-color`);
    if (width <= 0 || style === "none" || style === "hidden" || !isPainted(color)) continue;
    const [x, y, w, h] = strip(width);
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
  }
}

/**
 * The nearest box, up to the legend itself, that clips its content.
 *
 * A truncated series name is cut off with an ellipsis on screen, but its
 * words still report where they would have been. Without the clip they would
 * be drawn over the next entry.
 */
function clipBox(element: Element, legend: Element): Element | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const computed = getComputedStyle(node);
    if (computed.overflowX !== "visible" || computed.overflowY !== "visible") return node;
    if (node === legend) break;
  }
  return null;
}

/**
 * Draw the legend where it sits on screen, relative to `origin`.
 *
 * A legend can sit above the plot or beside it, carry a heading and a note,
 * and wrap its entries however the page laid them out. Rather than re-deriving
 * any of that, every word, swatch and rule is drawn at the box the browser
 * gave it, so the file shows the key exactly as the reader saw it.
 */
function drawLegend(
  context: CanvasRenderingContext2D,
  legend: Element,
  origin: { x: number; y: number },
  colors: Palette,
): void {
  const place = (rect: DOMRect): Box => ({
    x: rect.left - origin.x,
    y: rect.top - origin.y,
    width: rect.width,
    height: rect.height,
  });

  const elements = [legend, ...legend.querySelectorAll("*")];

  // Swatches: empty elements with a fill.
  for (const element of elements) {
    if ((element.textContent ?? "").trim()) continue;
    const computed = getComputedStyle(element);
    if (!isPainted(computed.backgroundColor)) continue;
    const rect = place(element.getBoundingClientRect());
    if (!rect.width || !rect.height) continue;
    const radius = Math.min(
      parseFloat(computed.borderTopLeftRadius) || 0,
      rect.width / 2,
      rect.height / 2,
    );
    context.fillStyle = computed.backgroundColor;
    context.beginPath();
    if (radius && typeof context.roundRect === "function") {
      context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    } else {
      context.rect(rect.x, rect.y, rect.width, rect.height);
    }
    context.fill();
  }

  // Rules and outlines — the line that separates a side legend from the map,
  // the frame around a colour scale — drawn over the swatches they enclose.
  for (const element of elements) {
    const rect = place(element.getBoundingClientRect());
    if (!rect.width || !rect.height) continue;
    drawBorders(context, getComputedStyle(element), rect);
  }

  // Text, word by word at the position the page wrapped it to.
  const walker = document.createTreeWalker(legend, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (!parent || !text.trim()) continue;

    const style = textStyle(parent, colors);
    context.save();
    const clip = clipBox(parent, legend);
    if (clip) {
      const bounds = place(clip.getBoundingClientRect());
      context.beginPath();
      context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.clip();
    }
    context.font = style.font;
    context.fillStyle = style.color;
    context.textBaseline = "alphabetic";
    const metrics = context.measureText("Hg");
    const ascent = metrics.fontBoundingBoxAscent ?? style.size * 0.8;
    const descent = metrics.fontBoundingBoxDescent ?? style.size * 0.2;

    for (const match of text.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      range.setStart(node, start);
      range.setEnd(node, start + match[0].length);
      const rect = place(range.getBoundingClientRect());
      if (!rect.width) continue;
      // Centre the font's box on the box the browser drew the word in.
      const baseline = rect.y + (rect.height - ascent - descent) / 2 + ascent;
      context.fillText(match[0], rect.x, baseline);
    }
    context.restore();
  }
  range.detach();
}

/**
 * Copy what the browser computed onto the clone.
 *
 * The clone is detached, so it inherits nothing and matches no stylesheet.
 * Every property that decides a pixel has to be written onto the element
 * itself, with custom properties already resolved to real colours.
 */
function inlinePaint(source: SVGSVGElement, clone: SVGSVGElement): void {
  const from: Element[] = [source, ...source.querySelectorAll("*")];
  const to: Element[] = [clone, ...clone.querySelectorAll("*")];

  from.forEach((node, index) => {
    const target = to[index];
    if (!(target instanceof SVGElement) && !(target instanceof HTMLElement)) return;

    const computed = getComputedStyle(node);
    for (const property of PAINTED) {
      const value = computed[property];
      if (typeof value === "string" && value && value !== "none") {
        target.style.setProperty(
          property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
          value,
        );
      }
    }
  });
}

async function rasterizePlot(
  svg: SVGSVGElement,
): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  const box = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlinePaint(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const markup = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  image.width = width;
  image.height = height;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The chart could not be drawn as an image."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });

  return { image, width, height };
}

/**
 * Render one chart frame to a raster image and hand it to the viewer.
 *
 * The image is the frame as the reader sees it, minus the controls: the title
 * and description wrapped to the width of the figure, then the plot and its
 * legend in the arrangement the page gave them — beside a map, above a line
 * chart.
 *
 * Throws when the frame holds no plot — a table view has nothing to draw, and
 * saying so beats writing an empty file.
 */
export async function downloadChartImage(
  frame: HTMLElement,
  format: ImageFormat,
  stem: string,
): Promise<void> {
  const svg = frame.querySelector("[data-chart-plot] svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("This view has no chart to export. Switch to the chart view first.");
  }

  // Text is measured below, so wait for the page font rather than measuring
  // against a fallback and wrapping to the wrong widths.
  await document.fonts?.ready;

  const { image, width, height } = await rasterizePlot(svg);
  const colors = palette(frame);

  // The body is the plot and its legend, kept in their on-screen arrangement.
  // Only the first legend is drawn: a frame carries its key either on the
  // frame (series) or beside the map, never both.
  const plotBox = svg.getBoundingClientRect();
  const legend = frame.querySelector("[data-chart-legend]");
  const legendBox = legend?.getBoundingClientRect();
  const hasLegend = Boolean(legendBox && legendBox.width && legendBox.height);
  const boxes = hasLegend && legendBox ? [plotBox, legendBox] : [plotBox];
  const origin = {
    x: Math.min(...boxes.map((box) => box.left)),
    y: Math.min(...boxes.map((box) => box.top)),
  };
  const bodyWidth = Math.max(...boxes.map((box) => box.right)) - origin.x;
  const bodyHeight = Math.max(...boxes.map((box) => box.bottom)) - origin.y;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot render the chart to an image.");

  // Measure first: the wrapped header decides the canvas height.
  const header = layOutHeader(context, frame, colors, bodyWidth);
  let headerHeight = 0;
  header.forEach((block, index) => {
    headerHeight += block.lines.length * block.style.lineHeight;
    if (index < header.length - 1) headerHeight += LINE_GAP;
  });
  if (headerHeight) headerHeight += HEADER_GAP;

  const pageWidth = Math.ceil(bodyWidth + PAD * 2);
  const pageHeight = Math.ceil(headerHeight + bodyHeight + PAD * 2);

  canvas.width = pageWidth * SCALE;
  canvas.height = pageHeight * SCALE;
  // Everything below is drawn in CSS pixels; the scale makes the file twice
  // that, so the background has to be filled in the same units.
  context.scale(SCALE, SCALE);

  context.fillStyle = colors.surface;
  context.fillRect(0, 0, pageWidth, pageHeight);

  let y = PAD;
  for (const block of header) {
    context.font = block.style.font;
    context.fillStyle = block.style.color;
    context.textBaseline = "middle";
    for (const line of block.lines) {
      context.fillText(line, PAD, y + block.style.lineHeight / 2);
      y += block.style.lineHeight;
    }
    y += LINE_GAP;
  }

  const bodyTop = PAD + headerHeight;
  context.drawImage(
    image,
    PAD + plotBox.left - origin.x,
    bodyTop + plotBox.top - origin.y,
    width,
    height,
  );

  if (hasLegend && legend) {
    context.save();
    context.translate(PAD, bodyTop);
    drawLegend(context, legend, origin, colors);
    context.restore();
  }

  const type = format === "png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, format === "jpeg" ? 0.95 : undefined),
  );
  if (!blob) throw new Error("The chart image could not be saved.");

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${stem}.${format === "png" ? "png" : "jpg"}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
