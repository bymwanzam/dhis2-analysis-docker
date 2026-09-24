/**
 * The data layer, tested against a DHIS2-shaped analytics payload.
 *
 * These are the functions every chart and table is built from, so they are
 * worth pinning down: a wrong sum here is a wrong number on screen, and the
 * shape they parse is fixed by the DHIS2 Web API rather than by this app.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAnalyticsPath,
  buildPivot,
  buildSeries,
  categoryTotals,
  collapsePeriods,
  parseAnalytics,
  percentChange,
  pivotToCsv,
  summarize,
  toCsv,
} from "@/lib/dhis2/analytics";
import { combineSeries } from "@/lib/dhis2/analytics";
import { isAllowedPath } from "@/lib/dhis2/paths";
import { formatCompact, formatPeriod, periodSortKey } from "@/lib/format";
import type { AnalyticsResponse } from "@/lib/dhis2/types";

const metaHeader = (name: string) => ({
  name,
  column: name,
  valueType: "TEXT",
  type: "java.lang.String",
  hidden: false,
  meta: true,
});

/** Two indicators, two months, two regions — with one deliberate gap. */
const RESPONSE: AnalyticsResponse = {
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
    items: {
      IND_ANC: { name: "ANC 1 coverage" },
      IND_BCG: { name: "BCG doses given" },
      OU_NORTH: { name: "Northern Region" },
      OU_SOUTH: { name: "Southern Region" },
      "202401": { name: "January 2024" },
      "202402": { name: "February 2024" },
    },
    dimensions: {},
  },
  rows: [
    ["IND_ANC", "202401", "OU_NORTH", "100"],
    ["IND_ANC", "202401", "OU_SOUTH", "60"],
    ["IND_ANC", "202402", "OU_NORTH", "120"],
    ["IND_ANC", "202402", "OU_SOUTH", "40"],
    ["IND_BCG", "202401", "OU_NORTH", "10"],
    ["IND_BCG", "202402", "OU_NORTH", "20"],
  ],
};

const parsed = parseAnalytics(RESPONSE);

describe("parseAnalytics", () => {
  it("maps meta columns to named dimensions", () => {
    assert.deepEqual(parsed.dimensions, ["dx", "pe", "ou"]);
    assert.equal(parsed.rows.length, 6);
    assert.equal(parsed.rows[0].ou, "OU_NORTH");
  });

  it("coerces values to finite numbers", () => {
    assert.ok(parsed.rows.every((row) => Number.isFinite(row.value)));
    const dirty = parseAnalytics({ ...RESPONSE, rows: [["IND_ANC", "202401", "OU_NORTH", ""]] });
    assert.equal(dirty.rows[0].value, 0);
  });

  it("carries display names for every dimension item", () => {
    assert.equal(parsed.labels.IND_ANC, "ANC 1 coverage");
    assert.equal(parsed.labels.OU_SOUTH, "Southern Region");
  });
});

describe("buildSeries", () => {
  it("puts periods in time order and sums the dimension left over", () => {
    const series = buildSeries(parsed, {
      xDimension: "pe",
      seriesDimension: "dx",
      xOrder: "time",
      formatX: formatPeriod,
    });

    assert.deepEqual(series.data.map((point) => point.__label), ["Jan 2024", "Feb 2024"]);
    // January ANC is 100 north + 60 south.
    assert.equal(series.data[0].IND_ANC, 160);
    assert.equal(series.data[0].IND_BCG, 10);
  });

  it("caps at the palette size and reports the ranked-out tail", () => {
    const many = parseAnalytics({
      ...RESPONSE,
      metaData: {
        items: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`D${index}`, { name: `Item ${index}` }]),
        ),
        dimensions: {},
      },
      rows: Array.from({ length: 10 }, (_, index) => [
        `D${index}`,
        "202401",
        "OU_NORTH",
        String(10 - index),
      ]),
    });

    const series = buildSeries(many, { xDimension: "pe", seriesDimension: "dx" });
    assert.equal(series.series.length, 8);
    assert.deepEqual(
      series.hiddenSeries.map((item) => item.name),
      ["Item 8", "Item 9"],
      "the smallest totals are the ones held back",
    );
  });

  it("leaves a missing combination null so the line breaks instead of dropping to zero", () => {
    const series = buildSeries(parsed, { xDimension: "ou", seriesDimension: "dx" });
    const south = series.data.find((point) => point.__x === "OU_SOUTH")!;
    assert.equal(south.IND_BCG, null);
  });
});

