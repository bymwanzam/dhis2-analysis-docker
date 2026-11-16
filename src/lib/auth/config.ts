/**
 * How sign-in is set up, from the server's environment.
 *
 *   AUTH_SECRET          required: 32+ random characters that sign sessions
 *   AUTH_USERS           local accounts, "name:hash,name:hash" from
 *                        `node scripts/hash-password.mjs <name> <password>`
 *   AUTH_DHIS2_URL       sign in with DHIS2 accounts on this server
 *                        (defaults to DHIS2_BASE_URL when that is set)
 *   AUTH_ALLOWED_USERS   optional: only these DHIS2 usernames may sign in
 *   AUTH_ADMINS          optional: DHIS2 usernames that may manage site accounts
 *   AUTH_STORE           where the account file lives (default ~/dhis2-analysis-data/users.json)
 *   AUTH_SESSION_HOURS   default 12
 *   AUTH_DISABLED=true   no sign-in at all (local development only)
 *
 * The site fails closed: with sign-in on but not set up, nobody gets in and
 * the sign-in page says what is missing.
 */
import { parseUsers, type LocalUser } from "./password";

export interface AuthConfig {
  enabled: boolean;
  secret: string;
  localUsers: LocalUser[];
  dhis2Url: string | null;
  allowedUsers: string[] | null;
  /** DHIS2 accounts that are administrators of this site, lower case. */
  adminUsers: string[];
  sessionHours: number;
  /** What stops sign-in working, in words; null when it is ready. */
  problem: string | null;
}

export function readAuthConfig(
  env: Record<string, string | undefined> = process.env,
  /** Accounts in the account file; they count as a way to sign in. */
  storedUsers = 0,
): AuthConfig {
  const enabled = env.AUTH_DISABLED?.trim().toLowerCase() !== "true";
  const secret = env.AUTH_SECRET?.trim() ?? "";
  const localUsers = parseUsers(env.AUTH_USERS ?? "");
  const rawDhis2 = env.AUTH_DHIS2_URL?.trim() || env.DHIS2_BASE_URL?.trim() || "";
  const dhis2Url = rawDhis2 ? trimServerUrl(rawDhis2) : null;
  const allowed = (env.AUTH_ALLOWED_USERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const adminUsers = (env.AUTH_ADMINS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const hours = Number(env.AUTH_SESSION_HOURS);
  const sessionHours = Number.isFinite(hours) && hours > 0 && hours <= 24 * 30 ? hours : 12;

  let problem: string | null = null;
  if (enabled) {
    if (secret.length < 32) {
      problem = "AUTH_SECRET is not set, or shorter than 32 characters.";
    } else if (!localUsers.length && !dhis2Url && !storedUsers) {
      problem = "No way to sign in is set up: add AUTH_USERS, or AUTH_DHIS2_URL (or DHIS2_BASE_URL).";
    }
  }

  return {
    enabled,
    secret,
    localUsers,
    dhis2Url,
    allowedUsers: allowed.length ? allowed : null,
    adminUsers,
    sessionHours,
    problem,
  };
}

/** A DHIS2 server URL down to its context path, as the connection page trims it. */
function trimServerUrl(input: string): string {
  let url = input.replace(/\s+/g, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "").replace(/\/api(\/.*)?$/i, "");
}
