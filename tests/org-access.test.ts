/**
 * Starting the organisation unit tree where the account may read data, and
 * explaining the refusal when a query reaches outside it.
 *
 * A district officer's account can browse the whole hierarchy but analyse
 * only its own district; a tree that started at the country offered a unit
 * every query on would fail.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { chooseOrgUnitRoots } from "../src/lib/dhis2/client";
import { describeRejection } from "../src/lib/dhis2/server";

const unit = (id: string, path: string, level: number, displayName = id) => ({ id, path, level, displayName });

describe("chooseOrgUnitRoots", () => {
  test("data view units win over data capture units", () => {
    const roots = chooseOrgUnitRoots([unit("dist", "/gh/ash/dist", 3)], [unit("fac", "/gh/ash/dist/fac", 5)]);
    assert.deepEqual(roots?.map((root) => root.id), ["dist"]);
  });

  test("capture units are used when no data view units are set", () => {
    const roots = chooseOrgUnitRoots([], [unit("fac", "/gh/ash/dist/fac", 5)]);
    assert.deepEqual(roots?.map((root) => root.id), ["fac"]);
  });

  test("no units at all means the caller falls back to level 1", () => {
    assert.equal(chooseOrgUnitRoots(undefined, undefined), null);
    assert.equal(chooseOrgUnitRoots([], []), null);
  });

  test("a unit inside another assigned unit is not listed twice; higher levels first", () => {
    const roots = chooseOrgUnitRoots(
      [unit("b", "/gh/ash/b", 3, "Bosomtwe"), unit("fac", "/gh/ash/b/fac", 5), unit("a", "/gh/ash/a", 3, "Asante Akim")],
      undefined,
    );
    assert.deepEqual(roots?.map((root) => root.id), ["a", "b"]);
  });
});

describe("describeRejection", () => {
  test("a unit outside the account's data view is explained with what to do", () => {
    const message = describeRejection(409, "User: `Mohammedbabayahaya` is not allowed to view org unit: `RnDSNvg7zR2`");
    assert.match(message, /only read data for the organisation units it is assigned/);
    assert.match(message, /\(RnDSNvg7zR2\)/);
    assert.match(message, /data view \(analysis\) organisation units/);
  });

  test("other refusals keep their usual wording", () => {
    assert.match(describeRejection(409, "Query exceeds the max limit"), /^DHIS2 rejected the query \(409\)/);
    assert.match(describeRejection(401, undefined), /rejected the token/);
  });
});
