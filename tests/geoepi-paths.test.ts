import assert from "node:assert/strict";
import test from "node:test";
import { isGeoEpiPathAllowed } from "../src/lib/geoepi/paths";

test("serves the viewer and its static files", () => {
  for (const path of [
    "index.html",
    "lib.js",
    "export.js",
    "vendor/leaflet.js",
    "vendor/leaflet.css",
    "vendor/images/layers-2x.png",
  ]) {
    assert.equal(isGeoEpiPathAllowed("GET", path), true, path);
  }
});

test("reads notebooks, datasets, jobs and results", () => {
  for (const path of [
    "api/notebooks",
    "api/datasets",
    "api/jobs",
    "api/jobs/abc123",
    "api/jobs/abc123/log",
    "api/jobs/abc123/download.zip",
    "results/abc123/layers.json",
    "results/abc123/maps/district.geojson",
  ]) {
    assert.equal(isGeoEpiPathAllowed("GET", path), true, path);
  }
});

test("allows only the upload and run POSTs", () => {
  for (const path of [
    "api/datasets",
    "api/datasets/files",
    "api/datasets/from-job",
    "api/datasets/dhis2-map",
    "api/jobs",
  ]) {
    assert.equal(isGeoEpiPathAllowed("POST", path), true, path);
  }
  assert.equal(isGeoEpiPathAllowed("POST", "api/jobs/abc123"), false);
  assert.equal(isGeoEpiPathAllowed("POST", "results/abc123/x"), false);
  assert.equal(isGeoEpiPathAllowed("POST", "index.html"), false);
});

test("refuses other methods outright", () => {
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    assert.equal(isGeoEpiPathAllowed(method, "api/jobs"), false, method);
    assert.equal(isGeoEpiPathAllowed(method, "api/datasets"), false, method);
  }
});

test("refuses traversal and anything off the list", () => {
  for (const path of [
    "",
    "docs",
    "openapi.json",
    "results/abc123/../../job.json",
    "results/../jobs/abc/job.json",
    "vendor/../main.py",
    "vendor/images/../../x",
    "api/jobs/abc123/executed.ipynb",
    "api/jobs/a.b",
  ]) {
    assert.equal(isGeoEpiPathAllowed("GET", path), false, path);
  }
});
