/**
 * Site accounts managed in the app: the rules that keep one working
 * administrator, the account file that survives redeploys, and the live
 * check that ends a session the moment its account changes.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { liveFrom } from "../src/lib/auth/state";
import { readStoredUsers, storePath, updateStoredUsers, writeStoredUsers } from "../src/lib/auth/store";
import {
  activeAdmins,
  changeProblem,
  generatePassword,
  mergeUsers,
  parseStore,
  validatePassword,
  validateUsername,
  type StoredUser,
} from "../src/lib/auth/users";

const stored = (name: string, role: "admin" | "user" = "user", extra: Partial<StoredUser> = {}): StoredUser => ({
  name,
  displayName: name,
  role,
  hash: "scrypt$16384$c2FsdHNhbHRzYWx0$aGFzaA",
  disabled: false,
  mustChange: false,
  version: 1,
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  ...extra,
});

describe("accounts from two places", () => {
  test("server-setting accounts are administrators; the account file wins on the same name", () => {
    const users = mergeUsers(
      [
        { name: "admin", hash: "scrypt$env-admin" },
        { name: "boss", hash: "scrypt$env-boss" },
      ],
      [stored("Admin", "admin", { hash: "scrypt$file-admin", version: 4 }), stored("ama")],
    );
    assert.deepEqual(
      users.map((user) => [user.name, user.role, user.source, user.hash]),
      [
        ["Admin", "admin", "site", "scrypt$file-admin"],
        ["ama", "user", "site", "scrypt$16384$c2FsdHNhbHRzYWx0$aGFzaA"],
        ["boss", "admin", "server", "scrypt$env-boss"],
      ],
    );
  });
});

describe("rules", () => {
  test("usernames and passwords", () => {
    assert.equal(validateUsername("ama.owusu", []), null);
    assert.match(validateUsername("ama owusu", []) ?? "", /no spaces/);
    assert.match(validateUsername("ab", []) ?? "", /3 to 40/);
    assert.match(validateUsername("AMA", [stored("ama")]) ?? "", /already an account/);
    assert.equal(validatePassword("a long secret 1", "ama"), null);
    assert.match(validatePassword("short", "ama") ?? "", /10 characters/);
    assert.match(validatePassword("ama-password-123", "ama") ?? "", /username/);
    assert.match(validatePassword("aaaaaaaaaaaa", "kofi") ?? "", /repeated/);
  });

  test("generated passwords are long, varied and free of look-alike characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword();
      assert.match(password, /^[A-HJ-NP-Za-km-z2-9]{6}-[A-HJ-NP-Za-km-z2-9]{6}-[A-HJ-NP-Za-km-z2-9]{6}$/);
      seen.add(password);
    }
    assert.equal(seen.size, 50);
  });

  test("the site always keeps one working administrator, and nobody locks themselves out", () => {
    const users = mergeUsers([], [stored("admin", "admin"), stored("ama"), stored("yaw", "admin", { disabled: true })]);
    const admin = users.find((user) => user.name === "admin")!;
    const ama = users.find((user) => user.name === "ama")!;
    assert.equal(activeAdmins(users), 1);
    assert.match(changeProblem(users, "admin", admin, { kind: "role", role: "user" }) ?? "", /your own administrator access/);
    assert.match(changeProblem(users, "admin", admin, { kind: "reset-password" }) ?? "", /My account/);
    assert.match(changeProblem(users, "someone-else", admin, { kind: "disabled", disabled: true }) ?? "", /last administrator/);
    assert.match(changeProblem(users, "someone-else", admin, { kind: "delete" }) ?? "", /last administrator/);
    assert.equal(changeProblem(users, "admin", ama, { kind: "role", role: "admin" }), null);
    assert.equal(changeProblem(users, "admin", ama, { kind: "delete" }), null);

    const two = mergeUsers([], [stored("admin", "admin"), stored("kofi", "admin")]);
    assert.equal(changeProblem(two, "admin", two.find((user) => user.name === "kofi")!, { kind: "disabled", disabled: true }), null);
  });

  test("a server-setting account cannot be deleted in the app, only disabled", () => {
    const users = mergeUsers([{ name: "boss", hash: "scrypt$x" }], [stored("admin", "admin")]);
    const boss = users.find((user) => user.name === "boss")!;
    assert.match(changeProblem(users, "admin", boss, { kind: "delete" }) ?? "", /AUTH_USERS/);
    assert.equal(changeProblem(users, "admin", boss, { kind: "disabled", disabled: true }), null);
  });
});

describe("the account file", () => {
  test("lives in the hosting home by default, outside the app folder", () => {
    assert.match(storePath({}), /dhis2-analysis-data[\\/]users\.json$/);
    assert.equal(storePath({ AUTH_STORE: "/srv/users.json" }), "/srv/users.json");
  });

  test("is written whole, read back, and changed through one path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dq-users-"));
    const path = join(dir, "nested", "users.json");
    assert.deepEqual(readStoredUsers(path), []);
    const hash = await hashPassword("first password 1", 1024);
    writeStoredUsers([stored("ama", "user", { hash })], path);
    const back = readStoredUsers(path);
    assert.equal(back[0].name, "ama");
    assert.equal(await verifyPassword("first password 1", back[0].hash), true);
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);

    const refused = updateStoredUsers(() => "nope", path);
    assert.equal(refused, "nope");
    const updated = updateStoredUsers((users) => [...users, stored("kofi", "admin")], path);
    assert.ok(Array.isArray(updated));
    assert.deepEqual(readStoredUsers(path).map((user) => user.name), ["ama", "kofi"]);
    assert.ok(readFileSync(path, "utf8").includes('"format": "dhis2-analysis/users"'));
  });

  test("a broken file is an error, and malformed entries are left out", () => {
    const dir = mkdtempSync(join(tmpdir(), "dq-users-"));
    const path = join(dir, "users.json");
    writeFileSync(path, "{not json");
    assert.throws(() => readStoredUsers(path), /not valid JSON/);
    const users = parseStore(JSON.stringify({ users: [stored("ama"), { name: "bad name!", hash: "scrypt$x" }, { name: "nohash" }, stored("AMA")] }));
    assert.deepEqual(users.map((user) => user.name), ["ama"]);
  });
});

describe("live sessions", () => {
  const base = { sub: "ama", name: "Ama", via: "local" as const, iat: 1, exp: 9_999_999_999, ver: 2 };

  test("a session ends when its account is disabled, deleted, or its password changes", () => {
    const users = mergeUsers([], [stored("ama", "user", { version: 2, displayName: "Ama Owusu" })]);
    assert.deepEqual(liveFrom(base, users, []), { ...base, name: "Ama Owusu", role: "user", mustChange: false });
    assert.equal(liveFrom({ ...base, ver: 1 }, users, []), null);
    assert.equal(liveFrom(base, mergeUsers([], [stored("ama", "user", { version: 2, disabled: true })]), []), null);
    assert.equal(liveFrom(base, [], []), null);
  });

  test("role and a pending password change are read live; DHIS2 sign-ins are admins only when listed", () => {
    const users = mergeUsers([], [stored("ama", "admin", { version: 2, mustChange: true })]);
    const live = liveFrom(base, users, []);
    assert.equal(live?.role, "admin");
    assert.equal(live?.mustChange, true);
    const dhis2 = { sub: "Kofi", name: "Kofi", via: "dhis2" as const, iat: 1, exp: 9_999_999_999 };
    assert.equal(liveFrom(dhis2, [], [])?.role, "user");
    assert.equal(liveFrom(dhis2, [], ["kofi"])?.role, "admin");
  });

  test("an AUTH_USERS account keeps working until it is changed in the app", () => {
    const users = mergeUsers([{ name: "admin", hash: "scrypt$x" }], []);
    assert.equal(liveFrom({ ...base, sub: "admin", ver: undefined }, users, [])?.role, "admin");
  });
});
