/**
 * One site account, for administrators: change its role or name, disable or
 * enable it, reset its password, or delete it.
 *
 * Every change that should end the person's current sessions (a reset, a
 * disable, a delete, a demotion) bumps the account's version. The rules in
 * `changeProblem` keep one working administrator at all times.
 */
import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireAccount } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { authState } from "@/lib/auth/state";
import { updateStoredUsers } from "@/lib/auth/store";
import {
  changeProblem,
  findUser,
  generatePassword,
  sameName,
  toStored,
  validatePassword,
  type StoredUser,
  type UserChange,
} from "@/lib/auth/users";

export const dynamic = "force-dynamic";

function write(change: (users: StoredUser[]) => StoredUser[] | string) {
  try {
    return updateStoredUsers(change);
  } catch (error) {
    return `The account file could not be written (${error instanceof Error ? error.message : String(error)}). Check AUTH_STORE.`;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ name: string }> }) {
  const gate = await requireAccount(request, { admin: true, write: true });
  if ("denied" in gate) return gate.denied;
  const { name } = await context.params;

  let body: { role?: unknown; disabled?: unknown; displayName?: unknown; resetPassword?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse(400, "Expected a JSON body.");
  }

  const state = authState();
  if (state.storeError) return refuse(500, `The account file cannot be read: ${state.storeError}`);
  const target = findUser(state.users, decodeURIComponent(name));
  if (!target) return refuse(404, "No such account.");

  const changes: UserChange[] = [];
  if (body.role === "admin" || body.role === "user") changes.push({ kind: "role", role: body.role });
  if (typeof body.disabled === "boolean") changes.push({ kind: "disabled", disabled: body.disabled });
  if (body.resetPassword === true) changes.push({ kind: "reset-password" });
  if (typeof body.displayName === "string") changes.push({ kind: "display-name" });
  if (!changes.length) return refuse(400, "Nothing to change.");
  for (const change of changes) {
    const problem = changeProblem(state.users, gate.session.sub, target, change);
    if (problem) return refuse(409, problem);
  }

  const updated = { ...toStored(target), updatedAt: new Date().toISOString() };
  let endSessions = false;
  let newPassword: string | null = null;

  if (body.role === "admin" || body.role === "user") {
    if (updated.role === "admin" && body.role === "user") endSessions = true;
    updated.role = body.role;
  }
  if (typeof body.disabled === "boolean") {
    if (body.disabled && !updated.disabled) endSessions = true;
    updated.disabled = body.disabled;
  }
  if (typeof body.displayName === "string") {
    updated.displayName = body.displayName.trim().slice(0, 80) || updated.name;
  }
  if (body.resetPassword === true) {
    const chosen = typeof body.password === "string" ? body.password : "";
    newPassword = chosen || generatePassword();
    const problem = validatePassword(newPassword, updated.name);
    if (problem) return refuse(400, problem);
    updated.hash = await hashPassword(newPassword);
    updated.mustChange = true;
    endSessions = true;
  }
  if (endSessions) updated.version += 1;

  const result = write((users) => [...users.filter((user) => !sameName(user.name, updated.name)), updated]);
  if (typeof result === "string") return refuse(500, result);
  return NextResponse.json({ ok: true, ...(newPassword ? { password: newPassword } : {}) }, { headers: NO_STORE });
}

export async function DELETE(request: Request, context: { params: Promise<{ name: string }> }) {
  const gate = await requireAccount(request, { admin: true, write: true });
  if ("denied" in gate) return gate.denied;
  const { name } = await context.params;
  const state = authState();
  if (state.storeError) return refuse(500, `The account file cannot be read: ${state.storeError}`);
  const target = findUser(state.users, decodeURIComponent(name));
  if (!target) return refuse(404, "No such account.");
  const problem = changeProblem(state.users, gate.session.sub, target, { kind: "delete" });
  if (problem) return refuse(409, problem);

  const result = write((users) => users.filter((user) => !sameName(user.name, target.name)));
  if (typeof result === "string") return refuse(500, result);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
