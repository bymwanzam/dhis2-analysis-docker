/**
 * Data quality rules: an expression on each side, an operator between them,
 * checked for every organisation unit and period in scope.
 *
 * The shape follows DHIS2's own validation rules so a reviewer who knows
 * those reads these without a manual: a left side, a right side, an
 * operator, an importance, and a missing-value strategy that decides what
 * happens when a facility did not report one of the items. The difference
 * is that the rules live in this app, built from any data elements and
 * indicators, and run on demand over any scope.
 *
 * Everything here is pure: the page fetches one analytics response, builds
 * a value lookup from it, and hands both to `runRules`. The report is
 * written from the results, numbers first, so the words never say more than
 * the figures do.
 */
import { labelFor, rowsToCsv, type ParsedAnalytics } from "./analytics";
import type { DimensionItem } from "./types";
import { periodSortKey } from "../format";

/* ------------------------------------------------------------- shapes */

export type ArithmeticOp = "+" | "-" | "*" | "/";

export type Operand =
  | { kind: "item"; item: DimensionItem }
  | { kind: "const"; value: number };

export interface Term {
  /** How this term joins the one before it; ignored on the first term. */
  op: ArithmeticOp;
  operand: Operand;
}

export interface Expression {
  terms: Term[];
}

export type CompareOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "within" | "between";

export const COMPARE_OPS: { value: CompareOp; label: string; symbol: string }[] = [
  { value: "==", label: "equal to", symbol: "=" },
  { value: "!=", label: "not equal to", symbol: "≠" },
  { value: "<", label: "less than", symbol: "<" },
  { value: "<=", label: "less than or equal to", symbol: "≤" },
  { value: ">", label: "greater than", symbol: ">" },
  { value: ">=", label: "greater than or equal to", symbol: "≥" },
  { value: "within", label: "within a tolerance of", symbol: "≈" },
  { value: "between", label: "between (right side is the lower bound, the limit is the upper)", symbol: "∈" },
];

export const ARITHMETIC_OPS: { value: ArithmeticOp; symbol: string; label: string }[] = [
  { value: "+", symbol: "+", label: "add" },
  { value: "-", symbol: "−", label: "subtract" },
  { value: "*", symbol: "×", label: "multiply" },
  { value: "/", symbol: "÷", label: "divide" },
];

/**
 * What to do when an item has no value for a unit and period. The names are
 * DHIS2's own: SKIP_IF_ANY_VALUE_MISSING is the strict default, NEVER_SKIP
 * reads a missing value as zero, SKIP_IF_ALL_VALUES_MISSING checks the unit
 * if it reported anything at all on that side.
 */
export type MissingStrategy = "SKIP_IF_ANY_VALUE_MISSING" | "SKIP_IF_ALL_VALUES_MISSING" | "NEVER_SKIP";

export const MISSING_STRATEGIES: { value: MissingStrategy; label: string; hint: string }[] = [
  {
    value: "SKIP_IF_ANY_VALUE_MISSING",
    label: "Skip if any value is missing",
    hint: "A unit is checked only when every item on both sides was reported.",
  },
  {
    value: "SKIP_IF_ALL_VALUES_MISSING",
    label: "Skip only if a side is entirely missing",
    hint: "Missing items count as zero, but a side with nothing reported is not checked.",
  },
  {
    value: "NEVER_SKIP",
    label: "Never skip (missing counts as zero)",
    hint: "Every unit is checked; an unreported item counts as zero.",
  },
];

export type Importance = "HIGH" | "MEDIUM" | "LOW";

export interface DqRule {
  id: string;
  name: string;
  left: Expression;
  op: CompareOp;
  right: Expression;
  /**
   * For "within": the allowed gap as a percent of the larger side.
   * For "between": the upper bound (the right side is the lower one).
   */
  limit: number;
  missing: MissingStrategy;
  importance: Importance;
}

export function newRule(id: string, name = "New rule"): DqRule {
  return {
    id,
    name,
    left: { terms: [] },
    op: "<=",
    right: { terms: [] },
    limit: 5,
    missing: "SKIP_IF_ANY_VALUE_MISSING",
    importance: "MEDIUM",
  };
}

