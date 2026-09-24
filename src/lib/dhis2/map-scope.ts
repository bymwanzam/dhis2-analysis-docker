/**
 * What the Maps page is looking at, and how it moves.
 *
 * A map scope is a level and the chain of units above it — "districts inside
 * Upper East, inside Ghana". Every request the page makes, and every drill up
 * or down, is derived from that one value, so it is kept here as plain data
 * and tested without a browser.
 *
 * Aggregation is left to DHIS2. The page asks analytics for `LEVEL-n` inside
 * the parent and DHIS2 rolls facility data up to that level itself: a count is
 * summed, an indicator is recalculated from summed numerators and
 * denominators. Nothing here adds unit values together.
 */
import { equalIntervalClasses, parseGeometry, type Geometry, type MapClass } from "./geo";

/**
 * The deepest level the map draws. Level 5 in the hierarchy this was built
 * for is the facility: facilities are rolled up into their sub-district
 * rather than drawn as points, and a boundary map of them would not exist.
 */
export const MAX_MAP_LEVEL = 4;

export type MapDataType = "count" | "coverage" | "indicator";

export const MAP_DATA_TYPES: {
  value: MapDataType;
  label: string;
  hint: string;
}[] = [
  {
    value: "count",
    label: "Counts",
    hint: "Raw numbers from data elements — cases, visits, doses — summed up to each area.",
  },
  {
    value: "coverage",
    label: "Coverages",
    hint: "Indicators whose type is a percentage, calculated against a target population.",
  },
  {
    value: "indicator",
    label: "Indicators",
    hint: "Any calculated indicator: numerator ÷ denominator, recalculated for each area.",
  },
];

export interface OrgUnitRef {
  id: string;
  name: string;
  level: number;
}

export interface MapUnit extends OrgUnitRef {
  /** Every unit above this one, root first. */
  ancestors: OrgUnitRef[];
  /** Null when DHIS2 holds no coordinates for the unit. */
  geometry: Geometry | null;
}

export interface MapScope {
  level: number;
  /** Root first. The last entry is the parent the level is drawn inside. */
  path: OrgUnitRef[];
}

/* ------------------------------------------------------------- requests */

/**
 * Every unit the scope covers, with its ancestors and its geometry, in one
 * request. Asking the hierarchy rather than the boundaries is what lets a
 * unit with no coordinates be listed instead of vanishing.
 */
export function buildMapUnitsPath(scope: MapScope): string {
  const parent = scope.path.at(-1);
  const params = new URLSearchParams();
  params.set("fields", "id,displayName,level,ancestors[id,displayName,level],geometry");
  params.set("paging", "false");
  if (!parent || parent.level >= scope.level) {
    if (parent) params.append("filter", `id:eq:${parent.id}`);
  } else {
    params.append("filter", `level:eq:${scope.level}`);
    params.append("filter", `path:like:${parent.id}`);
  }
  return `organisationUnits.json?${params.toString()}`;
}

/** The analytics `ou` dimension for a scope. */
export function mapOuDimension(scope: MapScope): string[] {
  const parent = scope.path.at(-1);
  if (!parent) return [];
  if (parent.level >= scope.level) return [parent.id];
  return [`LEVEL-${scope.level}`, parent.id];
}

interface RawUnit {
  id?: string;
  displayName?: string;
  name?: string;
  level?: number;
  ancestors?: RawUnit[];
  geometry?: { type?: string; coordinates?: unknown[] } | null;
}

function toRef(raw: RawUnit): OrgUnitRef | null {
  if (typeof raw?.id !== "string" || typeof raw.level !== "number") return null;
  return { id: raw.id, name: raw.displayName ?? raw.name ?? raw.id, level: raw.level };
}

