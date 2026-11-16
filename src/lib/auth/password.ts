/**
 * Local accounts: a name and a scrypt hash of the password, kept in the
 * AUTH_USERS environment variable. The password itself is never stored.
 *
 * Hash format: `scrypt$<N>$<salt base64url>$<hash base64url>`, made by
 * `node scripts/hash-password.mjs <name> <password>`.
 */
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from "node:crypto";

export interface LocalUser {
  name: string;
  hash: string;
}

const KEY_LENGTH = 32;
const DEFAULT_COST = 16384;

function scrypt(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { N: cost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string, cost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, cost);
  return `scrypt$${cost}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 1024 || cost > 1 << 20 || (cost & (cost - 1)) !== 0) return false;
  const salt = Buffer.from(parts[2], "base64url");
  const expected = Buffer.from(parts[3], "base64url");
  if (salt.length < 8 || expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, cost);
  return timingSafeEqual(actual, expected);
}

/** "alice:scrypt$…,bob:scrypt$…" — names are case-insensitive, first wins. */
export function parseUsers(value: string): LocalUser[] {
  const users: LocalUser[] = [];
  const seen = new Set<string>();
  for (const entry of value.split(",")) {
    const at = entry.indexOf(":");
    if (at <= 0) continue;
    const name = entry.slice(0, at).trim();
    const hash = entry.slice(at + 1).trim();
    if (!name || !hash.startsWith("scrypt$") || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    users.push({ name, hash });
  }
  return users;
}

/** A hash to check against when the name is unknown, so a miss takes as long as a hit. */
export const DUMMY_HASH =
  "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
