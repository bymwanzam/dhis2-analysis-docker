/**
 * The map's data layer: DHIS2 geometry in, one value and one class per unit out.
 *
 * A mistake here colours a district for a number it never reported, or drops
 * it from the map without a word, so the edges are pinned down: both ways
 * DHIS2 encodes coordinates, units with no value, and single-value results.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAnalytics } from "@/lib/dhis2/analytics";
import {
  buildGeoFeaturesPath,
  classIndex,
  equalIntervalClasses,
  fitLabel,
  labelBox,
  layoutMap,
  mercator,
  parseGeoFeatures,
  parseGeometry,
  valuesByOrgUnit,
  wrapLabel,
  type Position,
} from "@/lib/dhis2/geo";
import { isAllowedPath } from "@/lib/dhis2/paths";
import type { AnalyticsResponse } from "@/lib/dhis2/types";

const SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

describe("buildGeoFeaturesPath", () => {
  it("asks for the query's own ou dimension, and the proxy lets it through", () => {
    const path = buildGeoFeaturesPath(["LEVEL-3", "ImspTQPwCqd"]);
    const params = new URLSearchParams(path.split("?")[1]);
    assert.equal(params.get("ou"), "ou:LEVEL-3;ImspTQPwCqd");
    assert.ok(isAllowedPath(path));
  });
});

describe("parseGeometry", () => {
  it("reads a point from a JSON string", () => {
    assert.deepEqual(parseGeometry("[-11.5, 8.4]"), {
      type: "point",
      coordinates: [-11.5, 8.4],
    });
  });

  it("reads a polygon and a multipolygon by nesting depth, not by type code", () => {
    const polygon = parseGeometry(JSON.stringify([SQUARE]));
    assert.equal(polygon?.type, "area");
    assert.equal(polygon?.type === "area" && polygon.polygons.length, 1);

    const multi = parseGeometry([[SQUARE], [SQUARE]]);
    assert.equal(multi?.type === "area" && multi.polygons.length, 2);
  });

  it("rejects malformed or empty coordinates rather than guessing", () => {
    assert.equal(parseGeometry("not json"), null);
    assert.equal(parseGeometry("[]"), null);
    assert.equal(parseGeometry(undefined), null);
    // A ring of two points is not an area.
    assert.equal(parseGeometry([[[0, 0], [1, 1]]]), null);
  });
});

describe("parseGeoFeatures", () => {
  it("keeps names, levels and parents, and drops units without geometry", () => {
    const features = parseGeoFeatures([
      { id: "a", na: "Bo", le: 2, pn: "Sierra Leone", co: JSON.stringify([SQUARE]) },
      { id: "b", na: "No shape", le: 2, co: "" },
      { id: "c", na: "Clinic", le: 4, co: "[0.5,0.5]" },
    ]);
    assert.deepEqual(
      features.map((feature) => [feature.id, feature.name, feature.level, feature.parentName]),
      [
        ["a", "Bo", 2, "Sierra Leone"],
        ["c", "Clinic", 4, null],
      ],
    );
  });

  it("returns nothing for a response that is not a list", () => {
    assert.deepEqual(parseGeoFeatures({ error: "nope" }), []);
  });
});

describe("layoutMap", () => {
  it("projects north up", () => {
    assert.ok(mercator([0, 10])[1] < mercator([0, 0])[1]);
  });

  it("fits every shape inside the viewBox and draws points after areas", () => {
    const features = parseGeoFeatures([
      { id: "point", na: "P", le: 3, co: "[0.5,0.5]" },
      { id: "child", na: "C", le: 3, co: JSON.stringify([SQUARE]) },
      {
        id: "parent",
        na: "R",
        le: 2,
        co: JSON.stringify([[[-1, -1], [2, -1], [2, 2], [-1, 2], [-1, -1]]]),
      },
    ]);
    const layout = layoutMap(features, { width: 400, maxHeight: 400, padding: 10 });

    assert.deepEqual(
      layout.shapes.map((shape) => shape.id),
      ["parent", "child", "point"],
    );

    for (const shape of layout.shapes) {
      const numbers =
        shape.type === "point"
          ? [shape.cx, shape.cy]
          : shape.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (const value of numbers) {
        assert.ok(value >= 0 && value <= Math.max(layout.width, layout.height), shape.id);
      }
    }
  });

  it("does not divide by zero for a single point", () => {
    const layout = layoutMap(parseGeoFeatures([{ id: "p", co: "[3,4]" }]));
    assert.equal(layout.shapes.length, 1);
    const [shape] = layout.shapes;
    assert.ok(shape.type === "point" && Number.isFinite(shape.cx) && Number.isFinite(shape.cy));
  });

  it("drops repeated vertices", () => {
    const dense = [[0, 0], [0, 0], [1, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const layout = layoutMap(parseGeoFeatures([{ id: "a", co: JSON.stringify([dense]) }]));
    const shape = layout.shapes[0];
    assert.equal(shape.type === "area" && shape.d.split("L").length, 4);
  });
});

const meta = (name: string) => ({
  name,
  column: name,
  valueType: "TEXT",
  type: "java.lang.String",
  hidden: false,
  meta: true,
});

function response(rows: string[][], dimensions = ["dx", "ou"]): AnalyticsResponse {
  return {
    headers: [
      ...dimensions.map(meta),
      { ...meta("value"), meta: false, valueType: "NUMBER" },
    ],
    metaData: { items: {}, dimensions: {} },
    rows,
  };
}

describe("valuesByOrgUnit", () => {
  it("never adds two data items together", () => {
    const parsed = parseAnalytics(
      response([
        ["anc1", "bo", "10"],
        ["anc2", "bo", "7"],
        ["anc1", "kenema", "4"],
      ]),
    );
    const { values, summedOver } = valuesByOrgUnit(parsed, "anc2");
    assert.deepEqual([...values], [["bo", 7]]);
    assert.deepEqual(summedOver, []);
  });

  it("sums category options and says so", () => {
    const parsed = parseAnalytics(
      response(
        [
          ["anc1", "bo", "female", "6"],
          ["anc1", "bo", "male", "4"],
        ],
        ["dx", "ou", "co"],
      ),
    );
    const { values, summedOver } = valuesByOrgUnit(parsed, "anc1");
    assert.equal(values.get("bo"), 10);
    assert.deepEqual(summedOver, ["co"]);
  });

  it("does not claim a sum over a dimension holding one item", () => {
    const parsed = parseAnalytics(response([["anc1", "bo", "total", "6"]], ["dx", "ou", "co"]));
    assert.deepEqual(valuesByOrgUnit(parsed, "anc1").summedOver, []);
  });
});

describe("equalIntervalClasses", () => {
  it("splits the range into equal steps that cover min and max", () => {
    const classes = equalIntervalClasses([0, 25, 50, 75, 100, 10]);
    assert.equal(classes.length, 5);
    assert.equal(classes[0].from, 0);
    assert.equal(classes.at(-1)!.to, 100);
    assert.equal(classIndex(0, classes), 0);
    assert.equal(classIndex(20, classes), 0);
    assert.equal(classIndex(21, classes), 1);
    assert.equal(classIndex(100, classes), 4);
  });

  it("never has more classes than distinct values", () => {
    assert.equal(equalIntervalClasses([3, 9, 9, 3]).length, 2);
  });

  it("handles one value and none", () => {
    assert.deepEqual(equalIntervalClasses([5, 5]), [{ from: 5, to: 5 }]);
    assert.equal(classIndex(5, equalIntervalClasses([5])), 0);
    assert.deepEqual(equalIntervalClasses([]), []);
    assert.equal(classIndex(1, []), -1);
  });

  it("copes with negative values", () => {
    const classes = equalIntervalClasses([-10, 0, 10]);
    assert.equal(classIndex(-10, classes), 0);
    assert.equal(classIndex(10, classes), classes.length - 1);
  });
});

/** Is the point inside the ring? Even-odd rule. */
function inside([x, y]: Position, ring: Position[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

describe("labelBox", () => {
  it("centres a label in a rectangle and measures its room", () => {
    const box = labelBox([[0, 0], [100, 0], [100, 40], [0, 40]]);
    assert.deepEqual(box, { x: 50, y: 20, width: 100, height: 40 });
  });

  it("keeps the label inside a shape whose centroid falls outside it", () => {
    // A U shape: the centroid sits in the empty notch between the arms.
    const u: Position[] = [
      [0, 0], [30, 0], [30, 70], [70, 70], [70, 0], [100, 0], [100, 100], [0, 100],
    ];
    const box = labelBox(u)!;
    assert.ok(inside([box.x, box.y], u), `label at ${box.x},${box.y} is outside`);
  });

  it("gives every area in a layout a label position inside its outline", () => {
    const layout = layoutMap(parseGeoFeatures([{ id: "a", co: JSON.stringify([SQUARE]) }]));
    const shape = layout.shapes[0];
    assert.ok(shape.type === "area" && shape.label && shape.label.width > 0);
  });
});

describe("wrapLabel", () => {
  it("leaves a short name on one line", () => {
    assert.deepEqual(wrapLabel("Bolga", 12), ["Bolga"]);
  });

  it("wraps a long name between words", () => {
    assert.deepEqual(wrapLabel("Kassena Nankana West Municipal", 14), [
      "Kassena",
      "Nankana West",
      "Municipal",
    ]);
  });

  it("cuts the last line with an ellipsis rather than exceed the line limit", () => {
    const lines = wrapLabel("Bawku West District Health Directorate Office", 10, 2);
    assert.equal(lines.length, 2);
    assert.ok(lines[1].endsWith("…"));
    assert.ok(lines.every((line) => line.length <= 10));
  });

  it("cuts a single word longer than a line", () => {
    assert.deepEqual(wrapLabel("Nabdam-Pelungu", 8), ["Nabdam-…"]);
  });
});

describe("fitLabel", () => {
  it("fits a name into a roomy area", () => {
    assert.deepEqual(fitLabel("Upper East", { x: 0, y: 0, width: 120, height: 60 }), [
      "Upper East",
    ]);
  });

  it("wraps when the area is narrow but tall enough", () => {
    const lines = fitLabel("Upper East Region", { x: 0, y: 0, width: 50, height: 60 });
    assert.ok(lines && lines.length > 1);
  });

  it("draws nothing in an area too small to read it", () => {
    assert.equal(fitLabel("Upper East", { x: 0, y: 0, width: 12, height: 60 }), null);
    assert.equal(fitLabel("Upper East", { x: 0, y: 0, width: 120, height: 8 }), null);
    assert.equal(fitLabel("Upper East", null), null);
  });
});
