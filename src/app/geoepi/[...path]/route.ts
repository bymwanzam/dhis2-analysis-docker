import { NextResponse } from "next/server";
import { isGeoEpiPathAllowed } from "@/lib/geoepi/paths";
import { hasSameOrigin } from "@/lib/same-origin";
import { isSignedIn } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM = process.env.GEOEPI_UPSTREAM_URL ?? "http://localhost:8000";

/*
 * /geoepi itself is the GeoEpi page in the app shell (../page.tsx), which
 * frames the viewer from /geoepi/index.html. Everything under /geoepi/ is the
 * service, reached through here. It opens without a DHIS2 connection; the
 * DHIS2 token is never sent to GeoEpi.
 */
type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  // src/proxy.ts already turns away anyone not signed in; checked again here.
  if (!(await isSignedIn())) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const path = (await context.params).path.join("/");
  if (!isGeoEpiPathAllowed(request.method, path)) {
    return NextResponse.json({ error: "GeoEpi route not allowed." }, { status: 404 });
  }

  // Anything that changes GeoEpi's data (uploads, runs, deleting a run) must come from this app.
  if (request.method !== "GET") {
    if (!hasSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin GeoEpi requests are not allowed." }, {
        status: 403,
      });
    }
  }

  const incoming = new URL(request.url);
  const target = new URL(
    path.split("/").map(encodeURIComponent).join("/"),
    `${UPSTREAM.replace(/\/+$/, "")}/`,
  );
  target.search = incoming.search;

  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    cache: "no-store",
    redirect: "manual",
  };
  if (request.method === "POST" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json({ error: "GeoEpi service is unavailable." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
