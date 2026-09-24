/**
 * Organisation unit geometry and the choropleth built on it.
 *
 * DHIS2 stores each unit's boundary or location and serves it from
 * `geoFeatures`, keyed by the same `ou` dimension an analytics query uses — so
 * the map asks for exactly the units the query asked for, and a unit with no
 * value still gets drawn, as "No data", instead of silently leaving a hole.
 *
 * Everything here is pure: parsing, projection and classification are tested
 * without a browser, and the map component only draws what this returns.
 */
import { dimensionTitle, type ParsedAnalytics } from "./analytics";

/** Longitude, latitude — GeoJSON order, which is what DHIS2 stores. */
export type Position = [number, number];

/** One entry of the `geoFeatures` response, as the server sends it. */
export interface RawGeoFeature {
  id: string;
  /** Display name. */
  na?: string;
  /** Hierarchy level. */
  le?: number;
  /** Parent name. */
  pn?: string;
  /** 1 point, 2 polygon, 3 multipolygon — trusted less than the coordinates. */
  ty?: number;
  /** Coordinates, as a JSON string on most versions and an array on some. */
  co?: string | unknown[];
}

export type Geometry =
  | { type: "point"; coordinates: Position }
  /** Polygons, each a list of rings; the first ring is the outline, the rest holes. */
  | { type: "area"; polygons: Position[][][] };

export interface GeoFeature {
  id: string;
  name: string;
  level: number | null;
  parentName: string | null;
  geometry: Geometry;
}

