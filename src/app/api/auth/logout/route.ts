/**
 * Sign out: end the session and forget this browser's DHIS2 token with it —
 * and the Holistic Assessment session, which was opened with that token — so
 * the next person at a shared computer starts from nothing.
 */
import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { CONNECTION_COOKIE } from "@/lib/dhis2/connection";
import { HOLISTIC_SESSION_COOKIE } from "@/lib/holistic/paths";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Refused: the request did not come from this site." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(CONNECTION_COOKIE);
  response.cookies.delete(HOLISTIC_SESSION_COOKIE);
  return response;
}
