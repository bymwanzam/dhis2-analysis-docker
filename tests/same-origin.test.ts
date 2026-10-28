import assert from "node:assert/strict";
import test from "node:test";
import { hasSameOrigin } from "../src/lib/same-origin";

test("accepts the browser origin when the app URL uses an internal host", () => {
  const request = new Request("http://dhis2-analysis:3000/geoepi/api/datasets/dhis2-map", {
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
  });

  assert.equal(hasSameOrigin(request), true);
});

test("rejects a different browser origin", () => {
  const request = new Request("http://dhis2-analysis:3000/geoepi/api/datasets/dhis2-map", {
    headers: {
      host: "localhost:3000",
      origin: "http://attacker.example",
    },
  });

  assert.equal(hasSameOrigin(request), false);
});

test("rejects a different protocol", () => {
  const request = new Request("http://localhost:3000/geoepi/api/datasets/dhis2-map", {
    headers: {
      host: "localhost:3000",
      origin: "https://localhost:3000",
    },
  });

  assert.equal(hasSameOrigin(request), false);
});
