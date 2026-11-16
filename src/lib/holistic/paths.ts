/**
 * Allowlist for the Holistic Assessment proxy.
 *
 * Holistic Assessment (modules/holistic_assessment) is its own Node service
 * with its own Postgres. The proxy forwards only what its viewer uses: the
 * built frontend, the session, the assessment store, and its read-only DHIS2
 * pass-through. Its /auth/login is deliberately not on the list: the only way
 * to sign in is AUTH_CONNECT_PATH, which this app handles itself by handing
 * over the viewer's existing DHIS2 connection server to server.
 */

/** Signs in to the module with this app's DHIS2 connection; handled in the route, never forwarded as-is. */
export const AUTH_CONNECT_PATH = "auth/connect";

/** The module's own sign-in, which only the route calls, from the server. */
export const UPSTREAM_LOGIN_PATH = "auth/login";

/** The module's session cookie: the only cookie forwarded to it. */
export const HOLISTIC_SESSION_COOKIE = "ghsha_sid";

/** The page that the Holistic page in the app shell frames. */
export const HOLISTIC_VIEWER_PATH = "index.html";

/**
 * DHIS2 resources the module reads (its own server enforces the same list,
 * server/app.js DHIS2_READABLE). Optional API version, then the resource,
 * then an id or a .json suffix.
 */
const DHIS2_READ =
  /^dhis2\/api\/(?:\d+\/)?(?:me|organisationUnits|analytics|indicators|dataElements|users|system)(?:[./][A-Za-z0-9._/-]*)?$/;

const STORE_KEY = /^api\/store\/[A-Za-z0-9._-]{1,200}$/;

const READ = [
  /^index\.html$/,
  /^assets\/[A-Za-z0-9._-]+$/,
  // favicon.ico, icon.svg, android-chrome-192x192.png and the other icons in public/
  /^[A-Za-z0-9_-]+\.(?:png|ico|svg)$/,
  /^auth\/session$/,
  /^api\/store$/,
  STORE_KEY,
  DHIS2_READ,
];

/** `path` is relative to /holistic/, with no leading slash. */
export function isHolisticPathAllowed(method: string, path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) return false;
  switch (method) {
    case "GET":
      return READ.some((pattern) => pattern.test(path));
    case "POST":
      return path === "auth/logout" || path === AUTH_CONNECT_PATH;
    case "PUT":
    case "DELETE":
      return STORE_KEY.test(path);
    default:
      return false;
  }
}

/** Only the module's own session cookie, so this app's dhis2_conn cookie never leaves it. */
export function holisticCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === HOLISTIC_SESSION_COOKIE && rest.length) {
      return `${HOLISTIC_SESSION_COOKIE}=${rest.join("=")}`;
    }
  }
  return null;
}
