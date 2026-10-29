import assert from "node:assert/strict";
import test from "node:test";
import { geoEpiLaunch } from "../src/lib/geoepi/launch";

test("passes on the notebook and dataset the Maps page links with", () => {
  assert.equal(
    geoEpiLaunch({ notebook: "dhis2_map_explorer", dataset: "dhis2_abc" }),
    "notebook=dhis2_map_explorer&dataset=dhis2_abc",
  );
});

test("the page fixes the track; the URL cannot change it", () => {
  assert.equal(geoEpiLaunch({ track: "other" }, "measles"), "track=measles");
  assert.equal(geoEpiLaunch({ track: "measles" }), "");
});

test("drops anything else, repeated values and empty values", () => {
  assert.equal(geoEpiLaunch({ notebook: ["a", "b"], dataset: "", theme: "dark" }), "");
});
