/**
 * Site accounts and the rules for changing them. Pure: no file or network
 * access, so every rule here is tested directly.
 *
 * Accounts come from two places. The account file (written by the Manage
 * users page) and AUTH_USERS in the server settings, which seeds the first
 * administrators. When both name the same account, the file wins: once an
 * administrator changes an AUTH_USERS account in the app, the app's copy is
 * the one that counts.
 */
import { randomBytes } from "node:crypto";
import type { LocalUser } from "./password";

export type Role = "admin" | "user";

export interface StoredUser {
  name: string;
  displayName: string;
  role: Role;
  /** scrypt hash; the password itself is never kept. */
  hash: string;
  disabled: boolean;
  /** Set when an administrator chose the password: the person must replace it. */
  mustChange: boolean;
  /** Bumped on every password change, disable or delete: older sessions stop working. */
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface EffectiveUser extends StoredUser {
  /** "site": the account file; "server": AUTH_USERS only, not yet changed in the app. */
  source: "site" | "server";
}

export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The accounts that can sign in, file first; AUTH_USERS accounts are administrators. */
export function mergeUsers(envUsers: LocalUser[], stored: StoredUser[]): EffectiveUser[] {
  const users: EffectiveUser[] = stored.map((user) => ({ ...user, source: "site" }));
  for (const env of envUsers) {
    if (users.some((user) => sameName(user.name, env.name))) continue;
    users.push({
      name: env.name,
      displayName: env.name,
      role: "admin",
      hash: env.hash,
      disabled: false,
      mustChange: false,
      version: 0,
      createdAt: "",
      updatedAt: "",
      source: "server",
    });
  }
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

export function findUser<T extends { name: string }>(users: T[], name: string): T | undefined {
  return users.find((user) => sameName(user.name, name));
}

/** The account as it will be written to the file. */
export function toStored(user: EffectiveUser | StoredUser): StoredUser {
  return {
    name: user.name,
    displayName: user.displayName,
    role: user.role,
    hash: user.hash,
    disabled: user.disabled,
    mustChange: user.mustChange,
    version: user.version,
    createdAt: user.createdAt || new Date(0).toISOString(),
    updatedAt: user.updatedAt || new Date(0).toISOString(),
    ...(user.createdBy ? { createdBy: user.createdBy } : {}),
  };
}

/* ------------------------------------------------------------ checks */

export function validateUsername(name: string, existing: { name: string }[]): string | null {
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(name)) {
    return "Use 3 to 40 letters, digits, dots, dashes or underscores, with no spaces.";
  }
  if (findUser(existing, name)) return `There is already an account called "${name}".`;
  return null;
}

export function validatePassword(password: string, name: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (password.toLowerCase().includes(name.toLowerCase()) && name.length >= 3) {
    return "The password cannot contain the username.";
  }
  if (/^(.)\1+$/.test(password)) return "The password cannot be one character repeated.";
  return null;
}

/** 18 characters from an alphabet without look-alikes (0/O, 1/l/I), in three groups. */
export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  // Rejection sampling keeps every character equally likely.
  const out: string[] = [];
  while (out.length < 18) {
    for (const byte of randomBytes(32)) {
      if (byte < 248 && out.length < 18) out.push(alphabet[byte % alphabet.length]);
    }
  }
  return `${out.slice(0, 6).join("")}-${out.slice(6, 12).join("")}-${out.slice(12).join("")}`;
}

/* --------------------------------------------------- what may change */

export function activeAdmins(users: { role: Role; disabled: boolean }[]): number {
  return users.filter((user) => user.role === "admin" && !user.disabled).length;
}

export type UserChange =
  | { kind: "role"; role: Role }
  | { kind: "disabled"; disabled: boolean }
  | { kind: "delete" }
  | { kind: "reset-password" }
  | { kind: "display-name" };

/**
 * Whether `actor` may make this change to `target`. The site must always
 * keep one working administrator, and an administrator cannot lock or
 * demote themselves out by accident.
 */
export function changeProblem(
  users: EffectiveUser[],
  actorName: string,
  target: EffectiveUser,
  change: UserChange,
): string | null {
  const self = sameName(actorName, target.name);
  const removesAdmin =
    target.role === "admin" &&
    !target.disabled &&
    ((change.kind === "role" && change.role !== "admin") ||
      (change.kind === "disabled" && change.disabled) ||
      change.kind === "delete");
  if (self && removesAdmin) {
    return "You cannot remove your own administrator access. Ask another administrator.";
  }
  if (self && change.kind === "reset-password") {
    return "Change your own password on the My account page.";
  }
  if (removesAdmin && activeAdmins(users) <= 1) {
    return "This is the last administrator. Make someone else an administrator first.";
  }
  if (change.kind === "delete" && target.source === "server") {
    return "This account comes from the server settings (AUTH_USERS). Disable it here, or remove it from AUTH_USERS in cPanel.";
  }
  return null;
}

/** What the browser may see of an account: never the hash. */
export interface PublicUser {
  name: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  mustChange: boolean;
  source: "site" | "server";
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export function toPublic(user: EffectiveUser): PublicUser {
  return {
    name: user.name,
    displayName: user.displayName,
    role: user.role,
    disabled: user.disabled,
    mustChange: user.mustChange,
    source: user.source,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...(user.createdBy ? { createdBy: user.createdBy } : {}),
  };
}

/** The account file, read defensively: anything malformed is left out, never half-used. */
export function parseStore(text: string): StoredUser[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The account file is not valid JSON.");
  }
  const list = (parsed as { users?: unknown })?.users;
  if (!Array.isArray(list)) throw new Error("The account file holds no user list.");
  const users: StoredUser[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const user = raw as Partial<StoredUser>;
    if (typeof user.name !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(user.name)) continue;
    if (typeof user.hash !== "string" || !user.hash.startsWith("scrypt$")) continue;
    if (findUser(users, user.name)) continue;
    users.push({
      name: user.name,
      displayName: typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim().slice(0, 80) : user.name,
      role: user.role === "admin" ? "admin" : "user",
      hash: user.hash,
      disabled: user.disabled === true,
      mustChange: user.mustChange === true,
      version: Number.isInteger(user.version) ? (user.version as number) : 0,
      createdAt: typeof user.createdAt === "string" ? user.createdAt : "",
      updatedAt: typeof user.updatedAt === "string" ? user.updatedAt : "",
      ...(typeof user.createdBy === "string" ? { createdBy: user.createdBy } : {}),
    });
  }
  return users;
}

export function serializeStore(users: StoredUser[]): string {
  return `${JSON.stringify({ format: "dhis2-analysis/users", version: 1, users: users.map(toStored) }, null, 2)}\n`;
}