describe("collapsePeriods", () => {
  it("keeps only the latest period", () => {
    const latest = collapsePeriods(parsed, "latest");
    assert.deepEqual(latest.dimensions, ["dx", "ou"]);
    const totals = categoryTotals(latest, "dx");
    assert.equal(totals.find((item) => item.name === "ANC 1 coverage")!.value, 160);
  });

  it("distinguishes a total from an average", () => {
    const sum = categoryTotals(collapsePeriods(parsed, "sum"), "ou");
    const mean = categoryTotals(collapsePeriods(parsed, "mean"), "ou");
    assert.equal(sum.find((item) => item.name === "Northern Region")!.value, 250);
    assert.equal(mean.find((item) => item.name === "Northern Region")!.value, 125);
  });
});

describe("buildPivot", () => {
  it("cross-tabulates with row, column and grand totals", () => {
    const pivot = buildPivot(parsed, {
      rowDimension: "ou",
      columnDimension: "pe",
      columnOrder: "time",
      formatColumn: formatPeriod,
    });

    const north = pivot.rowLabels.indexOf("Northern Region");
    assert.deepEqual(pivot.columnLabels, ["Jan 2024", "Feb 2024"]);
    assert.equal(pivot.cells[north][0], 110);
    assert.equal(pivot.rowTotals[north], 250);
    assert.equal(pivot.grandTotal, 350);
  });

  it("reports an absent combination as null, never as zero", () => {
    const pivot = buildPivot(parsed, { rowDimension: "dx", columnDimension: "ou" });
    const bcg = pivot.rowLabels.indexOf("BCG doses given");
    const south = pivot.columnLabels.indexOf("Southern Region");
    assert.equal(pivot.cells[bcg][south], null);
  });
});

describe("summarize", () => {
  it("finds the latest and previous period and a full trend", () => {
    const [anc] = summarize(parsed, "dx");
    assert.equal(anc.name, "ANC 1 coverage");
    assert.equal(anc.latestPeriod, "202402");
    assert.equal(anc.latest, 160);
    assert.equal(anc.previous, 160);
    assert.equal(anc.trend.length, 2);
  });

  it("refuses to divide by a zero or missing baseline", () => {
    assert.equal(percentChange(10, 0), null);
    assert.equal(percentChange(10, null), null);
    assert.equal(percentChange(150, 100), 50);
    assert.equal(percentChange(50, 100), -50);
  });
});

describe("period handling", () => {
  it("reads every DHIS2 period type", () => {
    assert.equal(formatPeriod("202401"), "Jan 2024");
    assert.equal(formatPeriod("2024Q3"), "Q3 2024");
    assert.equal(formatPeriod("2024W07"), "W07 2024");
    assert.equal(formatPeriod("20240115"), "15 Jan 2024");
    assert.equal(formatPeriod("2024"), "2024");
  });

  it("sorts weeks numerically, which plain string order gets wrong", () => {
    assert.ok(periodSortKey("2024W7") < periodSortKey("2024W12"));
  });
});

describe("buildAnalyticsPath", () => {
  it("carries all three dimensions and the aggregation override", () => {
    const path = buildAnalyticsPath({
      dx: ["IND_ANC", "IND_BCG"],
      pe: ["LAST_12_MONTHS"],
      ou: ["LEVEL-2", "OU_NORTH"],
      aggregationType: "SUM",
    });

    assert.ok(path.startsWith("analytics.json?"));
    assert.ok(path.includes("dimension=dx%3AIND_ANC%3BIND_BCG"));
    assert.ok(path.includes("dimension=ou%3ALEVEL-2%3BOU_NORTH"));
    assert.ok(path.includes("aggregationType=SUM"));
  });

  it("leaves the aggregation alone when it is left as configured", () => {
    const path = buildAnalyticsPath({ dx: ["a"], pe: ["2024"], ou: ["b"], aggregationType: "DEFAULT" });
    assert.ok(!path.includes("aggregationType"));
  });
});

