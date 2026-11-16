/**
 * Change your own password: the current one first, then the new one.
 *
 * The account's version goes up, which ends every other session of this
 * account (another browser, a stolen cookie); this browser gets a fresh
 * session so the person stays signed in here.
 */
import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireAccount } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, newSession, signSession } from "@/lib/auth/session";
import { authState } from "@/lib/auth/state";
import { updateStoredUsers } from "@/lib/auth/store";
import { findUser, toStored, validatePassword } from "@/lib/auth/users";
import { cookieSecure } from "@/lib/dhis2/connection";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await requireAccount(request, { write: true });
  if ("denied" in gate) return gate.denied;
  const { session } = gate;
  if (session.via !== "local") {
    return refuse(409, "You signed in with your DHIS2 account. Change that password in DHIS2.");
  }

  let body: { current?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse(400, "Expected a JSON body.");
  }
  const current = typeof body.current === "string" ? body.current : "";
  const password = typeof body.password === "string" ? body.password : "";

  const state = authState();
  const account = findUser(state.users, session.sub);
  if (!account) return refuse(404, "Your account no longer exists.");
  if (!(await verifyPassword(current, account.hash))) return refuse(400, "Your current password is not right.");
  const problem = validatePassword(password, account.name);
  if (problem) return refuse(400, problem);
  if (current === password) return refuse(400, "Choose a password different from the current one.");

  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  const nextVersion = account.version + 1;
  const result = updateStoredUsers((users) => {
    const others = users.filter((user) => user.name.toLowerCase() !== account.name.toLowerCase());
    return [...others, { ...toStored(account), hash, mustChange: false, version: nextVersion, updatedAt: now }];
  });
  if (typeof result === "string") return refuse(409, result);

  const fresh = newSession({ sub: account.name, name: account.displayName, via: "local", ver: nextVersion }, state.config.sessionHours);
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  response.cookies.set(SESSION_COOKIE, await signSession(fresh, state.config.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: Math.round(state.config.sessionHours * 3600),
  });
  return response;
}
