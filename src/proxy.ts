/**
 * The sign-in gate: runs before every page and API route.
 *
 * A request without a valid session is sent to /login (a page) or answered
 * 401 (an API call). The sign-in page and the sign-in/out endpoints are the
 * only ways through. Someone whose password was set by an administrator is
 * kept on the My account page until they choose their own. Route handlers
 * that touch data check the session again themselves, so this is the first
 * line, not the only one.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeNext } from "@/lib/auth/session";
import { authState, resolveSession } from "@/lib/auth/state";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];
/** Where someone who must change their password may still go. */
const PASSWORD_CHANGE_PATHS = ["/account", "/api/account/password", "/api/auth/logout"];

export async function proxy(request: NextRequest) {
  const state = authState();
  if (!state.config.enabled) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const session = await resolveSession(request.cookies.get(SESSION_COOKIE)?.value, state);

  if (session) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url));
    }
    if (session.mustChange && !PASSWORD_CHANGE_PATHS.includes(pathname)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Choose a new password first, on the My account page.", code: "MUST_CHANGE_PASSWORD" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.redirect(new URL("/account?first=1", request.url));
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Sign in first.", code: "NOT_SIGNED_IN" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const login = new URL("/login", request.url);
  const next = safeNext(`${pathname}${search}`);
  if (next !== "/") login.searchParams.set("next", next);
  const response = NextResponse.redirect(login);
  // An expired, forged or revoked cookie is removed rather than sent again and again.
  if (request.cookies.has(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  // Everything except the build's static files and the icons.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.|apple-icon\\.).*)"],
};