/** Every data item a rule needs, once. */
export function ruleItems(rule: DqRule): DimensionItem[] {
  const items = new Map<string, DimensionItem>();
  for (const term of [...rule.left.terms, ...rule.right.terms]) {
    if (term.operand.kind === "item") items.set(term.operand.item.id, term.operand.item);
  }
  return [...items.values()];
}

/** Every data item a set of rules needs, once, in first-use order. */
export function rulesItems(rules: DqRule[]): DimensionItem[] {
  const items = new Map<string, DimensionItem>();
  for (const rule of rules) for (const item of ruleItems(rule)) if (!items.has(item.id)) items.set(item.id, item);
  return [...items.values()];
}

/**
 * Whether a rule can be run: both sides have something, "between" has an
 * upper bound above zero, and a rule that compares two constants is refused
 * because it says nothing about the data.
 */
export function ruleProblem(rule: DqRule): string | null {
  if (!rule.left.terms.length) return "The left side is empty.";
  if (!rule.right.terms.length) return "The right side is empty.";
  if (!ruleItems(rule).length) return "The rule uses no data element or indicator.";
  if (rule.op === "within" && !(rule.limit >= 0)) return "Set the tolerance.";
  if (rule.op === "between" && !Number.isFinite(rule.limit)) return "Set the upper bound.";
  return null;
}

/* --------------------------------------------------------- expressions */

/** "A + B − 2 × C", with item names cut to a readable length. */
export function describeExpression(expression: Expression, maxName = 40): string {
  if (!expression.terms.length) return "—";
  return expression.terms
    .map((term, index) => {
      const operand =
        term.operand.kind === "const"
          ? formatConstant(term.operand.value)
          : shorten(term.operand.item.displayName, maxName);
      if (index === 0) return operand;
      const symbol = ARITHMETIC_OPS.find((op) => op.value === term.op)?.symbol ?? term.op;
      return `${symbol} ${operand}`;
    })
    .join(" ");
}

