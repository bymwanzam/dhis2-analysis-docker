/**
 * Read-only DHIS2 proxy.
 *
 * The browser calls /api/dhis2/<endpoint>?<query> and this handler replays it
 * against the configured DHIS2 server with the token attached. Only GET, and
 * only endpoints on the allowlist, ever reach DHIS2 — the token cannot be
 * borrowed from here to write data.
 */
import { NextResponse } from "next/server";
import { readConnection } from "@/lib/dhis2/connection";
import { isAllowedPath } from "@/lib/dhis2/paths";
import { Dhis2Error, dhis2Json } from "@/lib/dhis2/server";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
} as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const endpoint = (path ?? []).join("/");

  if (!isAllowedPath(endpoint)) {
    return NextResponse.json(
      {
        error: "That DHIS2 endpoint is not available through this proxy.",
        detail: `Blocked: ${endpoint}`,
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const connection = await readConnection();
  if (!connection) {
    return NextResponse.json(
      { error: "No DHIS2 connection is configured.", code: "NOT_CONNECTED" },
      { status: 401, headers: NO_STORE },
    );
  }

  const search = new URL(request.url).search;

  try {
    const data = await dhis2Json<unknown>(connection, `${endpoint}${search}`);
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Dhis2Error) {
      return NextResponse.json(
        { error: error.message, detail: error.detail },
        { status: error.status, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "Unexpected error talking to DHIS2." },
      { status: 500, headers: NO_STORE },
    );
  }
}
