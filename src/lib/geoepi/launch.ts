/**
 * The query string the GeoEpi viewer is opened with.
 *
 * Only `notebook` and `dataset` are taken from the page's own URL (the Maps
 * page links with them); `track` is fixed by the page, so the Measles page
 * lists the measles modules and the GeoEpi page lists the rest.
 */

type SearchParams = Record<string, string | string[] | undefined>;

const PASSED_ON = ["notebook", "dataset"] as const;

export function geoEpiLaunch(params: SearchParams, track?: string): string {
  const launch = new URLSearchParams();
  if (track) launch.set("track", track);
  for (const name of PASSED_ON) {
    const value = params[name];
    if (typeof value === "string" && value) launch.set(name, value);
  }
  return launch.toString();
}