export function describeRule(rule: DqRule, maxName = 40): string {
  const left = describeExpression(rule.left, maxName);
  const right = describeExpression(rule.right, maxName);
  if (rule.op === "within") return `${left} ≈ ${right} (within ${formatConstant(rule.limit)}%)`;
  if (rule.op === "between") return `${right} ≤ ${left} ≤ ${formatConstant(rule.limit)}`;
  const symbol = COMPARE_OPS.find((op) => op.value === rule.op)?.symbol ?? rule.op;
  return `${left} ${symbol} ${right}`;
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatConstant(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

export interface Evaluation {
  /** The side's value, or null when it could not be computed. */
  value: number | null;
  /** Items that had no value. */
  missing: string[];
  /** Items that did have one. */
  present: number;
  /** Why the value is null, when it is. */
  problem?: "division-by-zero";
}

/**
 * The value of one side for one unit and period.
 *
 * Multiplication and division bind before addition and subtraction, as on
 * paper, so "A + B × 2" doubles B only. A missing item reads as zero here;
 * whether that is acceptable is the missing-value strategy's decision, made
 * by the caller from `missing` and `present`.
 */
export function evaluateExpression(
  expression: Expression,
  valueOf: (itemId: string) => number | undefined,
): Evaluation {
  const missing: string[] = [];
  let present = 0;
  const operandValue = (operand: Operand): number => {
    if (operand.kind === "const") return operand.value;
    const value = valueOf(operand.item.id);
    if (value === undefined || !Number.isFinite(value)) {
      missing.push(operand.item.id);
      return 0;
    }
    present += 1;
    return value;
  };

  if (!expression.terms.length) return { value: null, missing, present };

  // Fold * and / into running products, then add the products up.
  let total = 0;
  let product = operandValue(expression.terms[0].operand);
  let sign = 1;
  let divisionByZero = false;
  for (let index = 1; index < expression.terms.length; index += 1) {
    const term = expression.terms[index];
    const value = operandValue(term.operand);
    if (term.op === "*") product *= value;
    else if (term.op === "/") {
      if (value === 0) divisionByZero = true;
      else product /= value;
    } else {
      total += sign * product;
      sign = term.op === "-" ? -1 : 1;
      product = value;
    }
  }
  total += sign * product;

  if (divisionByZero) return { value: null, missing, present, problem: "division-by-zero" };
  return { value: total, missing, present };
}

/* ------------------------------------------------------------ checking */

export type CheckStatus = "pass" | "fail" | "skipped";

export interface CheckRow {
  ruleId: string;
  ou: string;
  pe: string;
  left: number | null;
  right: number | null;
  /** Left minus right, when both exist. */
  difference: number | null;
  status: CheckStatus;
  /** Why a check was skipped, in words. */
  reason?: string;
}

function itemCount(expression: Expression): number {
  return expression.terms.filter((term) => term.operand.kind === "item").length;
}

/** Whether the strategy lets this side be checked. */
function sideUsable(evaluation: Evaluation, expression: Expression, strategy: MissingStrategy): boolean {
  const items = itemCount(expression);
  if (!items) return true;
  if (strategy === "NEVER_SKIP") return true;
  if (strategy === "SKIP_IF_ALL_VALUES_MISSING") return evaluation.present > 0;
  return evaluation.missing.length === 0;
}

/** The comparison itself, on two numbers. */
export function compare(rule: Pick<DqRule, "op" | "limit">, left: number, right: number): boolean {
  // Analytics returns rounded decimals; two sides that should be equal can
  // differ in the last place.
  const epsilon = 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
  switch (rule.op) {
    case "==":
      return Math.abs(left - right) <= epsilon;
    case "!=":
      return Math.abs(left - right) > epsilon;
    case "<":
      return left < right - epsilon;
    case "<=":
      return left <= right + epsilon;
    case ">":
      return left > right + epsilon;
    case ">=":
      return left >= right - epsilon;
    case "within": {
      const larger = Math.max(Math.abs(left), Math.abs(right));
      if (larger === 0) return true;
      return (Math.abs(left - right) / larger) * 100 <= rule.limit + 1e-9;
    }
    case "between":
      return left >= right - epsilon && left <= rule.limit + epsilon;
    default:
      return false;
  }
}

/**
 * How far the left side is from what the rule allows. For a range that is
 * the distance past the bound it broke — 112 against a ceiling of 100 is 12
 * over, not 112 — and zero inside the range; otherwise left minus right.
 */
export function ruleDifference(rule: Pick<DqRule, "op" | "limit">, left: number, right: number): number {
  if (rule.op === "between") {
    if (left > rule.limit) return left - rule.limit;
    if (left < right) return left - right;
    return 0;
  }
  return left - right;
}

/** The bound a "between" value is measured against, for the gap's share. */
function breachedBound(rule: Pick<DqRule, "op" | "limit">, left: number, right: number): number {
  return rule.op === "between" && left > rule.limit ? rule.limit : right;
}

/** One rule, for one unit and period. */
export function checkCell(
  rule: DqRule,
  ou: string,
  pe: string,
  valueOf: (itemId: string) => number | undefined,
): CheckRow {
  const left = evaluateExpression(rule.left, valueOf);
  const right = evaluateExpression(rule.right, valueOf);
  const base = { ruleId: rule.id, ou, pe, left: left.value, right: right.value };
  const difference =
    left.value !== null && right.value !== null ? ruleDifference(rule, left.value, right.value) : null;

  if (left.present + right.present === 0 && rule.missing !== "NEVER_SKIP") {
    return { ...base, difference, status: "skipped", reason: "Nothing reported" };
  }
  if (!sideUsable(left, rule.left, rule.missing) || !sideUsable(right, rule.right, rule.missing)) {
    return { ...base, difference, status: "skipped", reason: "A value is missing" };
  }
  if (left.problem === "division-by-zero" || right.problem === "division-by-zero") {
    return { ...base, difference: null, status: "skipped", reason: "Division by zero" };
  }
  if (left.value === null || right.value === null) {
    return { ...base, difference, status: "skipped", reason: "Could not be computed" };
  }
  return { ...base, difference, status: compare(rule, left.value, right.value) ? "pass" : "fail" };
}

/**
 * Values from a parsed analytics response, keyed item × unit × period.
 * When periods were sent as a filter, the period key is "ALL".
 */
export function valueLookup(parsed: ParsedAnalytics): {
  get: (item: string, ou: string, pe: string) => number | undefined;
  units: string[];
  periods: string[];
} {
  const values = new Map<string, number>();
  const units = new Set<string>();
  const periods = new Set<string>();
  const hasPeriod = parsed.dimensions.includes("pe");
  for (const row of parsed.rows) {
    const dx = String(row.dx ?? "");
    const ou = String(row.ou ?? "");
    const pe = hasPeriod ? String(row.pe ?? "") : "ALL";
    if (!dx || !ou) continue;
    units.add(ou);
    periods.add(pe);
    const key = `${dx}|${ou}|${pe}`;
    // Category options split a value; the rule reads the item's total.
    values.set(key, (values.get(key) ?? 0) + row.value);
  }
  return {
    get: (item, ou, pe) => values.get(`${item}|${ou}|${pe}`),
    units: [...units],
    periods: [...periods].sort((a, b) => periodSortKey(a).localeCompare(periodSortKey(b))),
  };
}

export interface RuleResult {
  rule: DqRule;
  rows: CheckRow[];
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Every rule over every unit and period that reported anything for any
 * rule. A unit that reported nothing at all for a rule is skipped rather
 * than failed, whatever the strategy, unless the strategy is NEVER_SKIP.
 */
export function runRules(
  rules: DqRule[],
  lookup: ReturnType<typeof valueLookup>,
): RuleResult[] {
  return rules.map((rule) => {
    const rows: CheckRow[] = [];
    for (const ou of lookup.units) {
      for (const pe of lookup.periods) {
        rows.push(checkCell(rule, ou, pe, (item) => lookup.get(item, ou, pe)));
      }
    }
    const passed = rows.filter((row) => row.status === "pass").length;
    const failed = rows.filter((row) => row.status === "fail").length;
    return { rule, rows, checked: passed + failed, passed, failed, skipped: rows.length - passed - failed };
  });
}

/* --------------------------------------------------------------- report */

export interface Violation extends CheckRow {
  ruleName: string;
  importance: Importance;
  /** The gap as a share of the larger side, for ranking. */
  gapShare: number | null;
}

export interface CountedName {
  id: string;
  name: string;
  value: number;
}

export interface DqReport {
  rules: number;
  units: number;
  periods: number;
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
  /** Passed as a share of checked, 0–1; null when nothing was checked. */
  passRate: number | null;
  byRule: { rule: DqRule; checked: number; failed: number; skipped: number; failRate: number | null }[];
  byUnit: CountedName[];
  byPeriod: CountedName[];
  byImportance: Record<Importance, number>;
  /** Worst first: importance, then the gap as a share of the larger side. */
  violations: Violation[];
  /** What the numbers say, sentence by sentence. */
  findings: string[];
}

const IMPORTANCE_ORDER: Record<Importance, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function buildReport(
  results: RuleResult[],
  names: (id: string) => string,
): DqReport {
  const checked = sum(results.map((result) => result.checked));
  const passed = sum(results.map((result) => result.passed));
  const failed = sum(results.map((result) => result.failed));
  const skipped = sum(results.map((result) => result.skipped));
  const units = new Set(results.flatMap((result) => result.rows.map((row) => row.ou)));
  const periods = new Set(results.flatMap((result) => result.rows.map((row) => row.pe)));

  const violations: Violation[] = results
    .flatMap((result) =>
      result.rows
        .filter((row) => row.status === "fail")
        .map((row) => {
          const larger =
            row.left !== null && row.right !== null
              ? Math.max(Math.abs(row.left), Math.abs(breachedBound(result.rule, row.left, row.right)))
              : 0;
          return {
            ...row,
            ruleName: result.rule.name,
            importance: result.rule.importance,
            gapShare: row.difference !== null && larger > 0 ? Math.abs(row.difference) / larger : null,
          };
        }),
    )
    .sort(
      (a, b) =>
        IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance] ||
        (b.gapShare ?? -1) - (a.gapShare ?? -1) ||
        names(a.ou).localeCompare(names(b.ou)),
    );

  const byUnit = countBy(violations.map((violation) => violation.ou), names).sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name),
  );
  // Every period in scope, a period without failures at zero: a chart that
  // left it out would draw a line straight through a clean month.
  const failuresByPeriod = new Map<string, number>([...periods].map((period) => [period, 0]));
  for (const violation of violations) failuresByPeriod.set(violation.pe, (failuresByPeriod.get(violation.pe) ?? 0) + 1);
  const byPeriod = [...failuresByPeriod.entries()]
    .map(([id, value]) => ({ id, name: names(id), value }))
    .sort((a, b) => periodSortKey(a.id).localeCompare(periodSortKey(b.id)));
  const byRule = results.map((result) => ({
    rule: result.rule,
    checked: result.checked,
    failed: result.failed,
    skipped: result.skipped,
    failRate: result.checked ? result.failed / result.checked : null,
  }));
  const byImportance: Record<Importance, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const violation of violations) byImportance[violation.importance] += 1;

  const report: DqReport = {
    rules: results.length,
    units: units.size,
    periods: periods.size,
    checked,
    passed,
    failed,
    skipped,
    passRate: checked ? passed / checked : null,
    byRule,
    byUnit,
    byPeriod,
    byImportance,
    violations,
    findings: [],
  };
  report.findings = writeFindings(report, names);
  return report;
}

