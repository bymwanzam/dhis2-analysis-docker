/**
 * The account file on disk.
 *
 * Kept outside the app's folder — by default `~/dhis2-analysis-data/users.json`,
 * in the hosting account's home — so redeploying the app (which replaces its
 * folder) never wipes the accounts. AUTH_STORE sets another path.
 *
 * Read on every check, but only parsed again when the file changed. Written
 * atomically (a temporary file, then a rename) so a reader never sees half a
 * file, and readable only by the hosting account.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseStore, serializeStore, type StoredUser } from "./users";

export function storePath(env: Record<string, string | undefined> = process.env): string {
  const configured = env.AUTH_STORE?.trim();
  return configured || join(homedir(), "dhis2-analysis-data", "users.json");
}

let cache: { path: string; stamp: string; users: StoredUser[] } | null = null;

/** The stored accounts; none when there is no file yet. A broken file is an error, not an empty list. */
export function readStoredUsers(path = storePath()): StoredUser[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  if (cache && cache.path === path && cache.stamp === stamp) return cache.users;
  const users = parseStore(readFileSync(path, "utf8"));
  cache = { path, stamp, users };
  return users;
}

export function writeStoredUsers(users: StoredUser[], path = storePath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, serializeStore(users), { mode: 0o600 });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows has no Unix permissions; nothing to tighten there.
  }
  cache = null;
}

/**
 * Read, change, write — the one way to change accounts. The change function
 * returns the new list, or a message saying why it refused.
 */
export function updateStoredUsers(
  change: (users: StoredUser[]) => StoredUser[] | string,
  path = storePath(),
): StoredUser[] | string {
  const current = readStoredUsers(path);
  const next = change(current.map((user) => ({ ...user })));
  if (typeof next === "string") return next;
  writeStoredUsers(next, path);
  return next;
}
