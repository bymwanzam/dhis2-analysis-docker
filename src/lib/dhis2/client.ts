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

/** Root org units the token's user can see. */
export async function fetchOrgUnitRoots(signal?: AbortSignal): Promise<OrgUnit[]> {
  const payload = await proxyGet<{ organisationUnits: OrgUnit[] }>(
    "organisationUnits.json?fields=id,displayName,level,path,children::isNotEmpty&filter=level:eq:1&paging=false",
    signal,
  );
  if (payload.organisationUnits?.length) return payload.organisationUnits;

  // A restricted token may not see level 1; fall back to the user's own units.
  const me = await proxyGet<{ organisationUnits?: OrgUnit[] }>(
    "me.json?fields=organisationUnits[id,displayName,level,path]",
    signal,
  );
  return me.organisationUnits ?? [];
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
