/**
 * Event program tabs: the paths asked of DHIS2 and how its answers are read.
 *
 * The page shows counts of events and a table of what each event recorded,
 * so what is checked is that the counts sum the right way, that both header
 * spellings DHIS2 has used are understood, and that option codes come back
 * as the names a reader expects.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  PROGRAM_TABS,
  buildEventAggregatePath,
  buildEventBreakdownPath,
  buildEventQueryPath,
  buildEventSumPath,
  buildProgramPath,
  catalogFor,
  countEvents,
  findCatalogItem,
  groupItems,
  isBreakableValueType,
  isNumericValueType,
  parseBreakdown,
  qualifiedItemId,
  shortItemName,
  sumOfResponse,
  verificationPairs,
  verificationRows,
  verificationToCsv,
  describeProgramType,
  eventDay,
  eventsToCsv,
  explainEventError,
  findProgramTab,
  isEventScopeRunnable,
  parseEventCounts,
  parseEventPage,
  parseProgram,
} from "../src/lib/dhis2/programs";
import { isAllowedPath } from "../src/lib/dhis2/paths";
import { parseAnalytics } from "../src/lib/dhis2/analytics";

describe("program tabs", () => {
  test("the two programs from the export have a tab each, with their DHIS2 ids", () => {
    assert.deepEqual(
      PROGRAM_TABS.map((tab) => [tab.id, tab.name]),
      [
        ["DQAIauditP1", "DQ-AI Audit Trail"],
        ["GHSRDQAprog", "GHS Routine Data Quality Assessment"],
      ],
    );
  });

  test("slugs are unique and resolve", () => {
    const slugs = new Set(PROGRAM_TABS.map((tab) => tab.slug));
    assert.equal(slugs.size, PROGRAM_TABS.length);
    for (const tab of PROGRAM_TABS) assert.equal(findProgramTab(tab.slug)?.id, tab.id);
    assert.equal(findProgramTab("nope"), undefined);
  });

  test("a rejected request is explained when the reason is a known one", () => {
    assert.match(
      explainEventError(
        "DHIS2 rejected the query (409). DHIS2 said: Query failed, likely because the requested analytics table does not exist (E7131)",
      ) ?? "",
      /Analytics tables/,
    );
    assert.match(
      explainEventError("DHIS2 said: User is not allowed to view program: GHSRDQAprog") ?? "",
      /Sharing settings/,
    );
    assert.equal(explainEventError("The DHIS2 server did not respond in time."), null);
  });

  test("program types read as words", () => {
    assert.equal(describeProgramType("WITHOUT_REGISTRATION"), "Event program");
    assert.equal(describeProgramType("WITH_REGISTRATION"), "Tracker program");
    assert.equal(describeProgramType(""), "Program");
  });
});

describe("paths", () => {
  const scope = { periods: ["LAST_12_MONTHS"], orgUnits: ["USER_ORGUNIT", "LEVEL-2"] };

  test("every path the tab uses passes the proxy allowlist", () => {
    assert.ok(isAllowedPath(buildProgramPath("DQAIauditP1")));
    assert.ok(isAllowedPath(buildEventAggregatePath("DQAIauditP1", scope)));
    assert.ok(
      isAllowedPath(
        buildEventQueryPath("DQAIauditP1", {
          ...scope,
          stage: "stage1",
          dataElements: ["de1"],
          page: 1,
          pageSize: 50,
        }),
      ),
    );
  });

  test("the aggregate counts events, per period and organisation unit", () => {
    const path = buildEventAggregatePath("GHSRDQAprog", { ...scope, stage: "st1" });
    assert.match(path, /^analytics\/events\/aggregate\/GHSRDQAprog\?/);
    assert.ok(path.includes("dimension=pe%3ALAST_12_MONTHS"));
    assert.ok(path.includes("dimension=ou%3AUSER_ORGUNIT%3BLEVEL-2"));
    assert.ok(path.includes("stage=st1"));
    assert.ok(path.includes("outputType=EVENT"));
  });

  test("the query asks for the stage's elements, one page at a time, newest change first", () => {
    const path = buildEventQueryPath("GHSRDQAprog", {
      ...scope,
      stage: "st1",
      dataElements: ["deA", "deB"],
      page: 3,
      pageSize: 50,
    });
    assert.match(path, /^analytics\/events\/query\/GHSRDQAprog\?stage=st1&/);
    assert.ok(path.includes("dimension=deA&dimension=deB"));
    assert.ok(path.includes("page=3&pageSize=50"));
    assert.ok(path.includes("desc=lastupdated"));
    assert.ok(path.includes("totalPages=true"));
  });

  test("a scope needs at least one period and one organisation unit", () => {
    assert.equal(isEventScopeRunnable(scope), true);
    assert.equal(isEventScopeRunnable({ periods: [], orgUnits: ["USER_ORGUNIT"] }), false);
    assert.equal(isEventScopeRunnable({ periods: ["2026"], orgUnits: [] }), false);
  });

  test("the program path asks for stages, their elements and option names", () => {
    const path = decodeURIComponent(buildProgramPath("DQAIauditP1"));
    assert.ok(path.startsWith("programs/DQAIauditP1?fields="));
    assert.ok(path.includes("programStages[id,displayName,sortOrder,programStageDataElements["));
    assert.ok(path.includes("optionSet[options[code,displayName]]"));
  });
});

describe("parseProgram", () => {
  test("orders stages and elements and keeps option names by code", () => {
    const meta = parseProgram({
      id: "P",
      displayName: "Prog",
      programType: "WITHOUT_REGISTRATION",
      lastUpdated: "2026-11-12T16:33:52.409",
      programStages: [
        {
          id: "S2",
          displayName: "Second",
          sortOrder: 2,
        },
        {
          id: "S1",
          displayName: "First",
          sortOrder: 1,
          programStageDataElements: [
            {
              sortOrder: 2,
              dataElement: { id: "B", displayName: "Score", valueType: "INTEGER" },
            },
            {
              sortOrder: 1,
              dataElement: {
                id: "A",
                displayName: "Outcome",
                valueType: "TEXT",
                optionSet: {
                  options: [
                    { code: "P", displayName: "Pass" },
                    { code: "F", displayName: "Fail" },
                  ],
                },
              },
            },
            { sortOrder: 3 },
          ],
        },
      ],
    });
    assert.equal(meta.name, "Prog");
    assert.deepEqual(
      meta.stages.map((stage) => stage.id),
      ["S1", "S2"],
    );
    assert.deepEqual(
      meta.stages[0].dataElements.map((element) => element.id),
      ["A", "B"],
    );
    assert.deepEqual(meta.stages[0].dataElements[0].options, { P: "Pass", F: "Fail" });
    assert.equal(meta.stages[0].dataElements[1].options, undefined);
    assert.deepEqual(meta.stages[1].dataElements, []);
  });
});

describe("countEvents", () => {
  const response = {
    headers: [
      { name: "pe", column: "Period", valueType: "TEXT", type: "java.lang.String", hidden: false, meta: true },
      { name: "ou", column: "Organisation unit", valueType: "TEXT", type: "java.lang.String", hidden: false, meta: true },
      { name: "value", column: "Value", valueType: "NUMBER", type: "java.lang.Double", hidden: false, meta: false },
    ],
    metaData: {
      items: {
        "202601": { name: "January 2026" },
        "202602": { name: "February 2026" },
        ouA: { name: "Ashanti" },
        ouB: { name: "Bono" },
      },
      dimensions: { pe: ["202601", "202602"], ou: ["ouA", "ouB"] },
    },
    rows: [
      ["202602", "ouA", "3"],
      ["202601", "ouA", "2"],
      ["202601", "ouB", "5"],
    ],
  };

  test("sums per period in time order and per unit highest first", () => {
    const counts = countEvents(parseAnalytics(response));
    assert.equal(counts.total, 10);
    assert.deepEqual(
      counts.byPeriod.map((item) => [item.name, item.value]),
      [
        ["January 2026", 7],
        ["February 2026", 3],
      ],
    );
    assert.deepEqual(
      counts.byOrgUnit.map((item) => [item.name, item.value]),
      [
        ["Ashanti", 5],
        ["Bono", 5],
      ],
    );
  });

  test("an empty answer is zero everywhere, not an error", () => {
    const counts = parseEventCounts({ ...response, rows: [] });
    assert.equal(counts.total, 0);
    assert.deepEqual(counts.byPeriod, []);
    assert.deepEqual(counts.byOrgUnit, []);
  });
});

describe("item catalogue", () => {
  test("holds the items of both programs from the Metadata export", () => {
    assert.equal(catalogFor("DQAIauditP1").length, 14);
    assert.equal(catalogFor("GHSRDQAprog").length, 72);
    assert.deepEqual(catalogFor("unknown"), []);
  });

  test("finds an item by id, by program.item id or by code, in any case", () => {
    const byId = findCatalogItem("GHSRDQAprog", "GHSRDQAde71");
    assert.equal(byId?.code, "GHSRDQA_OVERALL_RATING");
    assert.equal(findCatalogItem("GHSRDQAprog", "GHSRDQAprog.GHSRDQAde71"), byId);
    assert.equal(findCatalogItem("GHSRDQAprog", " ghsrdqa_overall_rating "), byId);
    assert.equal(findCatalogItem("GHSRDQAprog", "DQAIaudDE01"), undefined);
    assert.equal(findCatalogItem("GHSRDQAprog", ""), undefined);
    assert.equal(qualifiedItemId("GHSRDQAprog", "GHSRDQAde71"), "GHSRDQAprog.GHSRDQAde71");
  });

  test("names drop the program prefix and items group the way the form is laid out", () => {
    assert.equal(shortItemName({ name: "RDQA VF OPD source count" }), "VF OPD source count");
    assert.equal(shortItemName({ name: "DQAI Event Type" }), "Event Type");
    assert.deepEqual(
      groupItems(catalogFor("GHSRDQAprog")).map((group) => [group.group, group.items.length]),
      [
        ["Visit", 4],
        ["Facility capacity", 6],
        ["Registers", 22],
        ["Verification", 31],
        ["Findings", 9],
      ],
    );
    assert.deepEqual(
      groupItems(catalogFor("DQAIauditP1")).map((group) => [group.group, group.items.length]),
      [
        ["Signal", 6],
        ["People", 3],
        ["Change", 5],
      ],
    );
  });

  test("value types decide what can be counted and what can be totalled", () => {
    assert.ok(isNumericValueType("INTEGER_ZERO_OR_POSITIVE"));
    assert.ok(!isNumericValueType("BOOLEAN"));
    assert.ok(isBreakableValueType("BOOLEAN"));
    assert.ok(isBreakableValueType("TEXT"));
    assert.ok(!isBreakableValueType("LONG_TEXT"));
    assert.ok(!isBreakableValueType("FILE_RESOURCE"));
  });

  test("the RDQA recount pairs are read from the codes, with the indicator named", () => {
    const pairs = verificationPairs(catalogFor("GHSRDQAprog"));
    assert.equal(pairs.length, 10);
    assert.deepEqual(
      pairs.map((pair) => pair.label),
      [
        "OPD",
        "ANC1",
        "ANC4",
        "Skilled deliveries",
        "Penta-3",
        "HIV tested",
        "HIV positive",
        "TB notified",
        "Malaria confirmed",
        "FP new acceptors",
      ],
    );
    assert.ok(pairs.every((pair) => pair.reason));
    assert.equal(pairs[0].source.code, "GHSRDQA_VF_OPD_SOURCE");
    assert.equal(pairs[0].dhis2.code, "GHSRDQA_VF_OPD_DHIS2");
    assert.deepEqual(verificationPairs(catalogFor("DQAIauditP1")), []);
  });
});

describe("item readings", () => {
  const scope = { periods: ["2026Q3"], orgUnits: ["USER_ORGUNIT"], stage: "st1", item: "GHSRDQAde71" };

  test("the breakdown and sum paths are allowed and name the item", () => {
    const breakdown = buildEventBreakdownPath("GHSRDQAprog", scope);
    assert.ok(isAllowedPath(breakdown));
    assert.ok(breakdown.includes("stage=st1&dimension=pe%3A2026Q3&dimension=ou%3AUSER_ORGUNIT&dimension=GHSRDQAde71"));
    const sum = buildEventSumPath("GHSRDQAprog", { ...scope, item: "GHSRDQAde34" });
    assert.ok(isAllowedPath(sum));
    assert.ok(sum.includes("value=GHSRDQAde34&aggregationType=SUM"));
  });

  test("an empty stage is left out, for a program whose definition could not be read", () => {
    const path = buildEventBreakdownPath("GHSRDQAprog", { ...scope, stage: "" });
    assert.ok(!path.includes("stage="));
    const query = buildEventQueryPath("GHSRDQAprog", { ...scope, stage: "", dataElements: ["a"], page: 1, pageSize: 10 });
    assert.ok(!query.includes("stage="));
    assert.ok(isAllowedPath(query));
  });

  const header = (name: string, meta: boolean) => ({
    name, column: name, valueType: "TEXT", type: "java.lang.String", hidden: false, meta,
  });

  test("the breakdown counts events per value, names booleans and options, and keeps blanks apart", () => {
    const response = {
      headers: [header("pe", true), header("ou", true), header("GHSRDQAde73", true), header("value", false)],
      metaData: { items: {}, dimensions: {} },
      rows: [
        ["2026Q3", "ouA", "1", "4"],
        ["2026Q3", "ouB", "1", "2"],
        ["2026Q3", "ouA", "0", "5"],
        ["2026Q3", "ouB", "", "1"],
      ],
    };
    const counts = parseBreakdown(response, { id: "GHSRDQAde73", valueType: "BOOLEAN" });
    assert.deepEqual(
      counts.map((entry) => [entry.id, entry.name, entry.value]),
      [
        ["1", "Yes", 6],
        ["0", "No", 5],
        ["__blank", "Not recorded", 1],
      ],
    );

    const coded = parseBreakdown(
      { ...response, rows: [["2026Q3", "ouA", "G", "3"], ["2026Q3", "ouA", "P", "7"]] },
      { id: "GHSRDQAde73", valueType: "TEXT", options: { G: "Good", P: "Poor" } },
    );
    assert.deepEqual(coded.map((entry) => entry.name), ["Poor", "Good"]);
  });

  test("a sum response adds up, and nothing is null rather than zero", () => {
    const response = {
      headers: [header("pe", true), header("ou", true), header("value", false)],
      metaData: { items: {}, dimensions: {} },
      rows: [["2026Q3", "ouA", "120"], ["2026Q3", "ouB", "30.5"]],
    };
    assert.equal(sumOfResponse(response), 150.5);
    assert.equal(sumOfResponse({ ...response, rows: [] }), null);
  });

  test("verification factors divide the two sums and stay empty without a source count", () => {
    const pairs = verificationPairs(catalogFor("GHSRDQAprog"));
    const opd = pairs.find((pair) => pair.key === "OPD")!;
    const anc1 = pairs.find((pair) => pair.key === "ANC1")!;
    const rows = verificationRows([opd, anc1], {
      [opd.source.id]: 200,
      [opd.dhis2.id]: 190,
      [anc1.source.id]: 0,
      [anc1.dhis2.id]: 12,
    });
    assert.equal(rows[0].factor, 0.95);
    assert.equal(rows[1].factor, null);
    assert.equal(
      verificationToCsv(rows),
      ["Indicator,Source count,DHIS2 value,Verification factor", "OPD,200,190,0.950", "ANC1,0,12,"].join("\r\n"),
    );
  });
});

describe("parseEventPage", () => {
  const elements = [
    { id: "deA", name: "Outcome", valueType: "TEXT", options: { P: "Pass", F: "Fail" } },
    { id: "deB", name: "Score", valueType: "INTEGER" },
  ];

  test("reads the 2.41 header names and resolves option codes", () => {
    const page = parseEventPage(
      {
        headers: [
          { name: "event", column: "Event" },
          { name: "programstage", column: "Program stage" },
          { name: "occurreddate", column: "Event date" },
          { name: "ouname", column: "Organisation unit name" },
          { name: "ou", column: "Organisation unit" },
          { name: "eventstatus", column: "Event status" },
          { name: "deA", column: "Outcome" },
          { name: "deB", column: "Score" },
        ],
        rows: [["ev1", "st1", "2026-11-03 00:00:00.0", "Kumasi", "ouK", "COMPLETED", "P", "17"]],
        metaData: { pager: { page: 2, pageSize: 50, total: 120, pageCount: 3 } },
      },
      elements,
      { page: 1, pageSize: 50 },
    );
    assert.deepEqual(
      page.columns.map((column) => column.name),
      ["Outcome", "Score"],
    );
    assert.equal(page.rows[0].id, "ev1");
    assert.equal(eventDay(page.rows[0].date), "2026-11-03");
    assert.equal(page.rows[0].orgUnit, "Kumasi");
    assert.equal(page.rows[0].status, "COMPLETED");
    assert.deepEqual(page.rows[0].values, { deA: "Pass", deB: "17" });
    assert.deepEqual([page.page, page.pageSize, page.total, page.pageCount], [2, 50, 120, 3]);
  });

  test("reads the older header names and falls back to the unit id's name", () => {
    const page = parseEventPage(
      {
        headers: [
          { name: "psi" },
          { name: "ps" },
          { name: "eventdate" },
          { name: "ou" },
          { name: "deB" },
          { name: "deX", column: "Unlisted" },
        ],
        rows: [["ev9", "st1", "2025-06-30", "ouK", "4", "x"]],
        metaData: { items: { ouK: { name: "Kumasi" } } },
      },
      elements,
      { page: 1, pageSize: 25 },
    );
    assert.equal(page.rows[0].id, "ev9");
    assert.equal(page.rows[0].date, "2025-06-30");
    assert.equal(page.rows[0].orgUnit, "Kumasi");
    assert.equal(page.rows[0].status, "");
    assert.deepEqual(
      page.columns.map((column) => [column.id, column.name]),
      [
        ["deB", "Score"],
        ["deX", "Unlisted"],
      ],
    );
    assert.deepEqual([page.page, page.pageSize, page.total, page.pageCount], [1, 25, null, null]);
  });

  test("the CSV carries the day, the unit, the status and every column", () => {
    const page = parseEventPage(
      {
        headers: [{ name: "event" }, { name: "occurreddate" }, { name: "ouname" }, { name: "deA" }],
        rows: [["e1", "2026-01-02T10:00:00", "Tamale", "F"]],
      },
      elements,
      { page: 1, pageSize: 50 },
    );
    assert.equal(
      eventsToCsv(page),
      ["Event date,Organisation unit,Status,Outcome", "2026-01-02,Tamale,,Fail"].join("\r\n"),
    );
  });
});
