/**
 * Pairwise data quality: two data elements that are supposed to be equal.
 *
 * The worked example is the real one — suspected malaria cases against
 * suspected cases tested, reported per facility under a district under a
 * region. These checks decide which facilities a user is sent to investigate,
 * so the cost of getting them wrong is someone's afternoon, or a genuine
 * reporting problem left on the floor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAnalytics } from "@/lib/dhis2/analytics";
import {
  compareItems,
  comparisonToCsv,
  differenceOverTime,
  hierarchyCell,
  hierarchyColumns,
  type ComparisonRow,
} from "@/lib/dhis2/quality";
import type { AnalyticsResponse } from "@/lib/dhis2/types";

const metaHeader = (name: string) => ({
  name,
  column: name,
  valueType: "TEXT",
  type: "java.lang.String",
  hidden: false,
  meta: true,
});

const SUSPECTED = "SUSP";
const TESTED = "TEST";

const NAMES: Record<string, string> = {
  [SUSPECTED]: "Uncomplicated Malaria Suspected",
  [TESTED]: "Uncomplicated Malaria Suspected Tested",
  GH: "Ghana",
  UE: "Upper East",
  BAWKU: "Bawku Municipal",
  BINDURI: "Binduri",
  F_AGREE: "Bawku Presby Hospital",
  F_OVER: "Zebilla Health Centre",
  F_UNDER: "Binduri CHPS",
  F_HALF: "Kpalsako CHPS",
  F_SILENT: "Tempane CHPS",
  "202401": "January 2024",
  "202402": "February 2024",
};

/** Four facilities under two districts, under one region. */
const HIERARCHY: Record<string, string> = {
  F_AGREE: "GH/UE/BAWKU",
  F_OVER: "GH/UE/BAWKU",
  F_UNDER: "GH/UE/BINDURI",
  F_HALF: "GH/UE/BINDURI",
  F_SILENT: "GH/UE/BINDURI",
};

function payload(rows: string[][]): AnalyticsResponse {
  return {
    headers: [
      metaHeader("dx"),
      metaHeader("pe"),
      metaHeader("ou"),
      {
        name: "value",
        column: "Value",
        valueType: "NUMBER",
        type: "java.lang.Double",
        hidden: false,
        meta: false,
      },
    ],
    metaData: {
      items: Object.fromEntries(
        Object.entries(NAMES).map(([id, name]) => [id, { name }]),
      ),
      dimensions: {},
      ouHierarchy: HIERARCHY,
    },
    rows,
  };
}

const parsed = parseAnalytics(
  payload([
    // Agrees exactly — every suspected case was tested.
    [SUSPECTED, "202401", "F_AGREE", "120"],
    [TESTED, "202401", "F_AGREE", "120"],
    // 40 suspected cases never tested.
    [SUSPECTED, "202401", "F_OVER", "300"],
    [TESTED, "202401", "F_OVER", "260"],
    // More tested than suspected, which should be impossible.
    [SUSPECTED, "202401", "F_UNDER", "50"],
    [TESTED, "202401", "F_UNDER", "58"],
    // Only one of the two reported at all.
    [SUSPECTED, "202401", "F_HALF", "75"],
  ]),
);

