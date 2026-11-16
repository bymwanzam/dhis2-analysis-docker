/**
 * Browser-side DHIS2 access.
 *
 * Nothing here knows the token. Every call goes to this app's own proxy,
 * which attaches the credential server-side and refuses anything that is not
 * a read.
 */
import { buildAnalyticsPath, type AnalyticsQuery } from "./analytics";
import { buildGeoFeaturesPath, parseGeoFeatures, type GeoFeature } from "./geo";
import { buildMapUnitsPath, parseMapUnits, type MapScope, type MapUnit } from "./map-scope";
import type {
  AnalyticsResponse,
  ConnectionStatus,
  IdName,
  OrgUnit,
  OrgUnitLevel,
  Pager,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export async function proxyGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/dhis2/${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });

  const body = await response.text();
  let parsed: unknown = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    // fall through to the error below
  }

  if (!response.ok) {
    const payload = parsed as { error?: string; detail?: string } | null;
    throw new ApiError(
      payload?.error ?? `Request failed with status ${response.status}.`,
      response.status,
      payload?.detail,
    );
  }

  if (parsed === null) {
    throw new ApiError("DHIS2 returned an empty response.", 502);
  }

  return parsed as T;
}

export function fetchAnalytics(
  query: AnalyticsQuery,
  signal?: AbortSignal,
): Promise<AnalyticsResponse> {
  return proxyGet<AnalyticsResponse>(buildAnalyticsPath(query), signal);
}

export type MetadataResource =
  | "dataItems"
  | "indicators"
  | "dataElements"
  | "dataSets"
  | "programIndicators"
  | "organisationUnits"
  | "indicatorGroups"
  | "dataElementGroups"
  | "programs";

export interface MetadataSearchResult<T = IdName> {
  items: T[];
  pager?: Pager;
}

/** Search one metadata list by display name. */
export async function searchMetadata<T = IdName>(
  resource: MetadataResource,
  options: {
    query?: string;
    fields?: string;
    pageSize?: number;
    page?: number;
    extraFilters?: string[];
    signal?: AbortSignal;
  } = {},
): Promise<MetadataSearchResult<T>> {
  const {
    query = "",
    fields = "id,displayName",
    pageSize = 50,
    page = 1,
    extraFilters = [],
    signal,
  } = options;

  const params = new URLSearchParams();
  params.set("fields", fields);
  params.set("pageSize", String(pageSize));
  params.set("page", String(page));
  params.set("order", "displayName:asc");
  if (query.trim()) params.append("filter", `displayName:ilike:${query.trim()}`);
  for (const filter of extraFilters) params.append("filter", filter);

  const payload = await proxyGet<Record<string, unknown>>(
    `${resource}.json?${params.toString()}`,
    signal,
  );

  return {
    items: (payload[resource] as T[]) ?? [],
    pager: payload.pager as Pager | undefined,
  };
}

const ROOT_FIELDS = "id,displayName,level,path,children::isNotEmpty";

/**
 * Where the organisation unit tree starts: the units the account may read
 * data for.
 *
 * DHIS2 lets an account *see* far more of the hierarchy than it may *analyse*.
 * Analytics answers only for the data view (analysis) units, falling back to
 * the data capture units when none are set; anything above them is refused
 * with "not allowed to view org unit". Starting the tree at level 1 offered
 * the national unit to every district officer, and every query on it failed.
 * Level 1 is the last resort, for an account with no units assigned at all
 * (a superuser), which DHIS2 lets read everything.
 */
export function chooseOrgUnitRoots(
  dataView: OrgUnit[] | undefined,
  capture: OrgUnit[] | undefined,
): OrgUnit[] | null {
  const pick = dataView?.length ? dataView : capture?.length ? capture : null;
  if (!pick) return null;
  // A unit inside another chosen unit is reached through it; listing both
  // would offer the same facilities twice.
  const paths = pick.map((unit) => unit.path ?? `/${unit.id}`);
  return pick
    .filter((unit, index) => {
      const own = paths[index];
      return !paths.some((other, j) => j !== index && own.startsWith(`${other}/`));
    })
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.displayName.localeCompare(b.displayName));
}

/** Root org units the token's user may read data for. */
export async function fetchOrgUnitRoots(signal?: AbortSignal): Promise<OrgUnit[]> {
  const me = await proxyGet<{ organisationUnits?: OrgUnit[]; dataViewOrganisationUnits?: OrgUnit[] }>(
    `me.json?fields=organisationUnits[${ROOT_FIELDS}],dataViewOrganisationUnits[${ROOT_FIELDS}]`,
    signal,
  );
  const roots = chooseOrgUnitRoots(me.dataViewOrganisationUnits, me.organisationUnits);
  if (roots) return roots;

  const payload = await proxyGet<{ organisationUnits: OrgUnit[] }>(
    `organisationUnits.json?fields=${ROOT_FIELDS}&filter=level:eq:1&paging=false`,
    signal,
  );
  return payload.organisationUnits ?? [];
}

