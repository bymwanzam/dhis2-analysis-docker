/**
 * Server-only connection handling.
 *
 * The DHIS2 token never reaches the browser. It lives either in a server
 * environment variable or in an httpOnly cookie that only route handlers and
 * server components can read; every call to DHIS2 is made from the server.
 */
import { cookies } from "next/headers";
import type { Connection, TokenType } from "./types";

export const CONNECTION_COOKIE = "dhis2_conn";
const MAX_AGE_SECONDS = 60 * 60 * 12;

/** Trim a user-entered base URL down to the DHIS2 context path. */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\s+/g, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  // Accept a pasted ".../api" or ".../api/me" and keep only the context path.
  url = url.replace(/\/api(\/.*)?$/i, "");
  return url;
}

export function isValidBaseUrl(input: string): boolean {
  try {
    const url = new URL(normalizeBaseUrl(input));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeTokenType(value: unknown): TokenType {
  return value === "Bearer" ? "Bearer" : "ApiToken";
}

/** True when credentials are pinned by the deployment and not editable in the UI. */
export function isEnvManaged(): boolean {
  return Boolean(process.env.DHIS2_BASE_URL && process.env.DHIS2_TOKEN);
}

function envConnection(): Connection | null {
  const baseUrl = process.env.DHIS2_BASE_URL;
  const token = process.env.DHIS2_TOKEN;
  if (!baseUrl || !token) return null;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    token: token.trim(),
    tokenType: normalizeTokenType(process.env.DHIS2_TOKEN_TYPE),
  };
}

export function encodeConnection(conn: Connection): string {
  return Buffer.from(JSON.stringify(conn), "utf8").toString("base64url");
}

export function decodeConnection(value: string): Connection | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<Connection>;
    if (!parsed.baseUrl || !parsed.token) return null;
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      token: parsed.token,
      tokenType: normalizeTokenType(parsed.tokenType),
    };
  } catch {
    return null;
  }
}

/** Environment credentials win; otherwise the session cookie. */
export async function readConnection(): Promise<Connection | null> {
  const fromEnv = envConnection();
  if (fromEnv) return fromEnv;
  const store = await cookies();
  const raw = store.get(CONNECTION_COOKIE)?.value;
  return raw ? decodeConnection(raw) : null;
}

/**
 * Secure in production unless told otherwise.
 *
 * COOKIE_SECURE=false exists for one case: a container on a trusted internal
 * network that people reach over plain http, where a Secure cookie is dropped
 * by the browser and every connection vanishes on the next request. HTTPS in
 * front of the container is the better answer wherever it is possible.
 */
function cookieSecure(): boolean {
  const flag = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (flag === "false") return false;
  if (flag === "true") return true;
  return process.env.NODE_ENV === "production";
}

export function connectionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}
