/**
 * Sign-in as it stands right now: the settings, the accounts, and whether a
 * session cookie still belongs to a working account.
 *
 * A session is checked against the live account every time, not only its
 * signature: a disabled account, a changed password or a deleted account
 * stops working on the next click, and a role change applies at once.
 */
import { readAuthConfig, type AuthConfig } from "./config";
import { verifySession, type SessionPayload } from "./session";
import { readStoredUsers } from "./store";
import { findUser, mergeUsers, type EffectiveUser, type Role } from "./users";

export interface AuthState {
  config: AuthConfig;
  users: EffectiveUser[];
  /** The account file could not be read; site accounts are unavailable until it is fixed. */
  storeError: string | null;
}

export function authState(): AuthState {
  let stored: ReturnType<typeof readStoredUsers> = [];
  let storeError: string | null = null;
  try {
    stored = readStoredUsers();
  } catch (error) {
    storeError = error instanceof Error ? error.message : String(error);
  }
  const config = readAuthConfig(process.env, stored.length);
  return { config, users: mergeUsers(config.localUsers, stored), storeError };
}

/** A session that checked out, with what the account may do now. */
export interface LiveSession extends SessionPayload {
  role: Role;
  /** The password was set by an administrator and must be replaced first. */
  mustChange: boolean;
}

export async function resolveSession(
  token: string | undefined,
  state: AuthState = authState(),
): Promise<LiveSession | null> {
  const { config, users } = state;
  if (config.problem) return null;
  const session = await verifySession(token, config.secret);
  if (!session) return null;
  return liveFrom(session, users, config.adminUsers);
}

export function liveFrom(session: SessionPayload, users: EffectiveUser[], adminUsers: string[]): LiveSession | null {
  if (session.via === "local") {
    const user = findUser(users, session.sub);
    if (!user || user.disabled) return null;
    if (user.version !== (session.ver ?? 0)) return null;
    return { ...session, name: user.displayName, role: user.role, mustChange: user.mustChange };
  }
  return {
    ...session,
    role: adminUsers.includes(session.sub.toLowerCase()) ? "admin" : "user",
    mustChange: false,
  };
}