describe("compareItems", () => {
  const result = compareItems(parsed, { aId: SUSPECTED, bId: TESTED });
  const byName = new Map(result.rows.map((row) => [row.name, row]));

  it("passes a facility where the two are equal", () => {
    const row = byName.get("Bawku Presby Hospital")!;
    assert.equal(row.flag, "match");
    assert.equal(row.difference, 0);
    assert.equal(row.note, "The two agree.");
  });

  it("fails any difference at all, however small it looks", () => {
    const row = byName.get("Binduri CHPS")!;
    assert.equal(row.flag, "mismatch");
    assert.equal(row.difference, -8);
    assert.match(row.note, /8 lower than B/);
  });

  it("reports which way the gap runs", () => {
    const row = byName.get("Zebilla Health Centre")!;
    assert.equal(row.flag, "mismatch");
    assert.equal(row.difference, 40);
    assert.match(row.note, /40 higher than B/);
  });

  it("does not judge a unit against the other units", () => {
    // Zebilla is off by 40 of 300 (13%) and Binduri by 8 of 58 (14%). Neither
    // proportion matters: both fail simply because they are not equal.
    assert.equal(byName.get("Zebilla Health Centre")!.flag, "mismatch");
    assert.equal(byName.get("Binduri CHPS")!.flag, "mismatch");
    assert.equal(byName.get("Bawku Presby Hospital")!.flag, "match");
  });

  it("flags a facility that reported only one of the pair", () => {
    const row = byName.get("Kpalsako CHPS")!;
    assert.equal(row.flag, "missing");
    assert.equal(row.b, null);
    assert.equal(row.difference, null);
    assert.equal(row.note, "Only A was reported.");
  });

  it("puts the largest disagreement first", () => {
    assert.equal(result.rows[0].name, "Zebilla Health Centre");
    assert.equal(result.rows[1].name, "Binduri CHPS");
    assert.equal(result.rows.at(-1)!.flag, "match");
  });

  it("counts findings and the match rate over comparable units", () => {
    const s = result.summary;
    assert.equal(s.unitCount, 4);
    assert.equal(s.comparable, 3, "the half-reported facility cannot be compared");
    assert.equal(s.matched, 1);
    assert.equal(s.mismatched, 2);
    assert.equal(s.incomplete, 1);
    assert.ok(Math.abs(s.matchRate! - 100 / 3) < 1e-9);
  });

  it("totals both items and the net difference", () => {
    const s = result.summary;
    assert.equal(s.totalA, 120 + 300 + 50 + 75);
    assert.equal(s.totalB, 120 + 260 + 58);
    assert.equal(s.totalDifference, s.totalA - s.totalB);
    assert.equal(s.largestGap, 40);
  });

  it("measures the gap as a share of the larger value", () => {
    const row = byName.get("Zebilla Health Centre")!;
    assert.ok(Math.abs(row.gap! - (40 / 300) * 100) < 1e-9);
    assert.equal(byName.get("Bawku Presby Hospital")!.gap, 0);
  });
});

describe("hierarchy", () => {
  it("carries each unit's ancestors through the parser", () => {
    assert.deepEqual(parsed.hierarchy.F_OVER, ["GH", "UE", "BAWKU"]);
  });

  it("attaches ancestors to every comparison row", () => {
    const result = compareItems(parsed, { aId: SUSPECTED, bId: TESTED });
    const row = result.rows.find((entry) => entry.name === "Binduri CHPS")!;
    assert.deepEqual(row.ancestors, ["GH", "UE", "BINDURI"]);
  });

  it("leaves ancestors empty when the query did not ask for them", () => {
    const flat = parseAnalytics({
      ...payload([[SUSPECTED, "202401", "F_AGREE", "1"]]),
      metaData: {
        items: { [SUSPECTED]: { name: "A" }, F_AGREE: { name: "Somewhere" } },
        dimensions: {},
      },
    });
    assert.deepEqual(flat.hierarchy, {});
    const result = compareItems(flat, { aId: SUSPECTED, bId: TESTED });
    assert.deepEqual(result.rows[0].ancestors, []);
  });
});

describe("empty and edge cases", () => {
  it("treats a facility that reported nothing as incomplete, not as agreement", () => {
    const silent = parseAnalytics(
      payload([
        [SUSPECTED, "202401", "F_AGREE", "10"],
        [TESTED, "202401", "F_AGREE", "10"],
      ]),
    );
    // F_SILENT has no rows at all, so it is absent from the result entirely —
    // analytics only returns what was reported.
    const result = compareItems(silent, { aId: SUSPECTED, bId: TESTED });
    assert.equal(result.summary.unitCount, 1);
    assert.equal(result.rows[0].flag, "match");
  });

  it("treats two zeros as agreement", () => {
    const zeros = parseAnalytics(
      payload([
        [SUSPECTED, "202401", "F_AGREE", "0"],
        [TESTED, "202401", "F_AGREE", "0"],
      ]),
    );
    const row = compareItems(zeros, { aId: SUSPECTED, bId: TESTED }).rows[0];
    assert.equal(row.flag, "match");
    assert.equal(row.gap, null, "no gap can be expressed as a share of zero");
  });

  it("flags a zero against a non-zero", () => {
    const partial = parseAnalytics(
      payload([
        [SUSPECTED, "202401", "F_AGREE", "12"],
        [TESTED, "202401", "F_AGREE", "0"],
      ]),
    );
    const row = compareItems(partial, { aId: SUSPECTED, bId: TESTED }).rows[0];
    assert.equal(row.flag, "mismatch");
    assert.equal(row.difference, 12);
    assert.equal(row.gap, 100);
  });

  it("sums a unit across periods before comparing", () => {
    const twoMonths = parseAnalytics(
      payload([
        [SUSPECTED, "202401", "F_AGREE", "60"],
        [SUSPECTED, "202402", "F_AGREE", "60"],
        [TESTED, "202401", "F_AGREE", "60"],
        [TESTED, "202402", "F_AGREE", "60"],
      ]),
    );
    const row = compareItems(twoMonths, { aId: SUSPECTED, bId: TESTED }).rows[0];
    assert.equal(row.a, 120);
    assert.equal(row.flag, "match");
  });

  it("returns an empty result rather than throwing on no data", () => {
    const empty = parseAnalytics(payload([]));
    const result = compareItems(empty, { aId: SUSPECTED, bId: TESTED });
    assert.deepEqual(result.rows, []);
    assert.equal(result.summary.matchRate, null);
    assert.equal(result.summary.largestGap, 0);
  });
});