export function parseMapUnits(payload: unknown): MapUnit[] {
  const list = (payload as { organisationUnits?: RawUnit[] } | null)?.organisationUnits;
  if (!Array.isArray(list)) return [];

  const units: MapUnit[] = [];
  for (const raw of list) {
    const ref = toRef(raw);
    if (!ref) continue;
    const ancestors = (raw.ancestors ?? [])
      .map(toRef)
      .filter((entry): entry is OrgUnitRef => entry !== null)
      .sort((a, b) => a.level - b.level);
    const coordinates = raw.geometry?.coordinates;
    units.push({
      ...ref,
      ancestors,
      geometry: Array.isArray(coordinates) ? parseGeometry(coordinates) : null,
    });
  }
  return units.sort((a, b) => a.name.localeCompare(b.name));
}

/** "Ghana > Upper East > Bawku West > Zebilla" */
export function hierarchyPath(unit: MapUnit): string {
  return [...unit.ancestors, unit].map((entry) => entry.name).join(" > ");
}

/** A boundary to shade, as opposed to nothing or a single point. */
export function hasBoundary(unit: MapUnit): boolean {
  return unit.geometry?.type === "area";
}

/* ----------------------------------------------------------- navigation */

function rootOf(scope: MapScope): OrgUnitRef {
  return scope.path[0];
}

/** Keep only the ancestors that sit above `level`, never losing the root. */
function trimPath(path: OrgUnitRef[], level: number): OrgUnitRef[] {
  const trimmed = path.filter((entry) => entry.level < level);
  return trimmed.length ? trimmed : path.slice(0, 1);
}

/** Levels the map can show for a root: from the root itself down to the cap. */
export function availableLevels(rootLevel: number, deepest = MAX_MAP_LEVEL): number[] {
  const last = Math.min(deepest, MAX_MAP_LEVEL);
  const levels: number[] = [];
  for (let level = rootLevel; level <= last; level += 1) levels.push(level);
  return levels;
}

export function setLevel(scope: MapScope, level: number): MapScope {
  const root = rootOf(scope);
  const next = Math.max(root.level, Math.min(MAX_MAP_LEVEL, level));
  return { level: next, path: trimPath(scope.path, next) };
}

/** Show the children of `unit`. Null at the deepest mapped level. */
export function drillDown(scope: MapScope, unit: MapUnit): MapScope | null {
  if (unit.level >= MAX_MAP_LEVEL) return null;
  const root = rootOf(scope);
  const above = unit.ancestors.filter((entry) => entry.level >= root.level);
  const path =
    unit.id === root.id
      ? [root]
      : above[0]?.id === root.id
        ? [...above, { id: unit.id, name: unit.name, level: unit.level }]
        : [root, { id: unit.id, name: unit.name, level: unit.level }];
  return { level: unit.level + 1, path };
}

/** Back up one level, widening to the parent's parent. Null at the root. */
export function drillUp(scope: MapScope): MapScope | null {
  const root = rootOf(scope);
  if (scope.level <= root.level) return null;
  const level = scope.level - 1;
  return { level, path: trimPath(scope.path, level) };
}

/** Jump to a unit in the breadcrumb: show the level beneath it. */
export function focusCrumb(scope: MapScope, index: number): MapScope {
  const path = scope.path.slice(0, index + 1);
  const crumb = path.at(-1)!;
  return { level: Math.min(MAX_MAP_LEVEL, crumb.level + 1), path };
}

/* ---------------------------------------------------------------- colour */

/**
 * A fixed scale for coverage. The same colour means the same percentage in
 * every region and after every drill, so two maps can be compared at a
 * glance. Values over 100% get a class of their own: they usually mean the
 * target population is too small, and they must not hide inside the top class.
 */
export const COVERAGE_CLASSES: MapClass[] = [
  { from: 0, to: 20 },
  { from: 20, to: 40 },
  { from: 40, to: 60 },
  { from: 60, to: 80 },
  { from: 80, to: 100 },
  { from: 100, to: Infinity },
];

export function mapClassesFor(type: MapDataType, values: number[]): MapClass[] {
  return type === "coverage" ? COVERAGE_CLASSES : equalIntervalClasses(values);
}
