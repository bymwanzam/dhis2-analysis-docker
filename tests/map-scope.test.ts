/**
 * The Maps page's scope: which units it asks for, how it drills, and how it
 * colours each data type.
 *
 * A mistake here shows the wrong districts, lets a drill fall through to the
 * facility level, or files a 120% coverage under "80–100%" — so each rule the
 * page promises on screen is pinned down.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAnalyticsPath, rowsToCsv } from "@/lib/dhis2/analytics";
import { classIndex } from "@/lib/dhis2/geo";
import {
  COVERAGE_CLASSES,
  MAX_MAP_LEVEL,
  availableLevels,
  buildMapUnitsPath,
  drillDown,
  drillUp,
  focusCrumb,
  hasBoundary,
  hierarchyPath,
  mapClassesFor,
  mapOuDimension,
  parseMapUnits,
  setLevel,
  toMapGeoJson,
  type MapScope,
  type MapUnit,
} from "@/lib/dhis2/map-scope";
import { isAllowedPath } from "@/lib/dhis2/paths";

const GHANA = { id: "GH", name: "Ghana", level: 1 };
const UPPER_EAST = { id: "UE", name: "Upper East", level: 2 };
const BAWKU = { id: "BW", name: "Bawku West", level: 3 };

function unit(ref: { id: string; name: string; level: number }, ancestors = [GHANA]): MapUnit {
  return { ...ref, ancestors, geometry: { type: "area", polygons: [] } };
}

describe("map requests", () => {
  it("asks for a level inside its parent, through the proxy allowlist", () => {
    const scope: MapScope = { level: 3, path: [GHANA, UPPER_EAST] };
    const path = buildMapUnitsPath(scope);
    const params = new URLSearchParams(path.split("?")[1]);
    assert.deepEqual(params.getAll("filter"), ["level:eq:3", "path:like:UE"]);
    assert.ok(params.get("fields")!.includes("geometry"));
    assert.ok(params.get("fields")!.includes("ancestors"));
    assert.ok(isAllowedPath(path));
    assert.deepEqual(mapOuDimension(scope), ["LEVEL-3", "UE"]);
  });

  it("shows the root itself at the root's level", () => {
    const scope: MapScope = { level: 1, path: [GHANA] };
    assert.deepEqual(mapOuDimension(scope), ["GH"]);
    const params = new URLSearchParams(buildMapUnitsPath(scope).split("?")[1]);
    assert.deepEqual(params.getAll("filter"), ["id:eq:GH"]);
  });

  it("lets DHIS2 aggregate periods by sending them as a filter", () => {
    const path = buildAnalyticsPath({
      dx: ["COV"],
      pe: ["LAST_12_MONTHS"],
      ou: ["LEVEL-2", "GH"],
      periodsAsFilter: true,
    });
    const params = new URLSearchParams(path.split("?")[1]);
    assert.deepEqual(params.getAll("filter"), ["pe:LAST_12_MONTHS"]);
    assert.ok(!params.getAll("dimension").some((value) => value.startsWith("pe:")));
  });
});

describe("parseMapUnits", () => {
  it("orders ancestors root first and tells boundaries from points and nothing", () => {
    const units = parseMapUnits({
      organisationUnits: [
        {
          id: "ZB",
          displayName: "Zebilla",
          level: 4,
          ancestors: [
            { id: "BW", displayName: "Bawku West", level: 3 },
            { id: "GH", displayName: "Ghana", level: 1 },
            { id: "UE", displayName: "Upper East", level: 2 },
          ],
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        },
        {
          id: "BK",
          displayName: "Binaba",
          level: 4,
          ancestors: [],
          geometry: { type: "Point", coordinates: [0.5, 0.5] },
        },
        { id: "AP", displayName: "Apodabogo", level: 4, ancestors: [] },
      ],
    });

    const byId = new Map(units.map((entry) => [entry.id, entry]));
    assert.equal(hierarchyPath(byId.get("ZB")!), "Ghana > Upper East > Bawku West > Zebilla");
    assert.equal(hasBoundary(byId.get("ZB")!), true);
    assert.equal(hasBoundary(byId.get("BK")!), false);
    assert.equal(byId.get("AP")!.geometry, null);
  });

  it("returns nothing for an unexpected payload", () => {
    assert.deepEqual(parseMapUnits(null), []);
    assert.deepEqual(parseMapUnits({ organisationUnits: "no" }), []);
  });
});

describe("map GeoJSON export", () => {
  it("keeps geometries and attaches the displayed unit values", () => {
    const units = parseMapUnits({
      organisationUnits: [
        {
          id: "ZB",
          displayName: "Zebilla",
          level: 4,
          ancestors: [{ id: "GH", displayName: "Ghana", level: 1 }],
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        },
        { id: "AP", displayName: "Apodabogo", level: 4, ancestors: [] },
      ],
    });

    const exported = toMapGeoJson(units, new Map([["ZB", 42]]), {
      name: "Malaria cases",
      dataType: "count",
      dataTypeName: "Counts",
      dataItemId: "DX1",
      dataItem: "Malaria cases",
      periods: ["202601"],
      periodLabel: "January 2026",
      organisationUnitLevel: "Sub-district",
      parentOrganisationUnit: "Bawku West",
    });

    assert.equal(exported.type, "FeatureCollection");
    assert.equal(exported.features.length, 1);
    assert.deepEqual(exported.features[0].geometry, {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
    });
    assert.deepEqual(exported.features[0].properties, {
      id: "ZB",
      name: "Zebilla",
      level: 4,
      parentName: "Ghana",
      hierarchy: "Ghana > Zebilla",
      value: 42,
    });
    assert.equal(exported.metadata.dataItemId, "DX1");
    assert.deepEqual(exported.metadata.periods, ["202601"]);
  });

  it("exports null when a mapped unit has no analytics value", () => {
    const mappedUnit = unit({ id: "UE", name: "Upper East", level: 2 });
    const exported = toMapGeoJson([mappedUnit], new Map(), {
      name: "Coverage",
      dataType: "coverage",
      dataTypeName: "Coverages",
      dataItemId: "DX1",
      dataItem: "Coverage",
      periods: ["202601"],
      periodLabel: "January 2026",
      organisationUnitLevel: "Region",
      parentOrganisationUnit: null,
    });

    assert.equal(exported.features[0].properties.value, null);
  });
});

describe("drilling", () => {
  it("drills from the national map to the regions", () => {
    const next = drillDown({ level: 1, path: [GHANA] }, unit(GHANA, []));
    assert.deepEqual(next, { level: 2, path: [GHANA] });
  });

  it("drills from a region to its districts and from a district to its sub-districts", () => {
    const districts = drillDown({ level: 2, path: [GHANA] }, unit(UPPER_EAST));
    assert.deepEqual(districts, { level: 3, path: [GHANA, UPPER_EAST] });

    const subDistricts = drillDown(districts!, unit(BAWKU, [GHANA, UPPER_EAST]));
    assert.deepEqual(subDistricts, { level: 4, path: [GHANA, UPPER_EAST, BAWKU] });
  });

  it("stops at level 4 — facilities are never a map level", () => {
    const zebilla = unit({ id: "ZB", name: "Zebilla", level: 4 }, [GHANA, UPPER_EAST, BAWKU]);
    assert.equal(drillDown({ level: 4, path: [GHANA, UPPER_EAST, BAWKU] }, zebilla), null);
    assert.equal(MAX_MAP_LEVEL, 4);
    assert.deepEqual(availableLevels(1, 5), [1, 2, 3, 4]);
    assert.equal(setLevel({ level: 2, path: [GHANA] }, 5).level, 4);
  });

  it("drills back up one level at a time, and not past the root", () => {
    let scope: MapScope | null = { level: 4, path: [GHANA, UPPER_EAST, BAWKU] };
    scope = drillUp(scope);
    assert.deepEqual(scope, { level: 3, path: [GHANA, UPPER_EAST] });
    scope = drillUp(scope!);
    assert.deepEqual(scope, { level: 2, path: [GHANA] });
    scope = drillUp(scope!);
    assert.deepEqual(scope, { level: 1, path: [GHANA] });
    assert.equal(drillUp(scope!), null);
  });

  it("keeps a restricted user inside their own root", () => {
    const scope: MapScope = { level: 3, path: [UPPER_EAST] };
    assert.deepEqual(availableLevels(2), [2, 3, 4]);
    const next = drillDown(scope, unit(BAWKU, [GHANA, UPPER_EAST]));
    assert.deepEqual(next, { level: 4, path: [UPPER_EAST, BAWKU] });
    assert.deepEqual(drillUp({ level: 2, path: [UPPER_EAST] }), null);
  });

  it("jumps to a breadcrumb and trims the path when the level is raised", () => {
    const scope: MapScope = { level: 4, path: [GHANA, UPPER_EAST, BAWKU] };
    assert.deepEqual(focusCrumb(scope, 0), { level: 2, path: [GHANA] });
    assert.deepEqual(setLevel(scope, 3), { level: 3, path: [GHANA, UPPER_EAST] });
  });
});

describe("colour per data type", () => {
  it("puts coverage on a fixed scale with its own class above 100%", () => {
    assert.equal(mapClassesFor("coverage", [3, 4]), COVERAGE_CLASSES);
    assert.equal(classIndex(95, COVERAGE_CLASSES), 4);
    assert.equal(classIndex(100, COVERAGE_CLASSES), 4);
    assert.equal(classIndex(100.1, COVERAGE_CLASSES), 5);
    assert.equal(classIndex(250, COVERAGE_CLASSES), 5);
  });

  it("scales counts and indicators to the values on the map", () => {
    const classes = mapClassesFor("count", [0, 500, 1000]);
    assert.equal(classes[0].from, 0);
    assert.equal(classes.at(-1)!.to, 1000);
  });
});

describe("rowsToCsv", () => {
  it("quotes and guards cells like every other export", () => {
    assert.equal(
      rowsToCsv(["Unit", "Value"], [["Bawku, West", "=1"]]),
      'Unit,Value\r\n"Bawku, West",\'=1',
    );
  });
});