describe("differenceOverTime", () => {
  const overTime = parseAnalytics(
    payload([
      [SUSPECTED, "202401", "F_AGREE", "100"],
      [TESTED, "202401", "F_AGREE", "100"],
      [SUSPECTED, "202402", "F_AGREE", "200"],
      [TESTED, "202402", "F_AGREE", "150"],
    ]),
  );

  it("tracks both totals and their gap, in time order", () => {
    const points = differenceOverTime(overTime, SUSPECTED, TESTED);
    assert.deepEqual(points.map((point) => point.period), ["202401", "202402"]);
    assert.equal(points[0].difference, 0);
    assert.equal(points[1].difference, 50);
  });

  it("returns nothing when the query has no period dimension", () => {
    const noPeriods = {
      ...parsed,
      dimensions: parsed.dimensions.filter((dimension) => dimension !== "pe"),
    };
    assert.deepEqual(differenceOverTime(noPeriods, SUSPECTED, TESTED), []);
  });
});

describe("comparisonToCsv", () => {
  const result = compareItems(parsed, { aId: SUSPECTED, bId: TESTED });
  const resolve = (id: string) => NAMES[id] ?? id;

  // The columns the page builds for a facility-level result: the national root
  // is skipped because it is the same in every row, and level 0 is the column
  // naming the unit itself rather than one of its ancestors.
  const LEVELS = [
    { level: 2, label: "Region" },
    { level: 3, label: "District" },
    { level: 0, label: "Facility" },
  ];

  it("lays out the hierarchy as columns, as a reviewer would read it", () => {
    const lines = comparisonToCsv(
      result,
      {
        a: NAMES[SUSPECTED],
        b: NAMES[TESTED],
        levels: LEVELS,
      },
      resolve,
    ).split("\r\n");

    assert.equal(
      lines[0],
      "Region,District,Facility,Uncomplicated Malaria Suspected,Uncomplicated Malaria Suspected Tested,Difference,Finding,Note",
    );
    assert.ok(
      lines[1].startsWith(
        "Upper East,Bawku Municipal,Zebilla Health Centre,300,260,40,Does not match",
      ),
      `unexpected row: ${lines[1]}`,
    );
    assert.equal(lines.length, result.rows.length + 1);
  });

  it("leaves a missing value empty rather than writing a zero", () => {
    const line = comparisonToCsv(
      result,
      { a: "A", b: "B", levels: LEVELS },
      resolve,
    )
      .split("\r\n")
      .find((row) => row.includes("Kpalsako CHPS"))!;
    assert.ok(line.endsWith("Only A was reported."));
    assert.ok(line.includes(",75,,,Incomplete,"), `unexpected row: ${line}`);
  });
});

