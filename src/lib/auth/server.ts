/**
 * Server-side sign-in checks for route handlers and server components.
 *
 * The request proxy already turns away requests without a valid session;
 * route handlers check again here, so a route is never served on the
 * proxy's word alone.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session";
import { authState, resolveSession, type LiveSession } from "./state";

/** The signed-in person, null when there is none; "off" when sign-in is disabled. */
export async function currentSession(): Promise<LiveSession | null | "off"> {
  const state = authState();
  if (!state.config.enabled) return "off";
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value, state);
}

/** True when this request may proceed. */
export async function isSignedIn(): Promise<boolean> {
  const session = await currentSession();
  return session === "off" || session !== null;
}

/**
 * The origin check for state-changing requests: a browser always sends
 * Origin on a POST, and it must be this site.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
