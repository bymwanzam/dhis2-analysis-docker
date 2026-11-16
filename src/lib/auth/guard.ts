/**
 * The checks every account-changing route makes, in one place: signed in,
 * from this site, and — for the admin routes — an administrator.
 */
import { NextResponse } from "next/server";
import { currentSession, sameOrigin } from "./server";
import type { LiveSession } from "./state";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function refuse(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

export async function requireAccount(
  request: Request,
  options: { admin?: boolean; write?: boolean } = {},
): Promise<{ session: LiveSession } | { denied: NextResponse }> {
  if (options.write && !sameOrigin(request)) {
    return { denied: refuse(403, "Refused: the request did not come from this site.") };
  }
  const session = await currentSession();
  if (session === "off") {
    return { denied: refuse(409, "Sign-in is switched off on this server (AUTH_DISABLED), so there are no accounts to manage.") };
  }
  if (!session) return { denied: refuse(401, "Sign in first.") };
  if (options.admin && session.role !== "admin") {
    return { denied: refuse(403, "Only an administrator can manage accounts.") };
  }
  return { session };
}
