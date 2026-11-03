import assert from "node:assert/strict";
import test from "node:test";
import { holisticCookie, isHolisticPathAllowed } from "../src/lib/holistic/paths";

test("serves the built frontend and its icons", () => {
  for (const path of [
    "index.html",
    "assets/index-CjSyk_m6.js",
    "assets/index-CtSAs7B6.css",
    "assets/roboto-latin-400-normal-BqEyEoaF.woff2",
    "favicon.ico",
    "icon.svg",
    "android-chrome-192x192.png",
  ]) {
    assert.equal(isHolisticPathAllowed("GET", path), true, path);
  }
});

test("reads the session and the store", () => {
  for (const path of [
    "auth/session",
    "api/store",
    "api/store/periods",
    "api/store/assessment.2025.R1aaaaaaaaa",
  ]) {
    assert.equal(isHolisticPathAllowed("GET", path), true, path);
  }
});

test("passes only the module's DHIS2 reads, and only as GET", () => {
  for (const path of [
    "dhis2/api/41/me",
    "dhis2/api/me.json",
    "dhis2/api/41/organisationUnits/R1aaaaaaaaa",
    "dhis2/api/41/analytics",
    "dhis2/api/indicators",
    "dhis2/api/system/info",
  ]) {
    assert.equal(isHolisticPathAllowed("GET", path), true, path);
  }
  for (const path of [
    "dhis2/api/41/dataValueSets",
    "dhis2/api/dataStore/ghs-holistic-assessment/x",
    "dhis2/api/41/metadata",
    "dhis2/api/41/userCredentials",
    "dhis2/api/meta",
  ]) {
    assert.equal(isHolisticPathAllowed("GET", path), false, path);
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    assert.equal(isHolisticPathAllowed(method, "dhis2/api/41/me"), false, method);
    assert.equal(isHolisticPathAllowed(method, "dhis2/api/41/analytics"), false, method);
  }
});

test("signs in only through the connection handover, never with a typed token", () => {
  assert.equal(isHolisticPathAllowed("POST", "auth/connect"), true);
  assert.equal(isHolisticPathAllowed("POST", "auth/logout"), true);
  assert.equal(isHolisticPathAllowed("POST", "auth/login"), false);
  assert.equal(isHolisticPathAllowed("GET", "auth/login"), false);
  assert.equal(isHolisticPathAllowed("GET", "auth/connect"), false);
});

test("writes and deletes single store keys, and nothing else", () => {
  assert.equal(isHolisticPathAllowed("PUT", "api/store/periods"), true);
  assert.equal(isHolisticPathAllowed("DELETE", "api/store/periods"), true);
  for (const method of ["PUT", "DELETE", "POST"]) {
    assert.equal(isHolisticPathAllowed(method, "api/store"), false, method);
  }
  assert.equal(isHolisticPathAllowed("PUT", "index.html"), false);
  assert.equal(isHolisticPathAllowed("PATCH", "api/store/periods"), false);
});

test("refuses traversal and anything off the list", () => {
  for (const path of [
    "",
    "healthz",
    "auth/config",
    "server/app.js",
    "assets/../server/config.js",
    "api/store/../store",
    "api/store/a/b",
    "dhis2/api/41/me/../../dataValueSets",
    "dhis2/api//me",
    "./index.html",
    "src/main.jsx",
  ]) {
    assert.equal(isHolisticPathAllowed("GET", path), false, path);
  }
});

test("forwards only the module's session cookie", () => {
  assert.equal(
    holisticCookie("dhis2_conn=SECRET; ghsha_sid=abc_DEF-123; theme=dark"),
    "ghsha_sid=abc_DEF-123",
  );
  assert.equal(holisticCookie("dhis2_conn=SECRET"), null);
  assert.equal(holisticCookie(null), null);
  assert.equal(holisticCookie("xghsha_sid=1"), null);
});