/** The proxy path for the boundaries of the units an `ou` dimension names. */
export function buildGeoFeaturesPath(ou: string[]): string {
  const params = new URLSearchParams();
  params.set("ou", `ou:${ou.join(";")}`);
  params.set("displayProperty", "NAME");
  return `geoFeatures.json?${params.toString()}`;
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/** How deeply positions are nested: 1 is a point, 4 a multipolygon. */
function depth(value: unknown): number {
  if (isPosition(value)) return 1;
  if (!Array.isArray(value) || value.length === 0) return 0;
  const inner = depth(value[0]);
  return inner === 0 ? 0 : inner + 1;
}

function cleanRing(ring: unknown): Position[] {
  if (!Array.isArray(ring)) return [];
  return ring.filter(isPosition).map(([lng, lat]) => [lng, lat] as Position);
}

/**
 * Read the geometry off the coordinates themselves.
 *
 * The `ty` code has meant different things across DHIS2 versions — a polygon
 * served in multipolygon nesting is common — so the nesting depth decides the
 * shape, which is what actually has to be drawn.
 */
export function parseGeometry(co: RawGeoFeature["co"]): Geometry | null {
  let coordinates: unknown = co;
  if (typeof co === "string") {
    try {
      coordinates = JSON.parse(co);
    } catch {
      return null;
    }
  }

  let polygons: unknown[];
  switch (depth(coordinates)) {
    case 1:
      return { type: "point", coordinates: [...(coordinates as Position)].slice(0, 2) as Position };
    case 2:
      polygons = [[coordinates]];
      break;
    case 3:
      polygons = [coordinates];
      break;
    case 4:
      polygons = coordinates as unknown[];
      break;
    default:
      return null;
  }

  const cleaned = polygons
    .map((polygon) =>
      (polygon as unknown[]).map(cleanRing).filter((ring) => ring.length >= 3),
    )
    .filter((polygon) => polygon.length > 0);

  return cleaned.length ? { type: "area", polygons: cleaned } : null;
}

/** Features with usable geometry; anything else is dropped, not guessed at. */
export function parseGeoFeatures(raw: unknown): GeoFeature[] {
  if (!Array.isArray(raw)) return [];

  const features: GeoFeature[] = [];
  for (const entry of raw as RawGeoFeature[]) {
    if (!entry || typeof entry.id !== "string") continue;
    const geometry = parseGeometry(entry.co);
    if (!geometry) continue;
    features.push({
      id: entry.id,
      name: entry.na ?? entry.id,
      level: typeof entry.le === "number" ? entry.le : null,
      parentName: entry.pn ?? null,
      geometry,
    });
  }
  return features;
}

/* -------------------------------------------------------------- projection */

const MAX_LATITUDE = 85;

/** Web Mercator, y pointing down so it can go straight into SVG. */
export function mercator([lng, lat]: Position): Position {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const x = (lng * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return [x, -y];
}

/**
 * Where a label can sit inside an area: a point that is inside the shape, and
 * the room around it — the width of the shape along the label's line and its
 * height through the label's centre.
 */
export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MapShape =
  | { id: string; type: "area"; d: string; label: LabelBox | null }
  | { id: string; type: "point"; cx: number; cy: number };

export interface MapLayout {
  width: number;
  height: number;
  shapes: MapShape[];
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Project every feature and fit the lot into a viewBox.
 *
 * Coordinates are rounded to a tenth of a viewBox unit and repeated points
 * dropped: a district boundary can carry thousands of vertices that land on
 * the same screen pixel, and the SVG does not need them. A ring that
 * collapses below three points at this scale is too small to see and is left
 * out. Areas are ordered shallowest level first so a region never paints over
 * the districts inside it.
 */
export function layoutMap(
  features: GeoFeature[],
  { width = 800, maxHeight = 560, padding = 16 }: {
    width?: number;
    maxHeight?: number;
    padding?: number;
  } = {},
): MapLayout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const projected = features.map((feature) => {
    const project = (position: Position) => {
      const point = mercator(position);
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
      return point;
    };
    return feature.geometry.type === "point"
      ? { feature, point: project(feature.geometry.coordinates) }
      : {
          feature,
          polygons: feature.geometry.polygons.map((polygon) =>
            polygon.map((ring) => ring.map(project)),
          ),
        };
  });

  if (!projected.length) return { width, height: 0, shapes: [] };

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const innerWidth = width - padding * 2;
  const innerHeight = maxHeight - padding * 2;

  // A single point, or points on one line, has no extent to fit; give it a
  // fixed frame and centre it rather than dividing by zero.
  const scale =
    spanX > 0 && spanY > 0
      ? Math.min(innerWidth / spanX, innerHeight / spanY)
      : spanX > 0
        ? innerWidth / spanX
        : spanY > 0
          ? innerHeight / spanY
          : 1;
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const height = Math.round(Math.max(drawnHeight + padding * 2, 240));
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;

  const toScreen = ([x, y]: Position): Position => [
    round(offsetX + (x - minX) * scale),
    round(offsetY + (y - minY) * scale),
  ];

  const areas: { level: number; shape: MapShape }[] = [];
  const points: MapShape[] = [];

  for (const entry of projected) {
    const { feature } = entry;
    if ("point" in entry && entry.point) {
      const [cx, cy] = toScreen(entry.point);
      points.push({ id: feature.id, type: "point", cx, cy });
      continue;
    }

    let d = "";
    let outline: Position[] | null = null;
    let outlineArea = 0;
    for (const polygon of entry.polygons ?? []) {
      for (const [ringIndex, ring] of polygon.entries()) {
        const screen: Position[] = [];
        for (const position of ring) {
          const next = toScreen(position);
          const last = screen.at(-1);
          if (!last || last[0] !== next[0] || last[1] !== next[1]) screen.push(next);
        }
        const first = screen[0];
        const end = screen.at(-1);
        if (first && end && screen.length > 1 && first[0] === end[0] && first[1] === end[1]) {
          screen.pop();
        }
        if (screen.length < 3) continue;
        d += `M${screen.map(([x, y]) => `${x},${y}`).join("L")}Z`;

        // The label goes in the largest piece: the mainland, not an island.
        if (ringIndex === 0) {
          const area = Math.abs(ringArea(screen));
          if (area > outlineArea) {
            outline = screen;
            outlineArea = area;
          }
        }
      }
    }
    if (d) {
      areas.push({
        level: feature.level ?? 0,
        shape: {
          id: feature.id,
          type: "area",
          d,
          label: outline ? labelBox(outline) : null,
        },
      });
    }
  }

  areas.sort((a, b) => a.level - b.level);
  return { width, height, shapes: [...areas.map((area) => area.shape), ...points] };
}

/* ------------------------------------------------------------------ labels */

/** Signed area by the shoelace formula. */
function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * Where a straight line crosses the ring, as sorted positions along it.
 * `axis` 1 scans a horizontal line at y = `at`; 0 a vertical line at x = `at`.
 */
function crossings(ring: Position[], at: number, axis: 0 | 1): number[] {
  const other = axis === 1 ? 0 : 1;
  const hits: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    // Half-open so a line through a vertex is counted once.
    if (a[axis] <= at === b[axis] <= at) continue;
    const t = (at - a[axis]) / (b[axis] - a[axis]);
    hits.push(a[other] + t * (b[other] - a[other]));
  }
  return hits.sort((left, right) => left - right);
}

/** The inside stretch of a scan line: the one holding `near`, else the widest. */
function insideSpan(hits: number[], near: number): [number, number] | null {
  let best: [number, number] | null = null;
  for (let index = 0; index + 1 < hits.length; index += 2) {
    const span: [number, number] = [hits[index], hits[index + 1]];
    if (near >= span[0] && near <= span[1]) return span;
    if (!best || span[1] - span[0] > best[1] - best[0]) best = span;
  }
  return best;
}

/**
 * A label position guaranteed to be inside the outline.
 *
 * The centroid alone falls outside a crescent or an L-shaped district, so it
 * is only a starting guess: a horizontal line through it finds the inside
 * stretch, the label is centred on that, and a vertical line through the new
 * point centres it the other way and measures the height available.
 */
export function labelBox(ring: Position[]): LabelBox | null {
  const area = ringArea(ring);
  if (area === 0) return null;

  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  cx /= 6 * area;
  cy /= 6 * area;

  const across = insideSpan(crossings(ring, cy, 1), cx);
  if (!across) return null;
  const x = (across[0] + across[1]) / 2;

  const down = insideSpan(crossings(ring, x, 0), cy);
  if (!down) return null;
  const y = (down[0] + down[1]) / 2;

  const width = insideSpan(crossings(ring, y, 1), x);
  return {
    x: round(x),
    y: round(y),
    width: round(width ? width[1] - width[0] : across[1] - across[0]),
    height: round(down[1] - down[0]),
  };
}

/**
 * Break a name into lines that fit a width of `maxChars`, at most `maxLines`.
 *
 * Breaks fall between words. A word longer than a line gets a line of its own
 * and is cut with an ellipsis, as is the last line when the name runs over —
 * the full name is always in the tooltip and the table.
 */
export function wrapLabel(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || maxChars < 1 || maxLines < 1) return [];

  const clip = (line: string) =>
    line.length > maxChars ? `${line.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…` : line;

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
    kept[maxLines - 1] = last.length > maxChars ? `${last.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…` : last;
    return kept.map(clip);
  }
  return lines.map(clip);
}

