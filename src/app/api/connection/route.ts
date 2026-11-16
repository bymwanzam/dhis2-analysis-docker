/**
 * Connection lifecycle: check, save, clear.
 *
 * A saved token goes into an httpOnly cookie, so it is never readable from
 * JavaScript in the browser. Saving is refused outright when the deployment
 * pins credentials through environment variables.
 */
import { NextResponse } from "next/server";
import {
  CONNECTION_COOKIE,
  connectionCookieOptions,
  encodeConnection,
  isEnvManaged,
  isValidBaseUrl,
  normalizeBaseUrl,
  normalizeTokenType,
  readConnection,
} from "@/lib/dhis2/connection";
import { Dhis2Error, dhis2Json } from "@/lib/dhis2/server";
import { currentSession, sameOrigin } from "@/lib/auth/server";
import type { Connection, ConnectionStatus, MeResponse, SystemInfo } from "@/lib/dhis2/types";

export const dynamic = "force-dynamic";

const ME_FIELDS = "id,username,displayName,email,organisationUnits[id,displayName]";
const NO_STORE = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
} as const;

/** Confirm the credential works and collect what the UI shows about it. */
async function probe(connection: Connection): Promise<ConnectionStatus> {
  const user = await dhis2Json<MeResponse>(
    connection,
    `me.json?fields=${ME_FIELDS}`,
    { timeoutMs: 20_000 },
  );

  let system: SystemInfo | undefined;
  try {
    system = await dhis2Json<SystemInfo>(connection, "system/info.json", {
      timeoutMs: 20_000,
    });
  } catch {
    // system/info needs an extra authority on some servers; not fatal.
  }

  // Age is computed here rather than in the browser: reading the clock during
  // a render is impure, and the comparison belongs next to the value anyway.
  const lastRun = system?.lastAnalyticsTableSuccess
    ? Date.parse(system.lastAnalyticsTableSuccess)
    : Number.NaN;

  return {
    connected: true,
    baseUrl: connection.baseUrl,
    tokenType: connection.tokenType,
    managedByEnv: isEnvManaged(),
    user,
    system,
    analyticsAgeHours: Number.isNaN(lastRun)
      ? undefined
      : Math.max(0, (Date.now() - lastRun) / 36e5),
  };
}

function describe(error: unknown): string {
  if (error instanceof Dhis2Error) return error.message;
  return "Could not reach the DHIS2 server.";
}

/** Every handler here needs a signed-in person; the proxy checks too. */
async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    return {
      denied: NextResponse.json(
        { connected: false, error: "Sign in first." } satisfies ConnectionStatus,
        { status: 401, headers: NO_STORE },
      ),
    } as const;
  }
  return { session } as const;
}

export async function GET() {
  const gate = await requireSession();
  if ("denied" in gate) return gate.denied;
  const connection = await readConnection();

  if (!connection) {
    return NextResponse.json(
      { connected: false, managedByEnv: isEnvManaged() } satisfies ConnectionStatus,
      { headers: NO_STORE },
    );
  }

  try {
    return NextResponse.json(await probe(connection), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        baseUrl: connection.baseUrl,
        tokenType: connection.tokenType,
        managedByEnv: isEnvManaged(),
        error: describe(error),
      } satisfies ConnectionStatus,
      { headers: NO_STORE },
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireSession();
  if ("denied" in gate) return gate.denied;
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { connected: false, error: "Refused: the request did not come from this site." } satisfies ConnectionStatus,
      { status: 403, headers: NO_STORE },
    );
  }
  if (isEnvManaged()) {
    return NextResponse.json(
      {
        connected: true,
        managedByEnv: true,
        error: "This deployment pins its DHIS2 credentials in environment variables.",
      } satisfies ConnectionStatus,
      { status: 409, headers: NO_STORE },
    );
  }

  let body: { baseUrl?: string; token?: string; tokenType?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { connected: false, error: "Expected a JSON body." } satisfies ConnectionStatus,
      { status: 400, headers: NO_STORE },
    );
  }

  const baseUrl = normalizeBaseUrl(body.baseUrl ?? "");
  const token = (body.token ?? "").trim();

  if (!isValidBaseUrl(baseUrl)) {
    return NextResponse.json(
      {
        connected: false,
        error: "Enter a valid server URL, for example https://play.dhis2.org/40.",
      } satisfies ConnectionStatus,
      { status: 400, headers: NO_STORE },
    );
  }

  if (!token) {
    return NextResponse.json(
      { connected: false, error: "A personal access token is required." } satisfies ConnectionStatus,
      { status: 400, headers: NO_STORE },
    );
  }

  const session = gate.session;
  const connection: Connection = {
    baseUrl,
    token,
    tokenType: normalizeTokenType(body.tokenType),
    // The token is saved for the person who entered it, and works only for them.
    ...(session !== "off" ? { owner: session.sub } : {}),
  };

  let status: ConnectionStatus;
  try {
    status = await probe(connection);
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        baseUrl,
        tokenType: connection.tokenType,
        error: describe(error),
      } satisfies ConnectionStatus,
      { status: 400, headers: NO_STORE },
    );
  }

  // Someone signed in with their DHIS2 account must connect with their own
  // token, not a colleague's: the token's user has to be the signed-in user.
  if (session !== "off" && session.via === "dhis2") {
    const tokenUser = status.user?.username ?? "";
    if (tokenUser.toLowerCase() !== session.sub.toLowerCase()) {
      return NextResponse.json(
        {
          connected: false,
          baseUrl,
          tokenType: connection.tokenType,
          error: `This token belongs to the DHIS2 user "${tokenUser || "unknown"}", but you signed in as "${session.sub}". Use a personal access token from your own DHIS2 account.`,
        } satisfies ConnectionStatus,
        { status: 403, headers: NO_STORE },
      );
    }
  }

  const response = NextResponse.json(status, { headers: NO_STORE });
  response.cookies.set(CONNECTION_COOKIE, encodeConnection(connection), connectionCookieOptions());
  return response;
}

export async function DELETE() {
  const gate = await requireSession();
  if ("denied" in gate) return gate.denied;
  const response = NextResponse.json(
    { connected: false, managedByEnv: isEnvManaged() } satisfies ConnectionStatus,
    { headers: NO_STORE },
  );
  response.cookies.delete(CONNECTION_COOKIE);
  return response;
}
