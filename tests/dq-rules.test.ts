/**
 * The data quality rules decide which units a reviewer is sent to follow
 * up, so the arithmetic, the operators and the missing-value strategies are
 * tested to the edge, and the report must say only what the numbers show.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildReport,
  checkCell,
  compare,
  describeExpression,
  describeRule,
  evaluateExpression,
  exportRules,
  failureGrid,
  healthOf,
  importRules,
  newRule,
  ruleProblem,
  rulesItems,
  runRules,
  ruleSummaryToCsv,
  valueLookup,
  violationsToCsv,
  type DqRule,
  type Expression,
  type Term,
} from "../src/lib/dhis2/dq-rules";
import { parseAnalytics } from "../src/lib/dhis2/analytics";

const item = (id: string, name = id): Term["operand"] => ({ kind: "item", item: { id, displayName: name } });
const num = (value: number): Term["operand"] => ({ kind: "const", value });
const expr = (...parts: (Term["operand"] | Term["op"])[]): Expression => {
  const terms: Term[] = [];
  let op: Term["op"] = "+";
  for (const part of parts) {
    if (typeof part === "string") op = part;
    else {
      terms.push({ op, operand: part });
      op = "+";
    }
  }
  return { terms };
};
const values = (map: Record<string, number>) => (id: string) => map[id];

describe("evaluateExpression", () => {
  test("adds, subtracts, multiplies and divides, with × and ÷ before + and −", () => {
    const v = values({ A: 10, B: 4, C: 3 });
    assert.equal(evaluateExpression(expr(item("A"), "+", item("B")), v).value, 14);
    assert.equal(evaluateExpression(expr(item("A"), "-", item("B")), v).value, 6);
    assert.equal(evaluateExpression(expr(item("A"), "*", item("B")), v).value, 40);
    assert.equal(evaluateExpression(expr(item("A"), "/", item("B")), v).value, 2.5);
    assert.equal(evaluateExpression(expr(item("A"), "+", item("B"), "*", item("C")), v).value, 22);
    assert.equal(evaluateExpression(expr(item("A"), "-", item("B"), "*", num(2), "+", item("C")), v).value, 5);
    assert.equal(evaluateExpression(expr(item("A"), "*", num(100), "/", item("B")), v).value, 250);
  });

  test("reports missing items, counts them as zero, and flags division by zero", () => {
    const result = evaluateExpression(expr(item("A"), "+", item("X")), values({ A: 5 }));
    assert.deepEqual(result, { value: 5, missing: ["X"], present: 1 });
    const divided = evaluateExpression(expr(item("A"), "/", item("Z")), values({ A: 5, Z: 0 }));
    assert.equal(divided.value, null);
    assert.equal(divided.problem, "division-by-zero");
    assert.equal(evaluateExpression({ terms: [] }, values({})).value, null);
  });

  test("describes an expression the way a reviewer would write it", () => {
    assert.equal(describeExpression(expr(item("a", "ANC 1"), "-", num(2), "*", item("b", "ANC 4"))), "ANC 1 − 2 × ANC 4");
    assert.equal(describeExpression({ terms: [] }), "—");
  });
});

describe("compare", () => {
  test("each operator, with rounding noise forgiven on equality", () => {
    const rule = (op: DqRule["op"], limit = 0) => ({ op, limit });
    assert.ok(compare(rule("=="), 10, 10.0000000001));
    assert.ok(!compare(rule("=="), 10, 11));
    assert.ok(compare(rule("!="), 10, 11));
    assert.ok(compare(rule("<"), 9, 10) && !compare(rule("<"), 10, 10));
    assert.ok(compare(rule("<="), 10, 10) && !compare(rule("<="), 11, 10));
    assert.ok(compare(rule(">"), 11, 10) && !compare(rule(">"), 10, 10));
    assert.ok(compare(rule(">="), 10, 10) && !compare(rule(">="), 9, 10));
  });

  test("within takes the gap as a share of the larger side", () => {
    assert.ok(compare({ op: "within", limit: 5 }, 100, 95));
    assert.ok(!compare({ op: "within", limit: 5 }, 100, 94));
    assert.ok(compare({ op: "within", limit: 0 }, 0, 0));
  });

  test("between reads the right side as the floor and the limit as the ceiling", () => {
    assert.ok(compare({ op: "between", limit: 100 }, 85, 0));
    assert.ok(!compare({ op: "between", limit: 100 }, 104, 0));
    assert.ok(!compare({ op: "between", limit: 100 }, -1, 0));
  });
});

describe("checkCell and missing values", () => {
  const rule: DqRule = { ...newRule("r1", "ANC4 ≤ ANC1"), left: expr(item("anc4")), op: "<=", right: expr(item("anc1")) };

  test("passes, fails, and skips by the strategy", () => {
    assert.equal(checkCell(rule, "ou", "pe", values({ anc4: 40, anc1: 50 })).status, "pass");
    const failed = checkCell(rule, "ou", "pe", values({ anc4: 60, anc1: 50 }));
    assert.equal(failed.status, "fail");
    assert.equal(failed.difference, 10);

    const halfReported = values({ anc4: 60 });
    assert.equal(checkCell(rule, "ou", "pe", halfReported).status, "skipped");
    assert.equal(checkCell({ ...rule, missing: "SKIP_IF_ALL_VALUES_MISSING" }, "ou", "pe", halfReported).status, "skipped");
    assert.equal(checkCell({ ...rule, missing: "NEVER_SKIP" }, "ou", "pe", halfReported).status, "fail");
  });

  test("a side with some items reported is checked under SKIP_IF_ALL_VALUES_MISSING", () => {
    const sumRule: DqRule = { ...rule, left: expr(item("a"), "+", item("b")), op: "==", right: expr(item("t")), missing: "SKIP_IF_ALL_VALUES_MISSING" };
    assert.equal(checkCell(sumRule, "ou", "pe", values({ a: 5, t: 5 })).status, "pass");
    assert.equal(checkCell({ ...sumRule, missing: "SKIP_IF_ANY_VALUE_MISSING" }, "ou", "pe", values({ a: 5, t: 5 })).status, "skipped");
  });

  test("nothing reported is skipped unless the strategy never skips; division by zero is skipped", () => {
    assert.equal(checkCell(rule, "ou", "pe", values({})).reason, "Nothing reported");
    assert.equal(checkCell({ ...rule, missing: "NEVER_SKIP" }, "ou", "pe", values({})).status, "pass");
    const ratio: DqRule = { ...rule, left: expr(item("a"), "/", item("b"), "*", num(100)), op: "between", right: expr(num(0)), limit: 100, missing: "NEVER_SKIP" };
    assert.equal(checkCell(ratio, "ou", "pe", values({ a: 5, b: 0 })).reason, "Division by zero");
    assert.equal(checkCell(ratio, "ou", "pe", values({ a: 5, b: 10 })).status, "pass");
  });

  test("rule problems are named before a rule is run", () => {
    assert.equal(ruleProblem(newRule("x")), "The left side is empty.");
    assert.equal(ruleProblem({ ...newRule("x"), left: expr(num(1)), right: expr(num(2)) }), "The rule uses no data element or indicator.");
    assert.equal(ruleProblem(rule), null);
    assert.equal(describeRule(rule), "anc4 ≤ anc1");
    assert.equal(describeRule({ ...rule, op: "within", limit: 5 }), "anc4 ≈ anc1 (within 5%)");
    assert.equal(describeRule({ ...rule, op: "between", right: expr(num(0)), limit: 100 }), "0 ≤ anc4 ≤ 100");
  });
});

describe("running rules and the report", () => {
  const header = (name: string, meta: boolean) => ({ name, column: name, valueType: "TEXT", type: "java.lang.String", hidden: false, meta });
  const response = {
    headers: [header("dx", true), header("pe", true), header("ou", true), header("value", false)],
    metaData: {
      items: {
        anc1: { name: "ANC 1st visit" },
        anc4: { name: "ANC 4th visit" },
        ouA: { name: "Ejura" },
        ouB: { name: "Mampong" },
        ouC: { name: "Kasei" },
        "202601": { name: "January 2026" },
        "202602": { name: "February 2026" },
      },
      dimensions: {},
    },
    rows: [
      ["anc1", "202601", "ouA", "50"], ["anc4", "202601", "ouA", "60"],
      ["anc1", "202602", "ouA", "50"], ["anc4", "202602", "ouA", "40"],
      ["anc1", "202601", "ouB", "20"], ["anc4", "202601", "ouB", "20"],
      ["anc1", "202602", "ouB", "30"], ["anc4", "202602", "ouB", "45"],
      ["anc4", "202601", "ouC", "9"],
    ],
  };
  const parsed = parseAnalytics(response);
  const names = (id: string) => (response.metaData.items as Record<string, { name: string }>)[id]?.name ?? id;
  const rule: DqRule = { ...newRule("r1", "ANC4 ≤ ANC1"), left: expr(item("anc4", "ANC 4th visit")), op: "<=", right: expr(item("anc1", "ANC 1st visit")), importance: "HIGH" };
  const sumRule: DqRule = { ...newRule("r2", "ANC1 recorded"), left: expr(item("anc1")), op: ">", right: expr(num(0)), importance: "LOW" };

  test("the lookup sums category splits and lists units and periods in order", () => {
    const lookup = valueLookup(parseAnalytics({ ...response, rows: [...response.rows, ["anc1", "202601", "ouA", "5"]] }));
    assert.equal(lookup.get("anc1", "ouA", "202601"), 55);
    assert.deepEqual(lookup.periods, ["202601", "202602"]);
    assert.equal(lookup.units.length, 3);
    assert.deepEqual(rulesItems([rule, sumRule]).map((entry) => entry.id), ["anc4", "anc1"]);
  });

  test("counts passes, failures and skips per rule", () => {
    const [result] = runRules([rule], valueLookup(parsed));
    assert.equal(result.rows.length, 6);
    assert.equal(result.failed, 2);
    assert.equal(result.passed, 2);
    assert.equal(result.skipped, 2);
    assert.equal(result.checked, 4);
  });

  test("the report ranks violations, counts by unit and period, and writes findings from the figures", () => {
    const report = buildReport(runRules([rule, sumRule], valueLookup(parsed)), names);
    assert.equal(report.rules, 2);
    assert.equal(report.failed, 2);
    assert.equal(report.checked, 8);
    assert.equal(report.passRate, 0.75);
    assert.deepEqual(report.byImportance, { HIGH: 2, MEDIUM: 0, LOW: 0 });
    assert.deepEqual(report.byUnit.map((unit) => [unit.name, unit.value]), [["Ejura", 1], ["Mampong", 1]]);
    assert.equal(report.violations[0].ou, "ouB");
    assert.ok(Math.abs((report.violations[0].gapShare ?? 0) - 15 / 45) < 1e-9);
    assert.equal(report.findings[0], "2 rules were checked across 3 organisation units and 2 periods: 8 checks, of which 2 failed (25.0%) and 6 passed.");
    assert.ok(report.findings.some((line) => line.includes('The rule failed most often is "ANC4 ≤ ANC1": 2 of 4 checks (50.0%).')));
    assert.ok(report.findings.some((line) => line.includes('passed everywhere it could be checked: "ANC1 recorded"')));
    assert.ok(report.findings.some((line) => line.includes("high-importance")));
    // One failure in each of two months is a spread, not a peak.
    assert.ok(report.findings.includes("Failures are spread over 2 periods of 2, with no more than 1 in any one."));
    assert.ok(report.findings.at(-1)!.startsWith("The largest gap on the most important rule is at Mampong in February 2026: 45 against 30"));
  });

  test("a range violation is measured from the bound it broke, and clean periods count zero", () => {
    const range: DqRule = { ...newRule("r3", "Coverage 0–100"), left: expr(item("anc4")), op: "between", right: expr(num(0)), limit: 50, importance: "LOW" };
    const report = buildReport(runRules([range], valueLookup(parsed)), names);
    const over = report.violations.find((violation) => violation.ou === "ouA" && violation.pe === "202601")!;
    assert.equal(over.left, 60);
    assert.equal(over.difference, 10);
    assert.ok(Math.abs((over.gapShare ?? 0) - 10 / 60) < 1e-9);
    assert.deepEqual(report.byPeriod.map((period) => [period.id, period.value]), [["202601", 1], ["202602", 0]]);
    assert.ok(report.findings.includes("Failures peak in January 2026, with 1."));
  });

  test("a report with nothing checked says why, and one with no failures says so", () => {
    const empty = buildReport(runRules([rule], { get: () => undefined, units: ["ouA"], periods: ["202601"] }), names);
    assert.equal(empty.passRate, null);
    assert.ok(empty.findings[0].startsWith("No check could be made"));
    const clean = buildReport(runRules([sumRule], valueLookup(parsed)), names);
    assert.ok(clean.findings.includes("Every check that could be made passed."));
  });

  test("the CSV files carry the rule, the place, the figures and the expression", () => {
    const report = buildReport(runRules([rule], valueLookup(parsed)), names);
    const lines = violationsToCsv(report.violations, [rule], names).split("\r\n");
    assert.equal(lines[0], "Rule,Importance,Organisation unit,Period,Left side,Right side,Difference,Gap % of larger,Rule expression");
    assert.equal(lines[1], "ANC4 ≤ ANC1,HIGH,Mampong,February 2026,45,30,15,33.3,ANC 4th visit ≤ ANC 1st visit");
    const summary = ruleSummaryToCsv(report).split("\r\n");
    assert.equal(summary[1], "ANC4 ≤ ANC1,ANC 4th visit ≤ ANC 1st visit,HIGH,4,2,2,50.0");
  });
});

describe("health, heatmap and sharing", () => {
  test("health reads the pass rate at fixed cut-offs", () => {
    assert.equal(healthOf(null), "none");
    assert.equal(healthOf(1), "good");
    assert.equal(healthOf(0.95), "good");
    assert.equal(healthOf(0.9499), "fair");
    assert.equal(healthOf(0.85), "fair");
    assert.equal(healthOf(0.5), "poor");
  });

  test("the failure grid counts per unit and period, worst unit first, every period a column", () => {
    const report = {
      byUnit: [{ id: "b", name: "B", value: 2 }, { id: "a", name: "A", value: 1 }],
      byPeriod: [{ id: "p1", name: "P1", value: 2 }, { id: "p2", name: "P2", value: 0 }, { id: "p3", name: "P3", value: 1 }],
      violations: [{ ou: "b", pe: "p1" }, { ou: "b", pe: "p1" }, { ou: "a", pe: "p3" }],
    } as unknown as Parameters<typeof failureGrid>[0];
    const grid = failureGrid(report, 1);
    assert.deepEqual(grid.units.map((unit) => unit.id), ["b"]);
    assert.equal(grid.hiddenUnits, 1);
    assert.equal(grid.periods.length, 3);
    assert.equal(grid.cells.get("b|p1"), 2);
    assert.equal(grid.max, 2);
  });

  test("rules survive export and import with fresh ids; broken rules are counted, not half-read", () => {
    const rule: DqRule = { ...newRule("r1", "ANC4 ≤ ANC1"), left: expr(item("anc4", "ANC 4")), right: expr(item("anc1"), "*", num(1.1)), importance: "HIGH" };
    const file = JSON.stringify(exportRules([rule], new Date("2026-11-14T00:00:00Z")));
    let n = 0;
    const { rules, rejected } = importRules(file, () => `new${++n}`);
    assert.equal(rejected, 0);
    assert.deepEqual(rules[0], { ...rule, id: "new1" });

    const broken = JSON.stringify([
      rule,
      { ...rule, op: "approx" },
      { ...rule, left: { terms: [{ op: "^", operand: num(1) }] } },
      { ...rule, right: { terms: [{ op: "+", operand: { kind: "item", item: { id: "bad id!" } } }] } },
    ]);
    const mixed = importRules(broken, () => "x");
    assert.equal(mixed.rules.length, 1);
    assert.equal(mixed.rejected, 3);
    assert.throws(() => importRules("not json", () => "x"), /not JSON/);
    assert.throws(() => importRules("{}", () => "x"), /no rules/);
  });
});