/**
 * The report's sentences, each from a number already on the page. Nothing
 * is said that a reader cannot find in the tiles, charts or tables.
 */
export function writeFindings(report: DqReport, names: (id: string) => string): string[] {
  const lines: string[] = [];
  if (!report.checked) {
    lines.push(
      `No check could be made: of ${plural(report.skipped, "unit-period")} in scope, every one was skipped because values were missing. Widen the period, choose another level, or relax the missing-value strategy.`,
    );
    return lines;
  }

  lines.push(
    `${plural(report.rules, "rule")} ${report.rules === 1 ? "was" : "were"} checked across ${plural(report.units, "organisation unit")} and ${plural(report.periods, "period")}: ${fmt(report.checked)} checks, of which ${fmt(report.failed)} failed (${pct(report.failed / report.checked)}) and ${fmt(report.passed)} passed.`,
  );

  if (report.skipped) {
    lines.push(
      `${fmt(report.skipped)} unit-period ${report.skipped === 1 ? "combination was" : "combinations were"} skipped because values were missing; they are neither passes nor failures.`,
    );
  }

  if (!report.failed) {
    lines.push("Every check that could be made passed.");
    return lines;
  }

  if (report.byImportance.HIGH) {
    lines.push(`${plural(report.byImportance.HIGH, "failure")} ${report.byImportance.HIGH === 1 ? "is" : "are"} on high-importance rules and should be followed up first.`);
  }

  const worstRule = [...report.byRule].filter((entry) => entry.failRate !== null).sort((a, b) => (b.failRate ?? 0) - (a.failRate ?? 0) || b.failed - a.failed)[0];
  if (worstRule && worstRule.failed) {
    lines.push(
      `The rule failed most often is "${worstRule.rule.name}": ${fmt(worstRule.failed)} of ${fmt(worstRule.checked)} checks (${pct(worstRule.failRate ?? 0)}).`,
    );
  }
  const clean = report.byRule.filter((entry) => entry.checked && !entry.failed);
  if (clean.length) {
    lines.push(`${plural(clean.length, "rule")} passed everywhere ${clean.length === 1 ? "it" : "they"} could be checked: ${clean.map((entry) => `"${entry.rule.name}"`).join(", ")}.`);
  }

  const topUnits = report.byUnit.slice(0, 3);
  if (topUnits.length) {
    const share = sum(topUnits.map((unit) => unit.value)) / report.failed;
    lines.push(
      `The organisation units with the most failures are ${topUnits.map((unit) => `${unit.name} (${fmt(unit.value)})`).join(", ")}, together ${pct(share)} of all failures.`,
    );
  }

  const withFailures = report.byPeriod.filter((period) => period.value > 0);
  if (report.byPeriod.length > 1 && withFailures.length) {
    // A peak is only a peak when one period stands above the rest.
    const most = Math.max(...withFailures.map((period) => period.value));
    const atMost = withFailures.filter((period) => period.value === most);
    if (atMost.length === 1) {
      lines.push(`Failures peak in ${atMost[0].name}, with ${fmt(most)}.`);
    } else {
      lines.push(
        `Failures are spread over ${plural(withFailures.length, "period")} of ${fmt(report.byPeriod.length)}, with no more than ${fmt(most)} in any one.`,
      );
    }
  }

  const worst = report.violations[0];
  if (worst && worst.left !== null && worst.right !== null) {
    lines.push(
      `The largest gap on the most important rule is at ${names(worst.ou)} in ${names(worst.pe)}: ${fmt(worst.left)} against ${fmt(worst.right)} on "${worst.ruleName}".`,
    );
  }
  return lines;
}