export async function fetchOrgUnitChildren(
  parentId: string,
  signal?: AbortSignal,
): Promise<OrgUnit[]> {
  const payload = await proxyGet<{ children?: OrgUnit[] }>(
    `organisationUnits/${parentId}.json?fields=children[id,displayName,level,path,children::isNotEmpty]`,
    signal,
  );
  return (payload.children ?? []).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

/**
 * The names a server gives its own hierarchy levels, shallowest first.
 *
 * DHIS2 returns these in no particular order, so they are sorted here rather
 * than by the server: `order` is among the parameters older versions reject
 * outright, and a rejected request costs the level names altogether — which
 * shows up as a table headed "Level 1, Level 2" instead of "National,
 * Regional, District".
 */
export async function fetchOrgUnitLevels(signal?: AbortSignal): Promise<OrgUnitLevel[]> {
  const byLevel = (levels: OrgUnitLevel[]) => [...levels].sort((a, b) => a.level - b.level);

  // `filledOrganisationUnitLevels` is the better answer where it exists: it
  // arrives in order and names every level the tree actually has, including
  // any the administrator never defined. It returns a bare array rather than
  // a wrapped list.
  try {
    const filled = await proxyGet<OrgUnitLevel[]>(
      "filledOrganisationUnitLevels.json?fields=id,displayName,level",
      signal,
    );
    if (Array.isArray(filled) && filled.length) return byLevel(filled);
  } catch (cause) {
    // A cancelled request is not a reason to try a different endpoint.
    if (signal?.aborted) throw cause;
  }

  const payload = await proxyGet<{ organisationUnitLevels: OrgUnitLevel[] }>(
    "organisationUnitLevels.json?fields=id,displayName,level&paging=false",
    signal,
  );
  return byLevel(payload.organisationUnitLevels ?? []);
}

export async function fetchConnectionStatus(signal?: AbortSignal): Promise<ConnectionStatus> {
  const response = await fetch("/api/connection", {
    signal,
    headers: { Accept: "application/json" },
  });
  return (await response.json()) as ConnectionStatus;
}

export async function saveConnection(input: {
  baseUrl: string;
  token: string;
  tokenType: string;
}): Promise<ConnectionStatus> {
  const response = await fetch("/api/connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as ConnectionStatus;
}

export async function clearConnection(): Promise<void> {
  await fetch("/api/connection", { method: "DELETE" });
}

/**
 * Names and levels for a set of organisation unit ids.
 *
 * Analytics returns an organisation unit's ancestors as bare ids, so the
 * hierarchy columns on the comparison page need this second lookup. Ids are
 * requested in chunks to keep the URL within what a proxy will forward.
 */
export async function fetchOrgUnitNames(
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, OrgUnit>> {
  const unique = [...new Set(ids)].filter(Boolean);
  const resolved = new Map<string, OrgUnit>();
  const CHUNK = 100;

  for (let start = 0; start < unique.length; start += CHUNK) {
    const chunk = unique.slice(start, start + CHUNK);
    const params = new URLSearchParams();
    params.set("fields", "id,displayName,level");
    params.set("paging", "false");
    params.append("filter", `id:in:[${chunk.join(",")}]`);

    const payload = await proxyGet<{ organisationUnits?: OrgUnit[] }>(
      `organisationUnits.json?${params.toString()}`,
      signal,
    );

    for (const unit of payload.organisationUnits ?? []) {
      resolved.set(unit.id, unit);
    }
  }

  return resolved;
}

/**
 * Boundaries and locations for the units an `ou` dimension names.
 *
 * Units without coordinates in DHIS2 are simply absent from the answer; the
 * map reports how many of the result's units that left off.
 */
export async function fetchGeoFeatures(
  ou: string[],
  signal?: AbortSignal,
): Promise<GeoFeature[]> {
  return parseGeoFeatures(await proxyGet<unknown>(buildGeoFeaturesPath(ou), signal));
}

/** Every unit a map scope covers, with ancestors and geometry. */
export async function fetchMapUnits(scope: MapScope, signal?: AbortSignal): Promise<MapUnit[]> {
  return parseMapUnits(await proxyGet<unknown>(buildMapUnitsPath(scope), signal));
}
