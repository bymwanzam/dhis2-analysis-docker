/**
 * Allowlist for the GeoEpi proxy.
 *
 * GeoEpi runs notebooks on the server, so the proxy only forwards the routes
 * its own viewer uses: the viewer's static files, reading notebooks, datasets,
 * jobs and results, and the handful of POSTs that upload a dataset or start a
 * run. Everything else on the service stays unreachable from the browser.
 */

const READ = [
  /^index\.html$/,
  /^lib\.js$/,
  /^export\.js$/,
  /^vendor\/[A-Za-z0-9._-]+$/,
  /^vendor\/images\/[A-Za-z0-9._-]+$/,
  /^api\/(notebooks|datasets|jobs)$/,
  /^api\/jobs\/[A-Za-z0-9_-]+(?:\/(?:log|download\.zip))?$/,
  /^results\/[A-Za-z0-9_-]+\/.+$/,
];

const WRITE = new Set([
  "api/datasets",
  "api/datasets/files",
  "api/datasets/from-job",
  "api/datasets/dhis2-map",
  "api/jobs",
]);

/** `path` is relative to /geoepi/, with no leading slash. */
export function isGeoEpiPathAllowed(method: string, path: string): boolean {
  if (path.split("/").some((part) => part === ".." || part === ".")) return false;
  if (method === "GET") return READ.some((pattern) => pattern.test(path));
  return method === "POST" && WRITE.has(path);
}

/** The viewer page itself, which the GeoEpi page in the app shell frames. */
export const GEOEPI_VIEWER_PATH = "index.html";
