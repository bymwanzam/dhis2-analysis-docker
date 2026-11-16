/**
 * Sign in: check a name and password, then set the signed session cookie.
 *
 * Local accounts (AUTH_USERS) are tried first, then the DHIS2 server
 * (AUTH_DHIS2_URL or DHIS2_BASE_URL). Failures are counted per address and
 * per account name and slowed down, which also keeps someone guessing here
 * from locking a DHIS2 account. The password is never stored or logged.
 *
 * Any DHIS2 token saved in this browser is cleared, and so is a Holistic
 * Assessment session (which holds the previous person's DHIS2 token): the
 * person signing in connects with their own.
 */
import { NextResponse } from "next/server";
import { authState } from "@/lib/auth/state";
import { findUser } from "@/lib/auth/users";
import { checkDhis2Login } from "@/lib/auth/dhis2-login";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { AttemptLimiter } from "@/lib/auth/rate-limit";
import { sameOrigin } from "@/lib/auth/server";
import { SESSION_COOKIE, newSession, safeNext, signSession } from "@/lib/auth/session";
import { CONNECTION_COOKIE, cookieSecure } from "@/lib/dhis2/connection";
import { HOLISTIC_SESSION_COOKIE } from "@/lib/holistic/paths";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const limiter = new AttemptLimiter(8, 15 * 60 * 1000);

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const state = authState();
  const config = state.config;
  if (!config.enabled) {
    return NextResponse.json({ ok: true, next: "/" }, { headers: NO_STORE });
  }
  if (config.problem) {
    return NextResponse.json({ ok: false, error: `Sign-in is not set up on this server. ${config.problem}` }, { status: 503, headers: NO_STORE });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Refused: the request did not come from this site." }, { status: 403, headers: NO_STORE });
  }

  let body: { username?: unknown; password?: unknown; next?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400, headers: NO_STORE });
  }
  const username = typeof body.username === "string" ? body.username.trim().slice(0, 150) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 500) : "";
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "Enter your username and password." }, { status: 400, headers: NO_STORE });
  }

  const keys = [`ip:${clientAddress(request)}`, `user:${username.toLowerCase()}`];
  const wait = limiter.retryAfter(keys);
  if (wait > 0) {
    return NextResponse.json(
      { ok: false, error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.` },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(wait) } },
    );
  }

  let user: { sub: string; name: string; via: "local" | "dhis2"; ver?: number } | null = null;
  let mustChange = false;
  let error = "Wrong username or password.";

  const local = findUser(state.users, username);
  // Hash even for an unknown name, so a miss takes as long as a hit.
  const localOk = await verifyPassword(password, local?.hash ?? DUMMY_HASH);
  if (local && localOk && local.disabled) {
    limiter.fail(keys);
    return NextResponse.json({ ok: false, error: "This account is disabled. Ask an administrator." }, { status: 401, headers: NO_STORE });
  }
  if (local && localOk) {
    user = { sub: local.name, name: local.displayName, via: "local", ver: local.version };
    mustChange = local.mustChange;
  } else if (config.dhis2Url) {
    const result = await checkDhis2Login(config.dhis2Url, username, password, config.allowedUsers);
    if (result.ok) user = { sub: result.username, name: result.displayName, via: "dhis2" };
    else {
      error = result.message;
      if (result.reason === "unreachable") {
        // The server's trouble is not the person's failed attempt.
        return NextResponse.json({ ok: false, error }, { status: 502, headers: NO_STORE });
      }
    }
  }

  if (!user) {
    limiter.fail(keys);
    // A small fixed delay on every failure makes guessing slower still.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json({ ok: false, error }, { status: 401, headers: NO_STORE });
  }

  limiter.succeed(keys);
  const session = newSession(user, config.sessionHours);
  // A password an administrator chose is replaced before anything else.
  const next = mustChange ? "/account?first=1" : safeNext(typeof body.next === "string" ? body.next : null);
  const response = NextResponse.json({ ok: true, next, name: user.name }, { headers: NO_STORE });
  response.cookies.set(SESSION_COOKIE, await signSession(session, config.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: Math.round(config.sessionHours * 3600),
  });
  response.cookies.delete(CONNECTION_COOKIE);
  response.cookies.delete(HOLISTIC_SESSION_COOKIE);
  return response;
}
