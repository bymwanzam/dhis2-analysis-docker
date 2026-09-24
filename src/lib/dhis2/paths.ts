/**
 * Read-only allowlist for the DHIS2 proxy.
 *
 * The proxy forwards a bearer-grade credential, so it only ever forwards GET
 * requests and only to endpoints this app actually reads. Anything else —
 * data value writes, metadata imports, user management, maintenance — is
 * rejected before the token is attached.
 */

const ALLOWED = [
  /^analytics(\/.*)?$/,
  // The unified data-item search, the same list DHIS2's own Data Visualizer
  // offers. A read-only analytics account often reaches this when the
  // individual metadata lists are closed to it by sharing.
  /^dataItems(\/.*)?$/,
  /^me(\/.*)?$/,
  /^system\/info$/,
  /^dataElements(\/[A-Za-z0-9]+)?$/,
  /^dataElementGroups(\/[A-Za-z0-9]+)?$/,
  /^dataElementGroupSets(\/[A-Za-z0-9]+)?$/,
  /^indicators(\/[A-Za-z0-9]+)?$/,
  /^indicatorGroups(\/[A-Za-z0-9]+)?$/,
  /^indicatorTypes(\/[A-Za-z0-9]+)?$/,
  /^dataSets(\/[A-Za-z0-9]+)?$/,
  /^programs(\/[A-Za-z0-9]+)?$/,
  /^programIndicators(\/[A-Za-z0-9]+)?$/,
  /^programStages(\/[A-Za-z0-9]+)?$/,
  /^organisationUnits(\/[A-Za-z0-9]+)?$/,
  /^organisationUnitGroups(\/[A-Za-z0-9]+)?$/,
  /^organisationUnitGroupSets(\/[A-Za-z0-9]+)?$/,
  /^organisationUnitLevels$/,
  /^filledOrganisationUnitLevels$/,
  /^categories(\/[A-Za-z0-9]+)?$/,
  /^categoryCombos(\/[A-Za-z0-9]+)?$/,
  /^categoryOptionCombos(\/[A-Za-z0-9]+)?$/,
  /^optionSets(\/[A-Za-z0-9]+)?$/,
  /^visualizations(\/[A-Za-z0-9]+)?$/,
  /^dimensions(\/.*)?$/,
  /^periodTypes$/,
  /^geoFeatures$/,
];

/** Strip an optional API version segment: 41/analytics becomes analytics. */
export function stripApiVersion(path: string): string {
  return path.replace(/^\d{2,3}\//, "");
}

/** DHIS2 accepts a .json suffix on any endpoint; match the bare path. */
function stripJsonSuffix(path: string): string {
  return path.replace(/\.json$/i, "");
}

export function isAllowedPath(path: string): boolean {
  if (!path) return false;

  // The route hands over path segments only, but the check has to hold for a
  // full request path too — the endpoint is what is being judged, not the
  // query that follows it.
  const endpoint = path.split(/[?#]/, 1)[0];
  if (endpoint.includes("..") || endpoint.startsWith("/")) return false;

  const candidate = stripJsonSuffix(stripApiVersion(endpoint));
  return ALLOWED.some((pattern) => pattern.test(candidate));
}
