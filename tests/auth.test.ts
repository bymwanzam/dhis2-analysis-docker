/**
 * Sign-in: the gate in front of the whole site.
 *
 * A session must be impossible to forge or extend without the server's
 * secret, a stored password must check without ever being stored, the site
 * must stay locked when sign-in is half set up, and a DHIS2 token must only
 * ever work for the person who saved it.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readAuthConfig } from "../src/lib/auth/config";
import { checkDhis2Login } from "../src/lib/auth/dhis2-login";
import { DUMMY_HASH, hashPassword, parseUsers, verifyPassword } from "../src/lib/auth/password";
import { AttemptLimiter } from "../src/lib/auth/rate-limit";
import { newSession, safeNext, signSession, verifySession } from "../src/lib/auth/session";

const SECRET = "a-test-secret-that-is-long-enough-for-hmac-0123";

describe("sessions", () => {
  test("a signed session verifies and carries the person", async () => {
    const session = newSession({ sub: "kofi", name: "Kofi Mensah", via: "dhis2" }, 12, 1_000_000);
    const token = await signSession(session, SECRET);
    const back = await verifySession(token, SECRET, 1_000_100);
    assert.deepEqual(back, session);
  });

  test("a tampered payload, a wrong secret or an expired session is refused", async () => {
    const session = newSession({ sub: "kofi", name: "Kofi", via: "local" }, 1, 1_000_000);
    const token = await signSession(session, SECRET);
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...session, sub: "admin" })).toString("base64url");
    assert.equal(await verifySession(`${forged}.${signature}`, SECRET, 1_000_100), null);
    assert.equal(await verifySession(`${body}.${signature.slice(0, -2)}AA`, SECRET, 1_000_100), null);
    assert.equal(await verifySession(token, `${SECRET}x`, 1_000_100), null);
    assert.equal(await verifySession(token, SECRET, 1_000_000 + 3601), null);
    assert.equal(await verifySession("garbage", SECRET), null);
    assert.equal(await verifySession(undefined, SECRET), null);
    assert.equal(await verifySession(token, ""), null);
  });

  test("after sign-in, only a path on this site is followed", () => {
    assert.equal(safeNext("/data-quality?x=1"), "/data-quality?x=1");
    assert.equal(safeNext("https://evil.example/"), "/");
    assert.equal(safeNext("//evil.example/path"), "/");
    assert.equal(safeNext("/\\evil.example"), "/");
    assert.equal(safeNext("/login"), "/");
    assert.equal(safeNext("/api/auth/logout"), "/");
    assert.equal(safeNext(null), "/");
  });
});

describe("local accounts", () => {
  test("a password checks against its hash and nothing else", async () => {
    const hash = await hashPassword("correct horse battery", 1024);
    assert.ok(hash.startsWith("scrypt$1024$"));
    assert.equal(await verifyPassword("correct horse battery", hash), true);
    assert.equal(await verifyPassword("correct horse batterY", hash), false);
    assert.equal(await verifyPassword("anything", "plain-text-password"), false);
    assert.equal(await verifyPassword("anything", DUMMY_HASH), false);
  });

  test("the hashing script makes an entry the site accepts", async () => {
    const script = fileURLToPath(new URL("../scripts/hash-password.mjs", import.meta.url));
    const line = execFileSync(process.execPath, [script, "district.officer", "a long password 42"], { encoding: "utf8" }).trim();
    const [user] = parseUsers(line);
    assert.equal(user.name, "district.officer");
    assert.equal(await verifyPassword("a long password 42", user.hash), true);
    const secret = execFileSync(process.execPath, [script, "--secret"], { encoding: "utf8" }).trim();
    assert.ok(secret.length >= 40);
  });

  test("the AUTH_USERS list skips malformed and repeated names", () => {
    const users = parseUsers("ama:scrypt$16384$a$b, kofi:plain ,AMA:scrypt$16384$c$d,:scrypt$x,yaw:scrypt$16384$e$f");
    assert.deepEqual(users.map((user) => user.name), ["ama", "yaw"]);
  });
});

describe("configuration", () => {
  test("the site stays locked until a secret and a way to sign in are set", () => {
    assert.match(readAuthConfig({}).problem ?? "", /AUTH_SECRET/);
    assert.match(readAuthConfig({ AUTH_SECRET: "short" }).problem ?? "", /AUTH_SECRET/);
    assert.match(readAuthConfig({ AUTH_SECRET: SECRET }).problem ?? "", /No way to sign in/);
    const dhis2 = readAuthConfig({ AUTH_SECRET: SECRET, DHIS2_BASE_URL: "https://dhims2.example.org/api/" });
    assert.equal(dhis2.problem, null);
    assert.equal(dhis2.dhis2Url, "https://dhims2.example.org");
    assert.equal(readAuthConfig({ AUTH_SECRET: SECRET, AUTH_USERS: "ama:scrypt$16384$a$b" }).problem, null);
  });

  test("sign-in can only be switched off explicitly; sessions last 12 hours unless told", () => {
    assert.equal(readAuthConfig({}).enabled, true);
    assert.equal(readAuthConfig({ AUTH_DISABLED: "true" }).enabled, false);
    assert.equal(readAuthConfig({ AUTH_DISABLED: "yes" }).enabled, true);
    assert.equal(readAuthConfig({}).sessionHours, 12);
    assert.equal(readAuthConfig({ AUTH_SESSION_HOURS: "8" }).sessionHours, 8);
    assert.equal(readAuthConfig({ AUTH_SESSION_HOURS: "-1" }).sessionHours, 12);
    assert.deepEqual(readAuthConfig({ AUTH_ALLOWED_USERS: "Kofi, ama ," }).allowedUsers, ["kofi", "ama"]);
  });
});

describe("throttling", () => {
  test("too many failures lock a key until the window moves on; success clears it", () => {
    const limiter = new AttemptLimiter(3, 60_000);
    const keys = ["ip:1", "user:kofi"];
    for (let i = 0; i < 3; i += 1) limiter.fail(keys, 1000 + i);
    assert.ok(limiter.retryAfter(keys, 2000) > 0);
    assert.ok(limiter.retryAfter(["user:kofi"], 2000) > 0);
    assert.equal(limiter.retryAfter(["ip:2"], 2000), 0);
    assert.equal(limiter.retryAfter(keys, 1000 + 60_001), 0);
    limiter.fail(keys, 5000);
    limiter.succeed(keys);
    assert.equal(limiter.retryAfter(keys, 5001), 0);
  });
});

describe("signing in with DHIS2", () => {
  const reply = (status: number, body: unknown = {}) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  test("a good password returns the account; the password goes only in the request", async () => {
    let sent: RequestInit | undefined;
    const result = await checkDhis2Login("https://dhims2.example.org", "kofi", "pw", null, (async (_url: string, init: RequestInit) => {
      sent = init;
      return new Response(JSON.stringify({ username: "Kofi", displayName: "Kofi Mensah" }), { status: 200 });
    }) as unknown as typeof fetch);
    assert.deepEqual(result, { ok: true, username: "Kofi", displayName: "Kofi Mensah" });
    assert.equal((sent?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from("kofi:pw").toString("base64")}`);
    assert.equal(sent?.redirect, "manual");
  });

  test("a wrong password, a redirect to DHIS2's login page, a disabled account and an unlisted account are refused", async () => {
    assert.equal((await checkDhis2Login("https://x", "a", "b", null, reply(401) as unknown as typeof fetch)).ok, false);
    const redirected = await checkDhis2Login("https://x", "a", "b", null, reply(302) as unknown as typeof fetch);
    assert.equal(redirected.ok === false && redirected.reason, "invalid");
    const disabled = await checkDhis2Login("https://x", "a", "b", null, reply(200, { username: "a", disabled: true }) as unknown as typeof fetch);
    assert.equal(disabled.ok, false);
    const unlisted = await checkDhis2Login("https://x", "a", "b", ["kofi"], reply(200, { username: "a" }) as unknown as typeof fetch);
    assert.equal(unlisted.ok === false && unlisted.reason, "not-allowed");
    const down = await checkDhis2Login("https://x", "a", "b", null, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    assert.equal(down.ok === false && down.reason, "unreachable");
  });
});