function countBy(ids: string[], names: (id: string) => string): CountedName[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].map(([id, value]) => ({ id, name: names(id), value }));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function fmt(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function plural(count: number, noun: string): string {
  return `${fmt(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The names a report needs, from the analytics response. */
export function namesFrom(parsed: ParsedAnalytics): (id: string) => string {
  return (id) => (id === "ALL" ? "All periods combined" : labelFor(parsed, id));
}

/* ----------------------------------------------------------------- CSV */

export function violationsToCsv(violations: Violation[], rules: DqRule[], names: (id: string) => string): string {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return rowsToCsv(
    ["Rule", "Importance", "Organisation unit", "Period", "Left side", "Right side", "Difference", "Gap % of larger", "Rule expression"],
    violations.map((violation) => [
      violation.ruleName,
      violation.importance,
      names(violation.ou),
      names(violation.pe),
      numberCell(violation.left),
      numberCell(violation.right),
      numberCell(violation.difference),
      violation.gapShare === null ? "" : (violation.gapShare * 100).toFixed(1),
      byId.get(violation.ruleId) ? describeRule(byId.get(violation.ruleId)!, 200) : "",
    ]),
  );
}

export function ruleSummaryToCsv(report: DqReport): string {
  return rowsToCsv(
    ["Rule", "Expression", "Importance", "Checked", "Failed", "Skipped", "Fail rate %"],
    report.byRule.map((entry) => [
      entry.rule.name,
      describeRule(entry.rule, 200),
      entry.rule.importance,
      String(entry.checked),
      String(entry.failed),
      String(entry.skipped),
      entry.failRate === null ? "" : (entry.failRate * 100).toFixed(1),
    ]),
  );
}

function numberCell(value: number | null): string {
  return value === null ? "" : String(Math.round(value * 1000) / 1000);
}

/* ------------------------------------------------------------ templates */

/**
 * Starting points a reviewer fills in with their own items. Each keeps its
 * sides empty: the app cannot know which data elements a server uses for
 * OPD or ANC, and guessing would make a rule that checks the wrong thing.
 */
export const RULE_TEMPLATES: { name: string; op: CompareOp; limit: number; hint: string }[] = [
  { name: "Part must not exceed the whole", op: "<=", limit: 0, hint: "e.g. ANC 4th visit ≤ ANC 1st visit; tested ≤ suspected" },
  { name: "Total must equal the sum of its parts", op: "==", limit: 0, hint: "e.g. total deliveries = normal + assisted + caesarean" },
  { name: "Two sources must agree within a tolerance", op: "within", limit: 5, hint: "e.g. register count ≈ summary form, within 5%" },
  { name: "Rate must be within a plausible range", op: "between", limit: 100, hint: "e.g. 0 ≤ coverage % ≤ 100" },
  { name: "Value must be reported (not zero)", op: ">", limit: 0, hint: "e.g. OPD attendance > 0" },
];

/* --------------------------------------------------------------- health */

export type Health = "good" | "fair" | "poor" | "none";

export const HEALTH_LABELS: Record<Health, string> = {
  good: "Good",
  fair: "Needs attention",
  poor: "Poor",
  none: "Not enough data",
};

/**
 * A word for the pass rate, at fixed cut-offs so the same rate always reads
 * the same: 95% and above is good, 85% and above needs attention, below that
 * is poor. Shown next to the number, never instead of it.
 */
export function healthOf(passRate: number | null): Health {
  if (passRate === null) return "none";
  if (passRate >= 0.95) return "good";
  if (passRate >= 0.85) return "fair";
  return "poor";
}

/* -------------------------------------------------------------- heatmap */

export interface FailureGrid {
  units: CountedName[];
  periods: CountedName[];
  /** Failures per unit and period, keyed "ou|pe". */
  cells: Map<string, number>;
  max: number;
  /** Units left out to keep the grid readable. */
  hiddenUnits: number;
}

/**
 * Failures by unit and period, the units with most failures first. Every
 * period in scope is a column, so a clean month shows as an empty column
 * rather than vanishing.
 */
export function failureGrid(report: DqReport, maxUnits = 25): FailureGrid {
  const cells = new Map<string, number>();
  for (const violation of report.violations) {
    const key = `${violation.ou}|${violation.pe}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const units = report.byUnit.slice(0, maxUnits);
  return {
    units,
    periods: report.byPeriod,
    cells,
    max: Math.max(0, ...cells.values()),
    hiddenUnits: Math.max(0, report.byUnit.length - units.length),
  };
}

/* ------------------------------------------------------- import, export */

export interface RuleFile {
  format: "dhis2-analysis/dq-rules";
  version: 1;
  exportedAt: string;
  rules: DqRule[];
}

export function exportRules(rules: DqRule[], now = new Date()): RuleFile {
  return { format: "dhis2-analysis/dq-rules", version: 1, exportedAt: now.toISOString(), rules };
}

/**
 * Rules from a file another reviewer exported. Each rule is checked field by
 * field; one that does not fit is left out and counted, never half-read.
 * Imported rules get fresh ids so they never overwrite rules already here.
 */
export function importRules(text: string, makeId: () => string): { rules: DqRule[]; rejected: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not JSON.");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as RuleFile).rules)
      ? (parsed as RuleFile).rules
      : null;
  if (!list) throw new Error("The file holds no rules.");

  const rules: DqRule[] = [];
  let rejected = 0;
  for (const raw of list) {
    const rule = readRule(raw);
    if (rule) rules.push({ ...rule, id: makeId() });
    else rejected += 1;
  }
  return { rules, rejected };
}

const COMPARE_VALUES = new Set<string>(COMPARE_OPS.map((op) => op.value));
const ARITHMETIC_VALUES = new Set<string>(ARITHMETIC_OPS.map((op) => op.value));
const MISSING_VALUES = new Set<string>(MISSING_STRATEGIES.map((strategy) => strategy.value));

function readRule(raw: unknown): DqRule | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const left = readExpression(value.left);
  const right = readExpression(value.right);
  if (!left || !right) return null;
  if (!COMPARE_VALUES.has(String(value.op))) return null;
  const importance = value.importance;
  return {
    id: "",
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 200) : "Imported rule",
    left,
    right,
    op: value.op as CompareOp,
    limit: typeof value.limit === "number" && Number.isFinite(value.limit) ? value.limit : 0,
    missing: MISSING_VALUES.has(String(value.missing)) ? (value.missing as MissingStrategy) : "SKIP_IF_ANY_VALUE_MISSING",
    importance: importance === "HIGH" || importance === "LOW" ? importance : "MEDIUM",
  };
}

function readExpression(raw: unknown): Expression | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Expression).terms)) return null;
  const terms: Term[] = [];
  for (const term of (raw as Expression).terms as unknown[]) {
    if (!term || typeof term !== "object") return null;
    const { op, operand } = term as Record<string, unknown>;
    if (!ARITHMETIC_VALUES.has(String(op))) return null;
    if (!operand || typeof operand !== "object") return null;
    const fields = operand as Record<string, unknown>;
    if (fields.kind === "const") {
      if (typeof fields.value !== "number" || !Number.isFinite(fields.value)) return null;
      terms.push({ op: op as ArithmeticOp, operand: { kind: "const", value: fields.value } });
    } else if (fields.kind === "item") {
      const item = fields.item as Record<string, unknown> | undefined;
      if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9._-]{1,60}$/.test(item.id)) return null;
      terms.push({
        op: op as ArithmeticOp,
        operand: {
          kind: "item",
          item: { id: item.id, displayName: typeof item.displayName === "string" ? item.displayName : item.id },
        },
      });
    } else return null;
  }
  return { terms };
}
