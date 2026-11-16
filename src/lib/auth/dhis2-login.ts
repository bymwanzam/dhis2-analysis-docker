/**
 * Checking a DHIS2 username and password against the configured server.
 *
 * The password is sent once, to DHIS2's /api/me over the server's own
 * connection, and then forgotten: it is not stored, logged or put in any
 * cookie. Only the account name comes back into the session.
 */

export type Dhis2LoginResult =
  | { ok: true; username: string; displayName: string }
  | { ok: false; reason: "invalid" | "unreachable" | "not-allowed"; message: string };

export async function checkDhis2Login(
  baseUrl: string,
  username: string,
  password: string,
  allowedUsers: string[] | null,
  fetcher: typeof fetch = fetch,
): Promise<Dhis2LoginResult> {
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}/api/me.json?fields=username,displayName,disabled`, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unreachable", message: "The DHIS2 server could not be reached. Try again in a moment." };
  }

  // DHIS2 answers a bad password with 401, or by redirecting to its login page.
  if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
    return { ok: false, reason: "invalid", message: "Wrong username or password." };
  }
  if (!response.ok) {
    return { ok: false, reason: "unreachable", message: `The DHIS2 server answered ${response.status}. Try again later.` };
  }

  let me: { username?: string; displayName?: string; disabled?: boolean };
  try {
    me = (await response.json()) as typeof me;
  } catch {
    return { ok: false, reason: "unreachable", message: "The DHIS2 server answered with something other than JSON." };
  }
  const name = (me.username ?? username).trim();
  if (me.disabled) return { ok: false, reason: "invalid", message: "This DHIS2 account is disabled." };
  if (allowedUsers && !allowedUsers.includes(name.toLowerCase())) {
    return { ok: false, reason: "not-allowed", message: "This account is not allowed to use this site. Ask the administrator." };
  }
  return { ok: true, username: name, displayName: me.displayName?.trim() || name };
}
