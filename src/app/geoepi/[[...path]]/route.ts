import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { readConnection } from "@/lib/dhis2/connection";
import { Dhis2Error, dhis2Json } from "@/lib/dhis2/server";
import { hasSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERIFIED_FOR_MS = 60_000;
const verifiedConnections = new Map<string, number>();
const UPSTREAM = process.env.GEOEPI_UPSTREAM_URL ?? "http://localhost:8000";

type RouteContext = { params: Promise<{ path?: string[] }> };

function isAllowed(method: string, path: string): boolean {
  if (method === "GET") {
    return (
      path === "" ||
      path === "lib.js" ||
      path === "export.js" ||
      /^vendor\/[A-Za-z0-9._-]+$/.test(path) ||
      /^api\/(notebooks|datasets|jobs)$/.test(path) ||
      /^api\/jobs\/[A-Za-z0-9_-]+(?:\/(?:log|download\.zip))?$/.test(path) ||
      /^results\/[A-Za-z0-9_-]+\/.+$/.test(path)
    );
  }

  return (
    method === "POST" &&
    [
      "api/datasets",
      "api/datasets/files",
      "api/datasets/from-job",
      "api/datasets/dhis2-map",
      "api/jobs",
    ].includes(path)
  );
}

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
  const path = ((await context.params).path ?? []).join("/");
  if (path.split("/").includes("..") || !isAllowed(request.method, path)) {
    return NextResponse.json({ error: "GeoEpi route not allowed." }, { status: 404 });
  }

  if (request.method === "POST") {
    if (!hasSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin GeoEpi requests are not allowed." }, {
        status: 403,
      });
    }
  }

  const failed = await connectionFailure();
  if (failed) {
    if (
      request.method === "GET" &&
      path === "" &&
      request.headers.get("accept")?.includes("text/html")
    ) {
      return NextResponse.redirect(new URL("/connect", request.url));
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
