/**
 * Site accounts, for administrators: list them and add new ones.
 *
 * A new account gets a password the administrator chose or one generated
 * here, shown once in the response and never stored in the clear; the
 * person must replace it at first sign-in.
 */
import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireAccount } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { authState } from "@/lib/auth/state";
import { storePath, updateStoredUsers } from "@/lib/auth/store";
import {
  findUser,
  generatePassword,
  toPublic,
  validatePassword,
  validateUsername,
  type Role,
} from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireAccount(request, { admin: true });
  if ("denied" in gate) return gate.denied;
  const state = authState();
  return NextResponse.json(
    {
      ok: true,
      users: state.users.map(toPublic),
      storeError: state.storeError,
      storePath: storePath(),
      dhis2SignIn: Boolean(state.config.dhis2Url),
      me: gate.session.sub,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const gate = await requireAccount(request, { admin: true, write: true });
  if ("denied" in gate) return gate.denied;

  let body: { name?: unknown; displayName?: unknown; role?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse(400, "Expected a JSON body.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim().slice(0, 80) : name;
  const role: Role = body.role === "admin" ? "admin" : "user";
  const chosen = typeof body.password === "string" ? body.password : "";

  const state = authState();
  if (state.storeError) return refuse(500, `The account file cannot be read: ${state.storeError}`);
  const nameProblem = validateUsername(name, state.users);
  if (nameProblem) return refuse(400, nameProblem);
  const password = chosen || generatePassword();
  const passwordProblem = validatePassword(password, name);
  if (passwordProblem) return refuse(400, passwordProblem);

  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  let result;
  try {
    result = updateStoredUsers((users) => {
      if (findUser(users, name)) return `There is already an account called "${name}".`;
      return [
        ...users,
        { name, displayName, role, hash, disabled: false, mustChange: true, version: 1, createdAt: now, updatedAt: now, createdBy: gate.session.sub },
      ];
    });
  } catch (error) {
    return refuse(500, `The account file could not be written (${error instanceof Error ? error.message : String(error)}). Check AUTH_STORE.`);
  }
  if (typeof result === "string") return refuse(409, result);

  return NextResponse.json({ ok: true, name, password, generated: !chosen }, { headers: NO_STORE });
}
