/**
 * The sign-in session: a small signed token in an httpOnly cookie.
 *
 * The token is `base64url(payload).base64url(HMAC-SHA256(payload))`, signed
 * with AUTH_SECRET. Nothing in it is secret — the user's name and an expiry —
 * so it is not encrypted; what matters is that it cannot be forged or
 * extended without the server's secret. Web Crypto only, so the same code
 * runs in the request proxy and in route handlers.
 */

export const SESSION_COOKIE = "site_session";

export interface SessionPayload {
  /** The account name signed in with. */
  sub: string;
  /** What to show in the header. */
  name: string;
  /** How the person signed in. */
  via: "local" | "dhis2";
  /** Issued and expiry times, seconds since the epoch. */
  iat: number;
  exp: number;
  /**
   * The account's version when the session began. A password change, a
   * disable or a delete bumps the stored version, and every older session
   * stops working at once.
   */
  ver?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

/** Compare without stopping at the first difference, so timing says nothing. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmac(secret, body));
  return `${body}.${signature}`;
}

/** The payload, or null when the token is malformed, forged or expired. */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const given = fromBase64Url(signature);
  if (!given) return null;
  const expected = await hmac(secret, body);
  if (!equalBytes(given, expected)) return null;

  const raw = fromBase64Url(body);
  if (!raw) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(decoder.decode(raw)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
  if (typeof payload.iat !== "number" || payload.iat > nowSeconds + 60) return null;
  return payload;
}

export function newSession(
  user: { sub: string; name: string; via: SessionPayload["via"]; ver?: number },
  hours: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionPayload {
  return { ...user, iat: nowSeconds, exp: nowSeconds + Math.round(hours * 3600) };
}

/**
 * Where to go after signing in: a path on this site only. Anything that
 * could leave the site — an absolute URL, a protocol-relative `//host`, a
 * backslash trick — falls back to the home page.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (/^\/(login|api\/)/.test(next)) return "/";
  return next.slice(0, 500);
}