describe("CSV export", () => {
  it("labels periods the way the table does", () => {
    const lines = toCsv(parsed).split("\r\n");
    assert.equal(lines[0], "Data,Period,Organisation unit,Value");
    assert.equal(lines[1], "ANC 1 coverage,Jan 2024,Northern Region,100");
    assert.equal(lines.length, parsed.rows.length + 1);
  });

  it("neutralises a value that a spreadsheet would run as a formula", () => {
    const risky = parseAnalytics({
      ...RESPONSE,
      metaData: { items: { X: { name: "=cmd|calc" } }, dimensions: {} },
      rows: [["X", "202401", "OU_NORTH", "1"]],
    });
    assert.ok(toCsv(risky).includes("'=cmd|calc"));
  });

  it("quotes a name containing a comma", () => {
    const commas = parseAnalytics({
      ...RESPONSE,
      metaData: { items: { X: { name: "Bo, Southern" } }, dimensions: {} },
      rows: [["X", "202401", "OU_NORTH", "1"]],
    });
    assert.ok(toCsv(commas).includes('"Bo, Southern"'));
  });

  it("includes the totals row in a pivot export", () => {
    const csv = pivotToCsv(
      buildPivot(parsed, { rowDimension: "ou", columnDimension: "pe" }),
      "Organisation unit",
    );
    assert.ok(csv.split("\r\n").at(-1)!.startsWith("Total,"));
  });
});

describe("proxy allowlist", () => {
  it("admits the reads this app makes", () => {
    for (const path of [
      "analytics.json?dimension=dx:abc",
      "analytics/rawData.json",
      "me.json",
      "system/info.json",
      "indicators.json?fields=id",
      "dataItems.json?filter=displayName:ilike:anc&order=displayName:asc",
      "organisationUnits/abc123.json",
      "organisationUnitLevels",
      "filledOrganisationUnitLevels.json?fields=id,displayName,level",
      "41/analytics.json",
    ]) {
      assert.ok(isAllowedPath(path), `expected allowed: ${path}`);
    }
  });

  it("refuses writes, user management and anything off the list", () => {
    for (const path of [
      "dataValueSets",
      "dataValues",
      "users.json",
      "users/abc/reset",
      "metadata",
      "maintenance",
      "resourceTables/analytics",
      "tracker/enrollments",
      "dataStore/ns/key",
      "../../etc/passwd",
      "/absolute",
      "",
    ]) {
      assert.ok(!isAllowedPath(path), `expected blocked: ${path}`);
    }
  });
});

describe("number formatting", () => {
  it("keeps small numbers exact and compacts large ones", () => {
    assert.equal(formatCompact(1284), "1,284");
    assert.equal(formatCompact(12900), "12.9K");
    assert.equal(formatCompact(4_200_000), "4.2M");
    assert.equal(formatCompact(null), "–");
  });
});

describe("combineSeries", () => {
  const parsed = {
    dimensions: ["dx", "pe", "ou"],
    rows: [
      { dx: "IND1", pe: "202401", ou: "OU1", value: 10 },
      { dx: "IND1", pe: "202401", ou: "OU2", value: 5 },
      { dx: "IND2", pe: "202401", ou: "OU1", value: 3 },
    ],
    labels: {
      IND1: "ANC 1st visit",
      IND2: "ANC 4th visit",
      OU1: "Bawku",
      OU2: "Binduri",
    },
    hierarchy: {},
    isEmpty: false,
  };

  it("gives every combination its own series rather than summing one away", () => {
    const { parsed: combined, seriesDimension } = combineSeries(parsed, "pe");
    const keys = new Set(combined.rows.map((row) => row[seriesDimension]));
    assert.equal(
      keys.size,
      3,
      "two indicators across two units is three real combinations, not two",
    );
  });

  it("names a combination from both of its parts", () => {
    const { parsed: combined, seriesDimension } = combineSeries(parsed, "pe");
    const first = String(combined.rows[0][seriesDimension]);
    assert.equal(combined.labels[first], "ANC 1st visit - Bawku");
  });

  it("titles the axis with the dimensions it combined", () => {
    assert.equal(combineSeries(parsed, "pe").title, "Data x Organisation unit");
  });

  it("leaves a single dimension alone rather than wrapping it", () => {
    const one = { ...parsed, dimensions: ["dx", "pe"] };
    const { seriesDimension, title } = combineSeries(one, "pe");
    assert.equal(seriesDimension, "dx", "no combining is needed for one dimension");
    assert.equal(title, "Data");
  });

  it("does not add the synthetic key to the dimension list", () => {
    const { parsed: combined } = combineSeries(parsed, "pe");
    assert.deepEqual(
      combined.dimensions,
      ["dx", "pe", "ou"],
      "tables and exports stay as the server described them",
    );
  });
});