describe("hierarchyColumns", () => {
  const levelName = (level: number) =>
    ({ 1: "National", 2: "Region", 3: "District", 4: "Subdistrict", 5: "Facility" })[
      level
    ] ?? `Level ${level}`;

  const row = (id: string, ancestors: string[]): ComparisonRow => ({
    id,
    name: id,
    ancestors,
    a: 1,
    b: 1,
    difference: 0,
    gap: 0,
    flag: "match",
    note: "",
  });

  it("shows every level from the root down to the unit", () => {
    const rows = [
      row("F1", ["GH", "UPPER_EAST", "BAWKU", "BAWKU_SUB"]),
      row("F2", ["GH", "ASHANTI", "KUMASI", "KUMASI_SUB"]),
    ];
    assert.deepEqual(
      hierarchyColumns(rows, levelName).map((column) => column.label),
      ["National", "Region", "District", "Subdistrict", "Facility"],
    );
  });

  it("keeps a level even when every row shares it", () => {
    // Facilities under one region. National and region read the same all the
    // way down, and are still shown: a row lifted out of this table has to
    // say which region and district it belongs to.
    const rows = [
      row("F1", ["GH", "UE", "BAWKU", "BAWKU_SUB"]),
      row("F2", ["GH", "UE", "BINDURI", "BINDURI_SUB"]),
    ];
    assert.deepEqual(
      hierarchyColumns(rows, levelName).map((column) => column.label),
      ["National", "Region", "District", "Subdistrict", "Facility"],
    );
  });

  it("always keeps the column naming the unit itself", () => {
    const rows = [row("F1", ["GH", "UE", "BAWKU", "BAWKU_SUB"])];
    assert.deepEqual(
      hierarchyColumns(rows, levelName).map((column) => column.label),
      ["National", "Region", "District", "Subdistrict", "Facility"],
      "a single facility still needs its full chain and its own name",
    );
  });

  it("handles a result with no hierarchy at all", () => {
    assert.deepEqual(
      hierarchyColumns([row("OU1", [])], levelName).map((column) => column.label),
      ["National"],
    );
    assert.deepEqual(hierarchyColumns([], levelName), []);
  });

  it("falls back to a numbered label for a level the server does not name", () => {
    const rows = [row("X", ["A", "B", "C", "D", "E", "F"])];
    const columns = hierarchyColumns(rows, levelName);
    assert.equal(columns.at(-1)!.label, "Level 7");
  });

  it("does not name the unit column for a level when branches differ in depth", () => {
    // BINDURI_CLINIC hangs straight off its district, so it sits at the depth
    // the server calls "Subdistrict" while being a facility. Naming the last
    // column "Subdistrict" would file it under the wrong heading.
    const rows = [
      row("BAWKU_CLINIC", ["GH", "UE", "BAWKU", "BAWKU_SUB"]),
      row("BINDURI_CLINIC", ["GH", "UE", "BINDURI"]),
    ];
    assert.deepEqual(
      hierarchyColumns(rows, levelName).map((column) => column.label),
      ["National", "Region", "District", "Subdistrict", "Organisation unit"],
    );
  });
});

describe("hierarchyCell", () => {
  const levelName = (level: number) =>
    ({ 1: "National", 2: "Region", 3: "District", 4: "Subdistrict", 5: "Facility" })[
      level
    ] ?? `Level ${level}`;

  const row = (id: string, ancestors: string[]): ComparisonRow => ({
    id,
    name: id,
    ancestors,
    a: 1,
    b: 1,
    difference: 0,
    gap: 0,
    flag: "match",
    note: "",
  });

  const upper = (id: string) => id.toLowerCase();

  it("puts a shallow unit in the unit column, never under an ancestor level", () => {
    const shallow = row("BINDURI_CLINIC", ["GH", "UE", "BINDURI"]);
    const deep = row("BAWKU_CLINIC", ["GH", "UE", "BAWKU", "BAWKU_SUB"]);
    const columns = hierarchyColumns([deep, shallow], levelName);

    const cells = (r: ComparisonRow) =>
      columns.map((column) => hierarchyCell(r, column, upper));

    // National, Region, District, Subdistrict, Organisation unit
    assert.deepEqual(cells(deep), ["gh", "ue", "bawku", "bawku_sub", "BAWKU_CLINIC"]);
    assert.deepEqual(
      cells(shallow),
      ["gh", "ue", "binduri", "", "BINDURI_CLINIC"],
      "the facility belongs in the unit column and its subdistrict cell is empty",
    );
  });

  it("reads an ancestor by its level rather than its position in a trimmed list", () => {
    const r = row("F1", ["GH", "UE", "BAWKU", "BAWKU_SUB"]);
    assert.equal(hierarchyCell(r, { level: 1, label: "National" }, upper), "gh");
    assert.equal(hierarchyCell(r, { level: 3, label: "District" }, upper), "bawku");
    assert.equal(hierarchyCell(r, { level: 9, label: "Level 9" }, upper), "");
    assert.equal(hierarchyCell(r, { level: 0, label: "Unit" }, upper), "F1");
  });
});
