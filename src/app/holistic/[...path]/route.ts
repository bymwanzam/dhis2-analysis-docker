import { NextResponse } from "next/server";
import { readConnection } from "@/lib/dhis2/connection";
import {
  AUTH_CONNECT_PATH,
  UPSTREAM_LOGIN_PATH,
  holisticCookie,
  isHolisticPathAllowed,
} from "@/lib/holistic/paths";
import { hasSameOrigin } from "@/lib/same-origin";
import { isSignedIn } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM = (process.env.HOLISTIC_UPSTREAM_URL ?? "http://localhost:3100").replace(/\/+$/, "");

/*
 * /holistic itself is the Holistic Assessment page in the app shell
 * (../page.tsx), which frames the module from /holistic/index.html.
 * Everything under /holistic/ is the module's own server, reached through
 * here and only on the paths in src/lib/holistic/paths.ts.
 *
 * The module signs in with this app's DHIS2 connection: POST
 * /holistic/auth/connect reads it on the server (DHIS2_BASE_URL/DHIS2_TOKEN,
 * or the viewer's dhis2_conn cookie — readConnection decides, exactly as for
 * every other page) and passes it to the module's /auth/login. The browser
 * never sees the token, and never reaches /auth/login itself. The module then
 * keeps the token for its session in its own memory, as it would have for a
 * token typed into its sign-in page.
 */
type RouteContext = { params: Promise<{ path: string[] }> };

const REQUEST_HEADERS = ["accept", "content-type", "if-match", "if-none-match"];
const RESPONSE_HEADERS = ["content-type", "cache-control", "etag", "content-disposition"];

function upstreamHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = holisticCookie(request.headers.get("cookie"));
  if (cookie) headers.set("cookie", cookie);
  // The module rate-limits failed sign-ins per client; let it tell them apart.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) headers.set("x-forwarded-for", forwarded);
  return headers;
}

function relay(upstream: Response): Response {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function unavailable(): Response {
  return NextResponse.json(
    { message: "The Holistic Assessment service is unavailable." },
    { status: 502 },
  );
}

/** Sign in to the module with the viewer's DHIS2 connection. */
async function connect(request: Request): Promise<Response> {
  const connection = await readConnection();
  if (!connection) {
    return NextResponse.json(
      {
        reason: "no-connection",
        message:
          "DHIS2 Analysis is not connected to DHIS2. Connect on the Connection page, then continue.",
      },
      { status: 401 },
    );
  }

  const headers = upstreamHeaders(request);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");

  try {
    return relay(
      await fetch(`${UPSTREAM}/${UPSTREAM_LOGIN_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: connection.baseUrl,
          token: connection.token,
          tokenType: connection.tokenType,
        }),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      }),
    );
  } catch {
    return unavailable();
  }
}

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  // src/proxy.ts already turns away anyone not signed in; checked again here.
  if (!(await isSignedIn())) {
    return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  }

  const path = (await context.params).path.join("/");
  if (!isHolisticPathAllowed(request.method, path)) {
    return NextResponse.json({ message: "Holistic Assessment route not allowed." }, { status: 404 });
  }

  // Sign-in, sign-out and every change to an assessment must come from this app.
  if (request.method !== "GET" && !hasSameOrigin(request)) {
    return NextResponse.json(
      { message: "Cross-origin Holistic Assessment requests are not allowed." },
      { status: 403 },
    );
  }

  if (path === AUTH_CONNECT_PATH) return connect(request);

  const target = new URL(`${UPSTREAM}/${path.split("/").map(encodeURIComponent).join("/")}`);
  target.search = new URL(request.url).search;

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: upstreamHeaders(request),
    cache: "no-store",
    redirect: "manual",
  };
  if ((request.method === "POST" || request.method === "PUT") && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    return relay(await fetch(target, init));
  } catch {
    return unavailable();
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
