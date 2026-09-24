/** Server-side DHIS2 client. The only place the token is attached to a request. */
import type { Connection } from "./types";

export class Dhis2Error extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "Dhis2Error";
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 90_000;

export function authHeader(conn: Connection): string {
  return `${conn.tokenType} ${conn.token}`;
}

/** Build an absolute DHIS2 Web API URL from a relative API path. */
export function apiUrl(conn: Connection, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `${conn.baseUrl}/api/${clean}`;
}

export async function dhis2Fetch(
  conn: Connection,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  try {
    return await fetch(apiUrl(conn, path), {
      ...rest,
      method: rest.method ?? "GET",
      headers: {
        Authorization: authHeader(conn),
        Accept: "application/json",
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "The DHIS2 server did not respond in time."
        : `Could not reach ${conn.baseUrl}. Check the server URL and that it is online.`;
    throw new Dhis2Error(message, 502, error instanceof Error ? error.message : undefined);
  }
}

/** Fetch and parse JSON, turning DHIS2 error payloads into Dhis2Error. */
export async function dhis2Json<T>(
  conn: Connection,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const response = await dhis2Fetch(conn, path, init);

  if (response.status >= 300 && response.status < 400) {
    // A redirect to the login page is how DHIS2 answers an unusable credential.
    throw new Dhis2Error(
      "DHIS2 redirected the request, which usually means the token was rejected.",
      401,
    );
  }

  const body = await response.text();

  if (!response.ok) {
    throw new Dhis2Error(describeStatus(response.status), response.status, extractMessage(body));
  }

  if (!body) return {} as T;

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Dhis2Error(
      "DHIS2 returned a non-JSON response. The server URL may point at a login page rather than the API.",
      502,
      body.slice(0, 300),
    );
  }
}

function describeStatus(status: number): string {
  switch (status) {
    case 401:
      return "DHIS2 rejected the token (401). Check that it is valid and not expired.";
    case 403:
      return "The token is valid but lacks authority for this request (403).";
    case 404:
      return "DHIS2 has no such endpoint or object (404).";
    case 409:
      return "DHIS2 rejected the query (409). Check the selected dimensions — a very large selection can also exceed the server's analytics record limit.";
    default:
      return `DHIS2 responded with status ${status}.`;
  }
}

function extractMessage(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { message?: string; devMessage?: string };
    return parsed.message ?? parsed.devMessage;
  } catch {
    return body.slice(0, 300);
  }
}
