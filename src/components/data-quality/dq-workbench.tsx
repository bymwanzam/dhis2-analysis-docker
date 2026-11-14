"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Copy,
  Download,
  FileText,
  Hash,
  LayoutTemplate,
  Pencil,
  Play,
  Plus,
  Printer,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { CategoryBarChart } from "@/components/charts/category-bar-chart";
import { ChartFrame, ScaleLegend, type ChartView } from "@/components/charts/chart-frame";
import { Column, DataTable } from "@/components/charts/data-table";
import { heatFill, heatScaleStops } from "@/components/charts/palette";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { useConnection } from "@/components/connection-provider";
import { DATA_SOURCES, findDataSource, toDimensionItem } from "@/components/query/data-sources";
import {
  OrgUnitPicker,
  toOuDimension,
  type OrgUnitSelection,
} from "@/components/query/org-unit-picker";
import { PeriodPicker } from "@/components/query/period-picker";
import { Section, summarise } from "@/components/query/section";
import { Alert, Button, Input, Label, Segmented, Select, Spinner } from "@/components/ui/primitives";
import { parseAnalytics } from "@/lib/dhis2/analytics";
import { fetchAnalytics, searchMetadata, type MetadataResource } from "@/lib/dhis2/client";
import {
  ARITHMETIC_OPS,
  COMPARE_OPS,
  HEALTH_LABELS,
  MISSING_STRATEGIES,
  RULE_TEMPLATES,
  buildReport,
  describeRule,
  exportRules,
  failureGrid,
  healthOf,
  importRules,
  namesFrom,
  newRule,
  ruleProblem,
  ruleSummaryToCsv,
  rulesItems,
  runRules,
  valueLookup,
  violationsToCsv,
  type ArithmeticOp,
  type CompareOp,
  type DqReport,
  type DqRule,
  type Expression,
  type Health,
  type Importance,
  type Violation,
} from "@/lib/dhis2/dq-rules";
import { findPeriodOption } from "@/lib/dhis2/periods";
import type { DimensionItem, IdName } from "@/lib/dhis2/types";
import { downloadCsv, downloadJson, stamped } from "@/lib/download";
import { formatNumber, formatPeriod } from "@/lib/format";
import { useAsyncData, useDebounced, usePersistentState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------- state */

interface ScopeState {
  periods: string[];
  orgUnits: OrgUnitSelection;
  /** Check each period on its own, or all periods combined into one value. */
  periodMode: "each" | "combined";
}

const DEFAULT_SCOPE: ScopeState = {
  periods: ["LAST_6_MONTHS"],
  orgUnits: { units: [], level: "", useUserOrgUnit: true },
  periodMode: "each",
};

const IMPORTANCES: Importance[] = ["HIGH", "MEDIUM", "LOW"];
const IMPORTANCE_LABELS: Record<Importance, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

/** Bars drawn in a ranking; the table holds the rest. */
const MAX_BARS = 20;
/** Violations listed on screen; the CSV holds them all. */
const MAX_VIOLATION_ROWS = 500;

const COUNT_SERIES = [{ id: "failures", name: "Failures" }];

/** Each side of a rule wears its own colour key everywhere it appears. */
const SIDE_COLOR = { left: "var(--series-1)", right: "var(--series-2)" } as const;

/** Pass and fail are states, so they take the reserved status colours, always with a word. */
const STATE_COLOR = { pass: "var(--good)", fail: "var(--critical)", skipped: "var(--muted)" } as const;

const HEALTH_STYLE: Record<Health, { color: string; Icon: typeof CheckCircle2 }> = {
  good: { color: "var(--good)", Icon: CheckCircle2 },
  fair: { color: "var(--warning)", Icon: AlertTriangle },
  poor: { color: "var(--critical)", Icon: XCircle },
  none: { color: "var(--muted)", Icon: CircleDashed },
};

function makeId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function pct(share: number | null): string {
  return share === null ? "—" : `${(share * 100).toFixed(1)}%`;
}

function opSymbol(op: CompareOp): string {
  return COMPARE_OPS.find((entry) => entry.value === op)?.symbol ?? op;
}

/**
 * The Data Quality page: rules built from any data elements and indicators,
 * checked over a scope, and a report written from the results.
 *
 * Rules are kept in this browser per server, because item ids mean nothing
 * on another server; they can be exported to a file and imported by a
 * colleague. A run fetches one analytics response holding every item every
 * rule needs, and every rule is evaluated from it; nothing is written to
 * DHIS2.
 */
export function DqWorkbench() {
  const { status, loading: checking } = useConnection();
  const connected = status?.connected === true;
  const server = status?.baseUrl ?? "unset";

  const [rules, setRules] = usePersistentState<DqRule[]>(`dhis2.dq.rules::${server}`, []);
  const [scope, setScope] = usePersistentState<ScopeState>(`dhis2.dq.scope::${server}`, DEFAULT_SCOPE);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "info" | "error"; text: string } | null>(null);

  /* ----------------------------------------------------------- the run */

  // A run is a snapshot: editing a rule afterwards does not change the
  // report on screen until the reviewer runs again.
  const [request, setRequest] = React.useState<{ rules: DqRule[]; scope: ScopeState; at: string } | null>(null);
  const requestKey = request ? JSON.stringify(request) : null;

  const analytics = useAsyncData(async (signal) => {
    if (!request) return null;
    const response = await fetchAnalytics(
      {
        dx: rulesItems(request.rules).map((item) => item.id),
        pe: request.scope.periods,
        ou: toOuDimension(request.scope.orgUnits),
        periodsAsFilter: request.scope.periodMode === "combined",
        skipRounding: true,
      },
      signal,
    );
    return parseAnalytics(response);
  }, [requestKey]);

  const report = React.useMemo(() => {
    if (!request || !analytics.data) return null;
    const names = namesFrom(analytics.data);
    const results = runRules(request.rules, valueLookup(analytics.data));
    return { report: buildReport(results, names), names, rules: request.rules };
  }, [request, analytics.data]);

  const runnable = rules.filter((rule) => !ruleProblem(rule));
  const scopeOk = scope.periods.length > 0 && toOuDimension(scope.orgUnits).length > 0;
  const running = analytics.loading && Boolean(request);
  const reportRef = React.useRef<HTMLDivElement>(null);

  function run(only?: DqRule) {
    setRequest({ rules: only ? [only] : runnable, scope, at: new Date().toISOString() });
    setEditing(null);
    window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  /* ------------------------------------------------------------- rules */

  const update = (id: string, change: (rule: DqRule) => DqRule) =>
    setRules((current) => current.map((rule) => (rule.id === id ? change(rule) : rule)));

  function addRule(template?: (typeof RULE_TEMPLATES)[number]) {
    const zero = { terms: [{ op: "+" as const, operand: { kind: "const" as const, value: 0 } }] };
    const rule: DqRule = {
      ...newRule(makeId(), template?.name ?? `Rule ${rules.length + 1}`),
      ...(template ? { op: template.op, limit: template.limit } : {}),
      ...(template && (template.op === "between" || (template.op === ">" && template.limit === 0)) ? { right: zero } : {}),
    };
    setRules((current) => [...current, rule]);
    setEditing(rule.id);
  }

  const fileInput = React.useRef<HTMLInputElement>(null);
  async function onImport(file: File) {
    try {
      const { rules: imported, rejected } = importRules(await file.text(), makeId);
      setRules((current) => [...current, ...imported]);
      setNotice({
        tone: imported.length ? "info" : "error",
        text: `${imported.length} rule${imported.length === 1 ? "" : "s"} imported${rejected ? `, ${rejected} left out because they did not fit` : ""}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  /* ----------------------------------------------------------- display */

  if (checking) return <Spinner label="Checking the connection" />;

  if (!connected) {
    return (
      <Alert tone="error" title="No DHIS2 connection">
        Add a server URL and access token on the{" "}
        <Link href="/connect" className="text-accent underline underline-offset-2">
          connection page
        </Link>{" "}
        to check data quality.
      </Alert>
    );
  }

  const periodSummary = summarise(
    scope.periods.map((period) => findPeriodOption(period)?.label ?? formatPeriod(period)),
    "No period",
  );
  const orgUnitSummary = summarise(
    [
      ...(scope.orgUnits.useUserOrgUnit ? ["Your organisation unit"] : []),
      ...scope.orgUnits.units.map((unit) => unit.displayName),
      ...(scope.orgUnits.level ? [scope.orgUnits.level.replace("LEVEL-", "Level ")] : []),
    ],
    "No organisation unit",
  );

  const steps = [
    { label: "Build rules", detail: `${runnable.length} ready`, done: runnable.length > 0 },
    { label: "Choose scope", detail: scopeOk ? `${periodSummary} · ${orgUnitSummary}` : "Period and units", done: scopeOk },
    { label: "Run", detail: running ? "Checking…" : request ? "Done" : "One read-only request", done: Boolean(report) },
    {
      label: "Read the report",
      detail: report ? `${formatNumber(report.report.failed)} failures found` : "Generated automatically",
      done: Boolean(report),
    },
  ];

  return (
    <div className="space-y-5">
      <Stepper steps={steps} />

      {notice ? (
        <div className="no-print flex items-start gap-2">
          <div className="flex-1">
            <Alert tone={notice.tone}>{notice.text}</Alert>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="mt-2 text-muted hover:text-ink">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="no-print flex flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <RunCard
            runnable={runnable.length}
            total={rules.length}
            scopeOk={scopeOk}
            running={running}
            onRun={() => run()}
          />
          <Section title="Period" summary={periodSummary}>
            <PeriodPicker selected={scope.periods} onChange={(periods) => setScope((current) => ({ ...current, periods }))} />
            <div className="mt-3">
              <Label>How periods are checked</Label>
              <Segmented
                className="mt-1"
                ariaLabel="How periods are checked"
                value={scope.periodMode}
                onChange={(periodMode) => setScope((current) => ({ ...current, periodMode }))}
                options={[
                  { value: "each", label: "Each period" },
                  { value: "combined", label: "Combined" },
                ]}
              />
              <p className="mt-1 text-xs text-muted">
                {scope.periodMode === "each"
                  ? "Every rule is checked period by period."
                  : "DHIS2 combines the periods first; each unit is checked once on its total. Indicators are recalculated, never averaged."}
              </p>
            </div>
          </Section>
          <Section title="Organisation units" summary={orgUnitSummary}>
            <OrgUnitPicker selection={scope.orgUnits} onChange={(orgUnits) => setScope((current) => ({ ...current, orgUnits }))} />
            <p className="mt-2 text-xs text-muted">
              Choose a level, e.g. facility, to check every unit at it inside the units chosen.
            </p>
          </Section>
        </aside>

        <div className="min-w-0 space-y-5">
          <section className="no-print overflow-hidden rounded-xl border border-hair bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">Rules</h2>
                <p className="mt-0.5 text-sm text-ink-2">
                  {rules.length
                    ? `${rules.length} rule${rules.length === 1 ? "" : "s"}, ${runnable.length} ready to run. Click a rule to edit it.`
                    : "A rule compares two sides. Each side adds, subtracts, multiplies or divides data elements, indicators and numbers."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onImport(file);
                    event.target.value = "";
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} title="Add rules from a file a colleague exported">
                  <Upload className="size-3.5" aria-hidden /> Import
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!rules.length}
                  onClick={() => downloadJson(exportRules(rules), `${stamped("dq-rules")}.json`)}
                  title="Save the rules to a file to share or keep"
                >
                  <Download className="size-3.5" aria-hidden /> Export
                </Button>
                <Button size="sm" variant="secondary" onClick={() => addRule()}>
                  <Plus className="size-3.5" aria-hidden /> Blank rule
                </Button>
              </div>
            </header>

            <TemplateGallery onPick={addRule} compact={rules.length > 0} />

            {rules.length ? (
              <ol className="space-y-3 p-4">
                {rules.map((rule, index) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    index={index}
                    count={rules.length}
                    editing={editing === rule.id}
                    onEdit={() => setEditing(editing === rule.id ? null : rule.id)}
                    onChange={(change) => update(rule.id, change)}
                    onRemove={() => {
                      setRules((current) => current.filter((entry) => entry.id !== rule.id));
                      if (editing === rule.id) setEditing(null);
                    }}
                    onDuplicate={() =>
                      setRules((current) => {
                        const copy = { ...structuredClone(rule), id: makeId(), name: `${rule.name} (copy)` };
                        const at = current.findIndex((entry) => entry.id === rule.id);
                        return [...current.slice(0, at + 1), copy, ...current.slice(at + 1)];
                      })
                    }
                    onMove={(by) =>
                      setRules((current) => {
                        const target = index + by;
                        if (target < 0 || target >= current.length) return current;
                        const next = [...current];
                        [next[index], next[target]] = [next[target], next[index]];
                        return next;
                      })
                    }
                    onRunOne={scopeOk ? () => run(rule) : undefined}
                  />
                ))}
              </ol>
            ) : null}
          </section>

          <div ref={reportRef} className="scroll-mt-20">
            {request ? (
              analytics.error ? (
                <Alert tone="error" title="The values could not be loaded">
                  {analytics.error}
                </Alert>
              ) : running || !report ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-hair bg-surface py-16">
                  <Spinner label="Reading values and checking rules" />
                  <p className="text-xs text-muted">
                    {request.rules.length} rule{request.rules.length === 1 ? "" : "s"} · {rulesItems(request.rules).length} data items
                  </p>
                </div>
              ) : (
                <ReportView
                  report={report.report}
                  names={report.names}
                  rules={report.rules}
                  scopeLine={`${periodSummary}${request.scope.periodMode === "combined" ? " (combined)" : ""} · ${orgUnitSummary}`}
                  ranAt={request.at}
                  server={server}
                />
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ chrome */

function Stepper({ steps }: { steps: { label: string; detail: string; done: boolean }[] }) {
  const current = steps.findIndex((step) => !step.done);
  return (
    <ol className="no-print grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => {
        const active = index === current;
        return (
          <li
            key={step.label}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors",
              active ? "border-accent bg-accent/5" : "border-hair bg-surface",
            )}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                step.done ? "bg-accent text-accent-ink" : active ? "border-2 border-accent text-accent" : "border border-hair text-muted",
              )}
              aria-hidden
            >
              {step.done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{step.label}</span>
              <span className="block truncate text-xs text-ink-2">{step.detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RunCard({
  runnable,
  total,
  scopeOk,
  running,
  onRun,
}: {
  runnable: number;
  total: number;
  scopeOk: boolean;
  running: boolean;
  onRun: () => void;
}) {
  const blocker = !total
    ? "Add a rule to start."
    : !runnable
      ? "Finish a rule: both sides need something, and at least one data item."
      : !scopeOk
        ? "Choose a period and an organisation unit."
        : null;
  return (
    <div className="rounded-xl border border-hair bg-surface p-4">
      <Button variant="primary" className="w-full" onClick={onRun} disabled={Boolean(blocker)} loading={running}>
        <Play className="size-4" aria-hidden />
        Run and generate report
      </Button>
      <p className="mt-2 text-xs text-muted">
        {blocker ?? `${runnable} of ${total} rule${total === 1 ? "" : "s"} will run${runnable < total ? "; incomplete ones are left out" : ""}. Read only.`}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------- templates */

const TEMPLATE_PREVIEW: Record<string, string> = {
  "Part must not exceed the whole": "ANC 4th visit ≤ ANC 1st visit",
  "Total must equal the sum of its parts": "Total = Part A + Part B + …",
  "Two sources must agree within a tolerance": "Register ≈ Summary (±5%)",
  "Rate must be within a plausible range": "0 ≤ Coverage % ≤ 100",
  "Value must be reported (not zero)": "OPD attendance > 0",
};

function TemplateGallery({
  onPick,
  compact,
}: {
  onPick: (template?: (typeof RULE_TEMPLATES)[number]) => void;
  compact: boolean;
}) {
  // Open while there are no rules; folds away once the first one exists.
  const [open, setOpen] = React.useState(!compact);
  const [wasCompact, setWasCompact] = React.useState(compact);
  if (wasCompact !== compact) {
    setWasCompact(compact);
    if (compact && open) setOpen(false);
  }

  if (!open) {
    return (
      <div className="border-b border-hair px-5 py-2.5">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
          <LayoutTemplate className="size-3.5" aria-hidden /> Start a rule from a template
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-hair bg-surface-2/40 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Sparkles className="size-4 text-accent" aria-hidden /> {compact ? "Templates" : "Start with a template"}
        </p>
        {compact ? (
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-2 hover:text-ink">
            Hide
          </button>
        ) : null}
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {RULE_TEMPLATES.map((template) => (
          <li key={template.name}>
            <button
              type="button"
              onClick={() => {
                onPick(template);
                setOpen(false);
              }}
              className="group flex h-full w-full flex-col gap-1.5 rounded-lg border border-hair bg-surface p-3 text-left transition-colors hover:border-accent"
            >
              <span className="text-sm font-medium text-ink">{template.name}</span>
              <span className="rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-ink-2 group-hover:text-ink">
                {TEMPLATE_PREVIEW[template.name] ?? template.hint}
              </span>
              <span className="text-xs text-muted">{template.hint}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => {
              onPick();
              setOpen(false);
            }}
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-hair p-3 text-sm text-ink-2 transition-colors hover:border-accent hover:text-ink"
          >
            <Plus className="size-4" aria-hidden /> Blank rule
          </button>
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ rule card */

function RuleCard({
  rule,
  index,
  count,
  editing,
  onEdit,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
  onRunOne,
}: {
  rule: DqRule;
  index: number;
  count: number;
  editing: boolean;
  onEdit: () => void;
  onChange: (change: (rule: DqRule) => DqRule) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (by: number) => void;
  onRunOne?: () => void;
}) {
  const problem = ruleProblem(rule);
  return (
    <li
      className={cn(
        "overflow-hidden rounded-xl border bg-surface transition-shadow",
        editing ? "border-accent shadow-md" : "border-hair hover:shadow-sm",
      )}
    >
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-xs font-semibold text-ink-2">
          {index + 1}
        </span>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left" aria-expanded={editing}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{rule.name}</span>
            <ImportanceChip importance={rule.importance} />
            {problem ? (
              <span className="inline-flex items-center gap-1 text-xs text-critical">
                <AlertTriangle className="size-3" aria-hidden /> {problem}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-success-text">
                <Check className="size-3" aria-hidden /> Ready
              </span>
            )}
          </span>
          <Formula rule={rule} className="mt-2" />
        </button>
        <div className="flex items-center gap-0.5">
          {onRunOne && !problem ? (
            <IconButton label="Run only this rule" onClick={onRunOne}>
              <Play className="size-3.5" />
            </IconButton>
          ) : null}
          <IconButton label={editing ? "Done editing" : "Edit"} onClick={onEdit}>
            {editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
          </IconButton>
          <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ChevronUp className="size-3.5" />
          </IconButton>
          <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ChevronDown className="size-3.5" />
          </IconButton>
          <IconButton label="Duplicate" onClick={onDuplicate}>
            <Copy className="size-3.5" />
          </IconButton>
          <IconButton label="Delete" onClick={onRemove} danger>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>
      {editing ? (
        <div className="border-t border-hair bg-surface-2/40 p-4">
          <RuleEditor rule={rule} onChange={onChange} />
        </div>
      ) : null}
    </li>
  );
}

function ImportanceChip({ importance, short }: { importance: Importance; short?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        importance === "HIGH"
          ? "border-critical/40 text-critical"
          : importance === "MEDIUM"
            ? "border-hair text-ink-2"
            : "border-hair text-muted",
      )}
    >
      {IMPORTANCE_LABELS[importance]}
      {short ? "" : " importance"}
    </span>
  );
}

/** A rule as tokens: each side's items in its own colour key, the operator large between them. */
function Formula({ rule, className }: { rule: DqRule; className?: string }) {
  const right =
    rule.op === "between" ? (
      <>
        <Tokens expression={rule.right} side="right" />
        <span className="text-xs text-ink-2">to</span>
        <ConstToken value={rule.limit} />
      </>
    ) : (
      <>
        <Tokens expression={rule.right} side="right" />
        {rule.op === "within" ? <span className="text-xs text-ink-2">± {formatNumber(rule.limit)}%</span> : null}
      </>
    );
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Tokens expression={rule.left} side="left" />
      <span className="px-1 text-lg font-semibold leading-none text-ink" aria-label={COMPARE_OPS.find((op) => op.value === rule.op)?.label}>
        {rule.op === "between" ? "∈" : opSymbol(rule.op)}
      </span>
      {right}
    </span>
  );
}

function Tokens({ expression, side }: { expression: Expression; side: "left" | "right" }) {
  if (!expression.terms.length) {
    return <span className="rounded-md border border-dashed border-hair px-2 py-0.5 text-xs text-muted">empty</span>;
  }
  return (
    <>
      {expression.terms.map((term, index) => (
        <React.Fragment key={index}>
          {index > 0 ? (
            <span className="text-sm font-semibold text-ink-2">{ARITHMETIC_OPS.find((op) => op.value === term.op)?.symbol}</span>
          ) : null}
          {term.operand.kind === "const" ? (
            <ConstToken value={term.operand.value} />
          ) : (
            <ItemToken item={term.operand.item} side={side} />
          )}
        </React.Fragment>
      ))}
    </>
  );
}

function ItemToken({ item, side, onRemove }: { item: DimensionItem; side: "left" | "right"; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex max-w-[18rem] items-center gap-1 rounded-md border py-0.5 pl-1.5 pr-1.5 text-xs text-ink"
      style={{
        borderColor: `color-mix(in oklab, ${SIDE_COLOR[side]} 45%, transparent)`,
        background: `color-mix(in oklab, ${SIDE_COLOR[side]} 10%, var(--surface))`,
      }}
      title={`${item.displayName} · ${item.id}`}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: SIDE_COLOR[side] }} />
      <span className="truncate">{item.displayName}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${item.displayName}`} className="ml-0.5 rounded p-0.5 text-muted hover:text-critical">
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

function ConstToken({ value, onRemove }: { value: number; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-hair bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-ink">
      {formatNumber(value)}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label="Remove number" className="rounded p-0.5 text-muted hover:text-critical">
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-30",
        danger ? "hover:text-critical" : "hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- editor */

function RuleEditor({ rule, onChange }: { rule: DqRule; onChange: (change: (rule: DqRule) => DqRule) => void }) {
  const set = (patch: Partial<DqRule>) => onChange((current) => ({ ...current, ...patch }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <Label htmlFor={`${rule.id}-name`}>Rule name</Label>
          <Input id={`${rule.id}-name`} className="mt-1" value={rule.name} onChange={(event) => set({ name: event.target.value })} />
        </div>
        <div>
          <Label>Importance</Label>
          <Segmented
            className="mt-1"
            ariaLabel="Importance"
            value={rule.importance}
            onChange={(importance) => set({ importance })}
            options={IMPORTANCES.map((importance) => ({ value: importance, label: IMPORTANCE_LABELS[importance] }))}
          />
        </div>
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <SideEditor
          title="Left side"
          side="left"
          expression={rule.left}
          onChange={(left) => set({ left })}
        />
        <OpPicker rule={rule} onChange={set} />
        <SideEditor
          title={rule.op === "between" ? "Lower bound" : "Right side"}
          side="right"
          expression={rule.right}
          onChange={(right) => set({ right })}
        />
      </div>

      <div>
        <Label>When a value is missing</Label>
        <div className="mt-1 grid gap-2 md:grid-cols-3">
          {MISSING_STRATEGIES.map((strategy) => (
            <button
              key={strategy.value}
              type="button"
              onClick={() => set({ missing: strategy.value })}
              aria-pressed={rule.missing === strategy.value}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                rule.missing === strategy.value ? "border-accent bg-accent/5" : "border-hair bg-surface hover:border-ink-2/40",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                {rule.missing === strategy.value ? <Check className="size-3 text-accent" aria-hidden /> : null}
                {strategy.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">{strategy.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-ink">
        <span className="text-ink-2">In words: </span>
        {describeRule(rule, 80)}
      </p>
    </div>
  );
}

function OpPicker({ rule, onChange }: { rule: DqRule; onChange: (patch: Partial<DqRule>) => void }) {
  return (
    <div className="flex flex-col items-stretch gap-2 rounded-lg border border-hair bg-surface p-3 xl:w-44">
      <p className="text-xs font-medium text-ink-2">Must be</p>
      <div className="grid grid-cols-4 gap-1">
        {COMPARE_OPS.map((op) => (
          <button
            key={op.value}
            type="button"
            title={op.label}
            aria-label={op.label}
            aria-pressed={rule.op === op.value}
            onClick={() => onChange({ op: op.value })}
            className={cn(
              "grid h-9 place-items-center rounded-md border text-base font-semibold transition-colors",
              rule.op === op.value ? "border-accent bg-accent text-accent-ink" : "border-hair bg-surface-2 text-ink hover:border-accent",
            )}
          >
            {op.value === "between" ? "∈" : op.symbol}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted">{COMPARE_OPS.find((op) => op.value === rule.op)?.label}</p>
      {rule.op === "within" || rule.op === "between" ? (
        <div>
          <Label htmlFor={`${rule.id}-limit`} className="text-[11px]">
            {rule.op === "within" ? "Tolerance %" : "Upper bound"}
          </Label>
          <Input
            id={`${rule.id}-limit`}
            className="mt-1 h-8 text-sm"
            type="number"
            step="any"
            value={Number.isFinite(rule.limit) ? rule.limit : ""}
            onChange={(event) => onChange({ limit: event.target.value === "" ? Number.NaN : Number(event.target.value) })}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One side of a rule: its terms as tokens with the operator between each
 * pair changeable in place, an inline search that adds item after item
 * without closing, and a box for numbers.
 */
function SideEditor({
  title,
  side,
  expression,
  onChange,
}: {
  title: string;
  side: "left" | "right";
  expression: Expression;
  onChange: (expression: Expression) => void;
}) {
  const [joinWith, setJoinWith] = React.useState<ArithmeticOp>("+");
  const [constant, setConstant] = React.useState("");
  const ids = new Set(expression.terms.flatMap((term) => (term.operand.kind === "item" ? [term.operand.item.id] : [])));

  const add = (operand: Expression["terms"][number]["operand"]) =>
    onChange({ terms: [...expression.terms, { op: joinWith, operand }] });
  const setOp = (index: number, op: ArithmeticOp) =>
    onChange({ terms: expression.terms.map((term, i) => (i === index ? { ...term, op } : term)) });
  const remove = (index: number) => onChange({ terms: expression.terms.filter((_, i) => i !== index) });

  function addConstant() {
    const value = Number(constant);
    if (!constant.trim() || !Number.isFinite(value)) return;
    add({ kind: "const", value });
    setConstant("");
  }

  return (
    <div
      className="rounded-lg border bg-surface p-3"
      style={{ borderColor: `color-mix(in oklab, ${SIDE_COLOR[side]} 35%, var(--hair))` }}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
        <span aria-hidden className="size-2 rounded-full" style={{ background: SIDE_COLOR[side] }} />
        {title}
      </p>

      <div className="mt-2 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md bg-surface-2/60 p-2">
        {expression.terms.length ? (
          expression.terms.map((term, index) => (
            <React.Fragment key={`${index}-${term.operand.kind === "item" ? term.operand.item.id : term.operand.value}`}>
              {index > 0 ? (
                <select
                  aria-label="Operator"
                  className="h-6 rounded border border-hair bg-surface px-0.5 text-sm font-semibold text-ink"
                  value={term.op}
                  onChange={(event) => setOp(index, event.target.value as ArithmeticOp)}
                >
                  {ARITHMETIC_OPS.map((op) => (
                    <option key={op.value} value={op.value} title={op.label}>
                      {op.symbol}
                    </option>
                  ))}
                </select>
              ) : null}
              {term.operand.kind === "const" ? (
                <ConstToken value={term.operand.value} onRemove={() => remove(index)} />
              ) : (
                <ItemToken item={term.operand.item} side={side} onRemove={() => remove(index)} />
              )}
            </React.Fragment>
          ))
        ) : (
          <span className="text-xs text-muted">Search below to add data elements or indicators.</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-[11px] text-muted">Join next with</span>
        <div className="flex overflow-hidden rounded-md border border-hair" role="group" aria-label="Operator for the next term">
          {ARITHMETIC_OPS.map((op) => (
            <button
              key={op.value}
              type="button"
              title={op.label}
              aria-pressed={joinWith === op.value}
              onClick={() => setJoinWith(op.value)}
              className={cn(
                "h-7 w-7 text-sm font-semibold transition-colors",
                joinWith === op.value ? "bg-accent text-accent-ink" : "bg-surface text-ink-2 hover:bg-surface-2",
              )}
            >
              {op.symbol}
            </button>
          ))}
        </div>
      </div>

      <ItemSearch selected={ids} onAdd={(item) => add({ kind: "item", item })} />

      <div className="mt-2 flex items-center gap-1.5">
        <Input
          aria-label="A number"
          className="h-8 flex-1 text-xs"
          type="number"
          step="any"
          placeholder="Or a number, e.g. 100"
          value={constant}
          onChange={(event) => setConstant(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addConstant();
            }
          }}
        />
        <Button size="sm" variant="secondary" onClick={addConstant} disabled={!constant.trim()}>
          <Hash className="size-3.5" aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}

type SearchRecord = IdName & { dimensionItemType?: string };

const TYPE_TAGS: Record<string, string> = {
  INDICATOR: "Indicator",
  DATA_ELEMENT: "Data element",
  PROGRAM_INDICATOR: "Program indicator",
  REPORTING_RATE: "Reporting rate",
  PROGRAM_DATA_ELEMENT: "Event data item",
  PROGRAM_ATTRIBUTE: "Event attribute",
};

/** Search-as-you-type that stays open, so several items go in one after another. */
function ItemSearch({ selected, onAdd }: { selected: Set<string>; onAdd: (item: DimensionItem) => void }) {
  const [source, setSource] = React.useState<MetadataResource>("dataItems");
  const [term, setTerm] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const debounced = useDebounced(term, 300);
  const option = findDataSource(source);
  const open = focused || term.length > 0;

  const results = useAsyncData(
    (signal) =>
      open
        ? searchMetadata<SearchRecord>(source, { query: debounced, fields: option.fields, pageSize: 20, signal })
        : Promise.resolve({ items: [] as SearchRecord[] }),
    [source, debounced, open],
  );

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        <Select
          aria-label="Type of item"
          className="h-8 w-40 shrink-0 text-xs"
          value={source}
          onChange={(event) => setSource(event.target.value as MetadataResource)}
        >
          {DATA_SOURCES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            aria-label="Search data items"
            className="h-8 pl-7 text-xs"
            placeholder="Search to add…"
            value={term}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTerm("");
                (event.target as HTMLInputElement).blur();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const first = results.data?.items.map((item) => toDimensionItem(option, item)).find((item) => !selected.has(item.id));
                if (first) onAdd(first);
              }
            }}
          />
        </div>
      </div>
      {open ? (
        <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-hair bg-surface shadow-sm">
          {results.loading ? (
            <p className="px-3 py-3 text-xs text-muted">Searching…</p>
          ) : results.error ? (
            <p className="px-3 py-3 text-xs text-critical">{results.error}</p>
          ) : !results.data?.items.length ? (
            <p className="px-3 py-3 text-xs text-muted">{debounced ? `Nothing matched “${debounced}”.` : "Nothing to show."}</p>
          ) : (
            <ul>
              {results.data.items.map((record) => {
                const item = toDimensionItem(option, record);
                const added = selected.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={added}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onAdd(item)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-surface-2 disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                    >
                      {added ? <Check className="size-3 shrink-0 text-accent" aria-hidden /> : <Plus className="size-3 shrink-0 text-muted" aria-hidden />}
                      <span className="flex-1 truncate">{item.displayName}</span>
                      {record.dimensionItemType ? (
                        <span className="shrink-0 text-[10px] text-muted">{TYPE_TAGS[record.dimensionItemType] ?? record.dimensionItemType}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ report */

function ReportView({
  report,
  names,
  rules,
  scopeLine,
  ranAt,
  server,
}: {
  report: DqReport;
  names: (id: string) => string;
  rules: DqRule[];
  scopeLine: string;
  ranAt: string;
  server: string;
}) {
  const [ruleView, setRuleView] = React.useState<ChartView>("chart");
  const [unitView, setUnitView] = React.useState<ChartView>("chart");
  const [periodView, setPeriodView] = React.useState<ChartView>("chart");
  const [ruleFilter, setRuleFilter] = React.useState<string>("");
  const [importanceFilter, setImportanceFilter] = React.useState<Importance | "">("");
  const [search, setSearch] = React.useState("");
  const violationsRef = React.useRef<HTMLDivElement>(null);

  const health = healthOf(report.passRate);
  const grid = React.useMemo(() => failureGrid(report), [report]);
  const unitData = report.byUnit.slice(0, MAX_BARS).map((entry) => ({ __x: entry.id, __label: entry.name, failures: entry.value }));
  const periodData = report.byPeriod.map((entry) => ({ __x: entry.id, __label: entry.name, failures: entry.value }));

  const needle = search.trim().toLowerCase();
  const violations = report.violations.filter(
    (violation) =>
      (!ruleFilter || violation.ruleId === ruleFilter) &&
      (!importanceFilter || violation.importance === importanceFilter) &&
      (!needle || `${violation.ruleName} ${names(violation.ou)} ${names(violation.pe)}`.toLowerCase().includes(needle)),
  );

  const showViolationsOf = (ruleId: string) => {
    setRuleFilter(ruleId);
    setImportanceFilter("");
    setSearch("");
    violationsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const ruleColumns: Column<DqReport["byRule"][number]>[] = [
    { key: "name", header: "Rule", render: (row) => row.rule.name, sortValue: (row) => row.rule.name },
    { key: "expr", header: "Expression", render: (row) => <span className="text-ink-2">{describeRule(row.rule, 60)}</span> },
    {
      key: "importance",
      header: "Importance",
      render: (row) => IMPORTANCE_LABELS[row.rule.importance],
      sortValue: (row) => IMPORTANCES.indexOf(row.rule.importance),
    },
    { key: "checked", header: "Checked", numeric: true, render: (row) => formatNumber(row.checked), sortValue: (row) => row.checked },
    { key: "failed", header: "Failed", numeric: true, render: (row) => formatNumber(row.failed), sortValue: (row) => row.failed },
    { key: "skipped", header: "Skipped", numeric: true, render: (row) => formatNumber(row.skipped), sortValue: (row) => row.skipped },
    { key: "rate", header: "Fail rate", numeric: true, render: (row) => pct(row.failRate), sortValue: (row) => row.failRate ?? -1 },
  ];

  const violationColumns: Column<Violation>[] = [
    {
      key: "importance",
      header: "Importance",
      render: (row) => <ImportanceChip importance={row.importance} short />,
      sortValue: (row) => IMPORTANCES.indexOf(row.importance),
    },
    { key: "rule", header: "Rule", render: (row) => row.ruleName, sortValue: (row) => row.ruleName },
    { key: "ou", header: "Organisation unit", render: (row) => names(row.ou), sortValue: (row) => names(row.ou) },
    { key: "pe", header: "Period", render: (row) => names(row.pe), sortValue: (row) => row.pe },
    { key: "left", header: "Left side", numeric: true, render: (row) => (row.left === null ? "—" : formatNumber(row.left)), sortValue: (row) => row.left ?? 0 },
    { key: "right", header: "Right side", numeric: true, render: (row) => (row.right === null ? "—" : formatNumber(row.right)), sortValue: (row) => row.right ?? 0 },
    {
      key: "diff",
      header: "Difference",
      numeric: true,
      render: (row) => (row.difference === null ? "—" : formatNumber(row.difference)),
      sortValue: (row) => row.difference ?? 0,
    },
    {
      key: "gap",
      header: "Gap",
      numeric: true,
      render: (row) => <GapCell share={row.gapShare} />,
      sortValue: (row) => row.gapShare ?? -1,
    },
  ];

  const ran = new Date(ranAt);

  return (
    <article className="space-y-5" aria-label="Data quality report">
      {/* ------------------------------------------------ hero */}
      <section className="overflow-hidden rounded-xl border border-hair bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hair px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Data quality report</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">{scopeLine}</h2>
            <p className="mt-0.5 text-xs text-ink-2">
              Generated {ran.toLocaleString()} from {server} · {report.rules} rule{report.rules === 1 ? "" : "s"}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => window.print()} title="Print, or save as PDF from the print dialog">
              <Printer className="size-3.5" aria-hidden /> Print / PDF
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => downloadCsv(reportText(report, scopeLine, ran, server, names), `${stamped("data-quality-report")}.txt`)}
              title="The report as plain text, for email or WhatsApp"
            >
              <FileText className="size-3.5" aria-hidden /> Text
            </Button>
          </div>
        </div>

        <div className="grid gap-6 p-5 md:grid-cols-[200px_minmax(0,1fr)]">
          <HealthRing passRate={report.passRate} health={health} />
          <div>
            <h3 className="text-sm font-semibold text-ink">Findings</h3>
            <ul className="mt-2 space-y-2">
              {report.findings.map((line, index) => (
                <li key={index} className="flex gap-2 text-sm leading-relaxed text-ink">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Every sentence is written from the figures on this page. A failure is a question for the facility, not proof
              of an error: check the register before correcting.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-hair sm:grid-cols-4">
          <Metric label="Checks made" value={report.checked} hint={`${report.units} units · ${report.periods} periods`} />
          <Metric label="Passed" value={report.passed} hint="Rule held" color={STATE_COLOR.pass} icon={<CheckCircle2 className="size-3.5" />} />
          <Metric label="Failed" value={report.failed} hint={`${report.byImportance.HIGH} high importance`} color={STATE_COLOR.fail} icon={<XCircle className="size-3.5" />} />
          <Metric label="Skipped" value={report.skipped} hint="Values missing" color={STATE_COLOR.skipped} icon={<CircleDashed className="size-3.5" />} />
        </div>
      </section>

      {/* ------------------------------------------------ by rule */}
      <ChartFrame
        title="Results by rule"
        description="Passed, failed and skipped checks for each rule"
        view={ruleView}
        onViewChange={setRuleView}
        onDownload={() => downloadCsv(ruleSummaryToCsv(report), `${stamped("dq-rules")}.csv`)}
        footnote={
          <span className="text-muted">
            Each bar is one rule&apos;s checks: passed, failed and skipped, as counts. The fail rate is failures ÷ checks made;
            skipped unit-periods are left out of it, not counted as passes.
          </span>
        }
      >
        {ruleView === "table" ? (
          <DataTable columns={ruleColumns} rows={report.byRule} maxHeight={420} emptyMessage="No rules." />
        ) : (
          <div className="space-y-3 px-1 py-1">
            <StateLegend />
            <ul className="space-y-3">
              {report.byRule.map((entry) => (
                <li key={entry.rule.id} className="rounded-lg border border-hair p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        {entry.rule.name} <ImportanceChip importance={entry.rule.importance} />
                      </p>
                      <Formula rule={entry.rule} className="mt-1.5" />
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums text-ink">{pct(entry.failRate)}</p>
                      <p className="text-[11px] text-muted">failed</p>
                    </div>
                  </div>
                  <StackedBar passed={entry.checked - entry.failed} failed={entry.failed} skipped={entry.skipped} />
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
                    <span className="tabular-nums">
                      {formatNumber(entry.checked - entry.failed)} passed · {formatNumber(entry.failed)} failed · {formatNumber(entry.skipped)} skipped
                    </span>
                    {entry.failed ? (
                      <button type="button" onClick={() => showViolationsOf(entry.rule.id)} className="no-print font-medium text-accent hover:underline">
                        See {formatNumber(entry.failed)} violation{entry.failed === 1 ? "" : "s"} →
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-success-text">
                        <Check className="size-3" aria-hidden /> No failures
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ChartFrame>

      {report.failed ? (
        <>
          {/* -------------------------------------------- heatmap */}
          <ChartFrame
            title="Where and when failures happen"
            description="Failed checks per organisation unit and period, every rule together"
            footnote={
              <span className="text-muted">
                Each cell counts the failed checks for that unit in that period, all rules together; darker is more. An empty
                cell had none. Units are ordered by total failures
                {grid.hiddenUnits ? `; the ${grid.hiddenUnits} with fewest are left out here and listed in the table below` : ""}.
              </span>
            }
            legend={<ScaleLegend min={0} max={grid.max} stops={heatScaleStops(5)} format={formatNumber} />}
          >
            <Heatmap grid={grid} />
          </ChartFrame>

          <div className="grid gap-5 xl:grid-cols-2">
            <ChartFrame
              title="Failures by organisation unit"
              description="Failed checks, every rule together, highest first"
              view={unitView}
              onViewChange={setUnitView}
              onDownload={() =>
                downloadCsv(
                  ["Organisation unit,Failures", ...report.byUnit.map((entry) => `"${entry.name.replace(/"/g, '""')}",${entry.value}`)].join("\r\n"),
                  `${stamped("dq-failures-by-unit")}.csv`,
                )
              }
              footnote={
                <span className="text-muted">
                  A count of failed checks summed over rules and periods.
                  {report.byUnit.length > MAX_BARS ? ` The chart shows the top ${MAX_BARS} of ${report.byUnit.length}; the table holds them all.` : ""}
                </span>
              }
            >
              {unitView === "table" ? (
                <CountTable rows={report.byUnit} title="Organisation unit" />
              ) : (
                <CategoryBarChart
                  data={unitData}
                  series={COUNT_SERIES}
                  orientation="bars"
                  height={Math.max(140, unitData.length * 28 + 40)}
                  valueFormatter={formatNumber}
                />
              )}
            </ChartFrame>

            <ChartFrame
              title="Failures by period"
              description="Failed checks, every rule and unit together"
              view={periodView}
              onViewChange={setPeriodView}
              footnote={<span className="text-muted">A count of failed checks per period; a period with none is drawn at zero.</span>}
            >
              {periodView === "table" || periodData.length < 2 ? (
                <CountTable rows={report.byPeriod} title="Period" />
              ) : (
                <TimeSeriesChart data={periodData} series={COUNT_SERIES} valueFormatter={formatNumber} />
              )}
            </ChartFrame>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-hair bg-surface px-5 py-6">
          <CheckCircle2 className="size-6 shrink-0" style={{ color: STATE_COLOR.pass }} aria-hidden />
          <div>
            <p className="font-medium text-ink">No failures</p>
            <p className="text-sm text-ink-2">Every check that could be made passed.</p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ violations */}
      <div ref={violationsRef} className="scroll-mt-20">
        <ChartFrame
          title="Violations"
          description={`${formatNumber(violations.length)} of ${formatNumber(report.violations.length)} failed checks, most important first, then the largest gap`}
          onDownload={report.violations.length ? () => downloadCsv(violationsToCsv(violations, rules, names), `${stamped("dq-violations")}.csv`) : undefined}
          toolbar={
            report.violations.length ? (
              <div className="no-print flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
                  <Input aria-label="Search violations" className="h-8 w-44 pl-7 text-xs" placeholder="Unit, period, rule…" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
                <Select aria-label="Importance" className="h-8 w-40 text-xs" value={importanceFilter} onChange={(event) => setImportanceFilter(event.target.value as Importance | "")}>
                  <option value="">Any importance</option>
                  {IMPORTANCES.map((importance) => (
                    <option key={importance} value={importance}>
                      {IMPORTANCE_LABELS[importance]} ({report.byImportance[importance]})
                    </option>
                  ))}
                </Select>
                {report.byRule.length > 1 ? (
                  <Select aria-label="Rule" className="h-8 max-w-52 text-xs" value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)}>
                    <option value="">All rules</option>
                    {report.byRule.map((entry) => (
                      <option key={entry.rule.id} value={entry.rule.id}>
                        {entry.rule.name} ({entry.failed})
                      </option>
                    ))}
                  </Select>
                ) : null}
                {ruleFilter || importanceFilter || search ? (
                  <Button size="sm" variant="ghost" onClick={() => { setRuleFilter(""); setImportanceFilter(""); setSearch(""); }}>
                    <X className="size-3.5" aria-hidden /> Clear
                  </Button>
                ) : null}
              </div>
            ) : null
          }
          footnote={
            <span className="text-muted">
              Left and right are each side&apos;s value for the unit and period; the gap is how far the rule was missed as a share of
              the larger figure.
              {violations.length > MAX_VIOLATION_ROWS ? ` The table shows the first ${MAX_VIOLATION_ROWS} of ${violations.length}; the CSV holds them all.` : ""}
            </span>
          }
        >
          <DataTable
            columns={violationColumns}
            rows={violations.slice(0, MAX_VIOLATION_ROWS)}
            maxHeight={560}
            emptyMessage={report.violations.length ? "No violation matches the filters." : "No violations: every check that could be made passed."}
          />
        </ChartFrame>
      </div>
    </article>
  );
}

function HealthRing({ passRate, health }: { passRate: number | null; health: Health }) {
  const { color, Icon } = HEALTH_STYLE[health];
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const share = passRate ?? 0;
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div className="relative size-36">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={`Pass rate ${pct(passRate)}, ${HEALTH_LABELS[health]}`}>
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${circumference * share} ${circumference}`}
            style={{ transition: "stroke-dasharray 700ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink">{passRate === null ? "—" : `${(passRate * 100).toFixed(1)}%`}</p>
            <p className="text-[11px] text-muted">pass rate</p>
          </div>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink">
        <Icon className="size-3.5" style={{ color }} aria-hidden />
        {HEALTH_LABELS[health]}
      </span>
      <p className="text-center text-[11px] leading-snug text-muted">Good ≥ 95% · attention ≥ 85%</p>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  color,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="border-hair px-5 py-3 [&:not(:first-child)]:border-l">
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        {icon ? <span style={{ color }}>{icon}</span> : null}
        {label}
      </p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{formatNumber(value)}</p>
      <p className="text-[11px] text-muted">{hint}</p>
    </div>
  );
}

function StateLegend() {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-ink-2" aria-label="Key">
      {(
        [
          ["pass", "Passed"],
          ["fail", "Failed"],
          ["skipped", "Skipped (values missing)"],
        ] as const
      ).map(([key, label]) => (
        <li key={key} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: STATE_COLOR[key], opacity: key === "skipped" ? 0.45 : 1 }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** One rule's checks as a single bar, segments separated by a surface gap. */
function StackedBar({ passed, failed, skipped }: { passed: number; failed: number; skipped: number }) {
  const total = passed + failed + skipped;
  if (!total) return <div className="mt-3 h-2.5 rounded-full bg-surface-3" />;
  const segments = [
    { key: "pass", value: passed, color: STATE_COLOR.pass, opacity: 1 },
    { key: "fail", value: failed, color: STATE_COLOR.fail, opacity: 1 },
    { key: "skipped", value: skipped, color: STATE_COLOR.skipped, opacity: 0.45 },
  ].filter((segment) => segment.value > 0);
  return (
    <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
      {segments.map((segment) => (
        <span
          key={segment.key}
          style={{ width: `${(segment.value / total) * 100}%`, background: segment.color, opacity: segment.opacity, minWidth: 3 }}
        />
      ))}
    </div>
  );
}

function GapCell({ share }: { share: number | null }) {
  if (share === null) return <span className="text-muted">—</span>;
  const width = Math.min(100, share * 100);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-surface-3 sm:inline-block" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${width}%`, background: "var(--accent)" }} />
      </span>
      <span className="tabular-nums">{pct(share)}</span>
    </span>
  );
}

function Heatmap({ grid }: { grid: ReturnType<typeof failureGrid> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface px-2 py-1 text-left font-medium text-ink-2">Organisation unit</th>
            {grid.periods.map((period) => (
              <th key={period.id} className="px-1 py-1 text-center font-medium text-ink-2" title={period.name}>
                <span className="block whitespace-nowrap">{period.name}</span>
              </th>
            ))}
            <th className="px-2 py-1 text-right font-medium text-ink-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {grid.units.map((unit) => (
            <tr key={unit.id}>
              <th scope="row" className="sticky left-0 max-w-56 truncate bg-surface px-2 py-1 text-left font-normal text-ink" title={unit.name}>
                {unit.name}
              </th>
              {grid.periods.map((period) => {
                const value = grid.cells.get(`${unit.id}|${period.id}`) ?? 0;
                return (
                  <td
                    key={period.id}
                    className="h-8 min-w-12 rounded text-center tabular-nums text-ink"
                    style={{ background: value ? heatFill(value, 0, grid.max) : "var(--surface-2)" }}
                    title={`${unit.name}, ${period.name}: ${value} failed check${value === 1 ? "" : "s"}`}
                  >
                    {value || ""}
                  </td>
                );
              })}
              <td className="px-2 text-right font-medium tabular-nums text-ink">{formatNumber(unit.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountTable({ rows, title }: { rows: { id: string; name: string; value: number }[]; title: string }) {
  return (
    <DataTable
      columns={[
        { key: "name", header: title, render: (row: (typeof rows)[number]) => row.name, sortValue: (row: (typeof rows)[number]) => row.name },
        { key: "value", header: "Failures", numeric: true, render: (row: (typeof rows)[number]) => formatNumber(row.value), sortValue: (row: (typeof rows)[number]) => row.value },
      ]}
      rows={rows}
      maxHeight={420}
      emptyMessage="No failures."
    />
  );
}

/** The report as plain text, for an email or a WhatsApp message. */
function reportText(report: DqReport, scopeLine: string, ran: Date, server: string, names: (id: string) => string): string {
  const lines = [
    "DATA QUALITY REPORT",
    scopeLine,
    `Generated ${ran.toLocaleString()} from ${server}`,
    `Pass rate: ${pct(report.passRate)} (${HEALTH_LABELS[healthOf(report.passRate)]})`,
    "",
    "FINDINGS",
    ...report.findings.map((line) => `- ${line}`),
    "",
    "RESULTS BY RULE",
    ...report.byRule.map(
      (entry) =>
        `- ${entry.rule.name} [${entry.rule.importance}] ${describeRule(entry.rule, 80)}: ${entry.failed} failed of ${entry.checked} checked (${pct(entry.failRate)}), ${entry.skipped} skipped`,
    ),
  ];
  if (report.violations.length) {
    lines.push("", "TOP VIOLATIONS");
    for (const violation of report.violations.slice(0, 20)) {
      lines.push(
        `- ${violation.ruleName} at ${names(violation.ou)}, ${names(violation.pe)}: ${violation.left === null ? "—" : formatNumber(violation.left)} against ${violation.right === null ? "—" : formatNumber(violation.right)}`,
      );
    }
  }
  return lines.join("\r\n");
}