export const LABEL_FONT_SIZE = 10;
export const LABEL_LINE_HEIGHT = 12;
/** Average glyph width as a share of the font size, for a UI sans-serif. */
const CHAR_WIDTH = 0.56;
const MIN_LABEL_CHARS = 4;

/**
 * The lines to draw inside an area, or null when the area is too small to
 * hold a readable label. Hiding a label beats letting it spill across the
 * neighbours; the name is still one hover away.
 */
export function fitLabel(
  name: string,
  box: LabelBox | null,
  { fontSize = LABEL_FONT_SIZE, lineHeight = LABEL_LINE_HEIGHT, maxLines = 3 } = {},
): string[] | null {
  if (!box) return null;
  const maxChars = Math.floor((box.width * 0.85) / (fontSize * CHAR_WIDTH));
  if (maxChars < MIN_LABEL_CHARS) return null;

  const roomForLines = Math.floor((box.height * 0.85) / lineHeight);
  const lines = wrapLabel(name, maxChars, Math.min(maxLines, roomForLines));
  return lines.length ? lines : null;
}

/* ------------------------------------------------------------------ values */

export interface OrgUnitValues {
  values: Map<string, number>;
  /** Dimensions other than the unit that were added together to get one value. */
  summedOver: string[];
}

/**
 * One value per organisation unit, for one data item.
 *
 * Periods must already be collapsed — which reduction applies is the
 * caller's choice and is on screen. Data items are never added together:
 * the map shows the one it is given. Anything else left in the result, such
 * as category option combinations, is summed and named in `summedOver` so the
 * chart can say so.
 */
export function valuesByOrgUnit(parsed: ParsedAnalytics, dataItem: string | null): OrgUnitValues {
  const values = new Map<string, number>();
  if (!parsed.dimensions.includes("ou")) return { values, summedOver: [] };

  const filterDx = parsed.dimensions.includes("dx") && dataItem !== null;
  const summedOver = parsed.dimensions.filter(
    (dimension) => dimension !== "ou" && dimension !== "dx" && dimension !== "pe",
  );

  const seen = new Map<string, Set<string>>();
  for (const row of parsed.rows) {
    if (filterDx && row.dx !== dataItem) continue;
    const ou = String(row.ou ?? "");
    if (!ou) continue;
    values.set(ou, (values.get(ou) ?? 0) + row.value);

    for (const dimension of summedOver) {
      const bucket = seen.get(dimension) ?? new Set<string>();
      bucket.add(String(row[dimension] ?? ""));
      seen.set(dimension, bucket);
    }
  }

  // A dimension holding a single item was not really summed over.
  return {
    values,
    summedOver: summedOver.filter((dimension) => (seen.get(dimension)?.size ?? 0) > 1),
  };
}

/** How a summed-over dimension is named in the chart's own words. */
export function describeSummedOver(dimensions: string[]): string {
  return dimensions.map((dimension) => dimensionTitle(dimension).toLowerCase()).join(" and ");
}

/* ---------------------------------------------------------- classification */

export interface MapClass {
  from: number;
  to: number;
}

export const MAX_MAP_CLASSES = 5;

/**
 * Equal-interval classes between the smallest and largest value.
 *
 * Equal intervals keep the colour honest about magnitude: a unit two classes
 * darker really does hold a value two steps larger. Never more classes than
 * there are distinct values, so the legend holds no empty steps for a result
 * that only ever reports a handful of numbers.
 */
export function equalIntervalClasses(values: number[], count = MAX_MAP_CLASSES): MapClass[] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const steps = Math.max(1, Math.min(count, new Set(finite).size));
  if (min === max) return [{ from: min, to: max }];

  const width = (max - min) / steps;
  return Array.from({ length: steps }, (_, index) => ({
    from: min + width * index,
    to: index === steps - 1 ? max : min + width * (index + 1),
  }));
}

/** Which class a value falls in; each class includes its upper bound. */
export function classIndex(value: number, classes: MapClass[]): number {
  if (!classes.length || !Number.isFinite(value)) return -1;
  for (let index = 0; index < classes.length; index += 1) {
    if (value <= classes[index].to) return index;
  }
  return classes.length - 1;
}
