import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { readConnection } from "@/lib/dhis2/connection";
import { Dhis2Error, dhis2Json } from "@/lib/dhis2/server";
import { GEOEPI_VIEWER_PATH, isGeoEpiPathAllowed } from "@/lib/geoepi/paths";
import { hasSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERIFIED_FOR_MS = 60_000;
const verifiedConnections = new Map<string, number>();
const UPSTREAM = process.env.GEOEPI_UPSTREAM_URL ?? "http://localhost:8000";

/*
 * /geoepi itself is the GeoEpi page in the app shell (../page.tsx), which
 * frames the viewer from /geoepi/index.html. Everything under /geoepi/ is the
 * service, reached through here.
 */
type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Shown inside the frame when the session lapses mid-visit. Redirecting to
 * /connect would draw the whole app a second time inside the frame, so the
 * link breaks out of it instead.
 */
const RECONNECT_PAGE = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui,sans-serif;padding:24px">
<p>The DHIS2 connection has ended. <a href="/connect" target="_top">Connect again</a> to keep using GeoEpi.</p>`;

async function connectionFailure(): Promise<NextResponse | null> {
  const connection = await readConnection();
  if (!connection) {
    return NextResponse.json(
      { error: "Connect to DHIS2 before opening GeoEpi." },
      { status: 401 },
    );
  }

  const key = createHash("sha256")
    .update(`${connection.baseUrl}\n${connection.tokenType}\n${connection.token}`)
    .digest("hex");
  const expiresAt = verifiedConnections.get(key) ?? 0;
  if (expiresAt > Date.now()) return null;

  try {
    await dhis2Json<{ id: string }>(connection, "me.json?fields=id", {
      timeoutMs: 10_000,
    });
    verifiedConnections.set(key, Date.now() + VERIFIED_FOR_MS);
    if (verifiedConnections.size > 500) {
      for (const [cacheKey, expiry] of verifiedConnections) {
        if (expiry <= Date.now()) verifiedConnections.delete(cacheKey);
      }
    }
    return null;
  } catch (error) {
    const status = error instanceof Dhis2Error && error.status === 401 ? 401 : 502;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the DHIS2 connection.",
      },
      { status },
    );
  }
}

async function proxy(request: Request, context: RouteContext): Promise<Response> {
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

  const failed = await connectionFailure();
  if (failed) {
    if (request.method === "GET" && path === GEOEPI_VIEWER_PATH) {
      return new Response(RECONNECT_PAGE, {
        status: failed.status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return failed;
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
