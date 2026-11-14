/**
 * Event programs shown as their own tabs.
 *
 * An event program is a form that is filled in once per occurrence — an
 * assessment, an audit entry — with no person enrolled. DHIS2 answers two
 * questions about one: how many events there were, per period and per
 * organisation unit (the events *aggregate* analytics), and what each event
 * recorded (the events *query* analytics). Both are reads under `analytics/`,
 * which the proxy already allows; nothing here can create or change an event.
 *
 * The response shapes are parsed here, once, into plain rows, and the page is
 * built from those. Header names changed in DHIS2 2.41 (`psi` became `event`,
 * `eventdate` became `occurreddate`), so both spellings are read.
 */
import { parseAnalytics, rowsToCsv, type ParsedAnalytics } from "./analytics";
import { periodSortKey } from "../format";
import { PROGRAM_ITEMS } from "./program-items";
import type { AnalyticsResponse } from "./types";

/* ----------------------------------------------------------------- tabs */

export interface ProgramTab {
  /** The DHIS2 program id. */
  id: string;
  /** The path segment under /programs/. */
  slug: string;
  /** The nav tab, short. */
  label: string;
  /** The program's full display name. */
  name: string;
  /** What the tab is for, in one line. */
  description: string;
}

/**
 * The programs with a tab of their own. Both are event programs
 * (WITHOUT_REGISTRATION) on the GHS server; the ids are DHIS2's.
 */
export const PROGRAM_TABS: readonly ProgramTab[] = [
  {
    id: "DQAIauditP1",
    slug: "dq-ai-audit-trail",
    label: "DQ-AI Audit",
    name: "DQ-AI Audit Trail",
    description:
      "Every entry the DQ-AI audit trail has recorded: how many, where and when, and what each one holds.",
  },
  {
    id: "GHSRDQAprog",
    slug: "rdqa",
    label: "RDQA",
    name: "GHS Routine Data Quality Assessment",
    description:
      "Routine data quality assessments as submitted: how many, where and when, and what each assessment recorded.",
  },
];

export function findProgramTab(slug: string): ProgramTab | undefined {
  return PROGRAM_TABS.find((tab) => tab.slug === slug);
}

/* ------------------------------------------------------------- metadata */

export interface ProgramDataElement {
  id: string;
  name: string;
  valueType: string;
  /** Option code to its name, when the element has an option set. */
  options?: Record<string, string>;
}

export interface ProgramStage {
  id: string;
  name: string;
  dataElements: ProgramDataElement[];
}

export interface ProgramMeta {
  id: string;
  name: string;
  programType: string;
  lastUpdated: string | null;
  stages: ProgramStage[];
}

export function buildProgramPath(programId: string): string {
  const fields = [
    "id",
    "displayName",
    "programType",
    "lastUpdated",
    "programStages[id,displayName,sortOrder,programStageDataElements[sortOrder,dataElement[id,displayName,valueType,optionSet[options[code,displayName]]]]]",
  ].join(",");
  return `programs/${encodeURIComponent(programId)}?fields=${encodeURIComponent(fields)}`;
}

interface RawProgram {
  id: string;
  displayName?: string;
  name?: string;
  programType?: string;
  lastUpdated?: string;
  programStages?: {
    id: string;
    displayName?: string;
    name?: string;
    sortOrder?: number;
    programStageDataElements?: {
      sortOrder?: number;
      dataElement?: {
        id: string;
        displayName?: string;
        name?: string;
        valueType?: string;
        optionSet?: { options?: { code?: string; displayName?: string; name?: string }[] };
      };
    }[];
  }[];
}

export function parseProgram(raw: RawProgram): ProgramMeta {
  const stages = [...(raw.programStages ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((stage) => ({
      id: stage.id,
      name: stage.displayName ?? stage.name ?? stage.id,
      dataElements: [...(stage.programStageDataElements ?? [])]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .flatMap((entry) => {
          const element = entry.dataElement;
          if (!element?.id) return [];
          const options = element.optionSet?.options;
          const parsed: ProgramDataElement = {
            id: element.id,
            name: element.displayName ?? element.name ?? element.id,
            valueType: element.valueType ?? "TEXT",
          };
          if (options?.length) {
            parsed.options = Object.fromEntries(
              options
                .filter((option) => option.code)
                .map((option) => [option.code!, option.displayName ?? option.name ?? option.code!]),
            );
          }
          return [parsed];
        }),
    }));

  return {
    id: raw.id,
    name: raw.displayName ?? raw.name ?? raw.id,
    programType: raw.programType ?? "",
    lastUpdated: raw.lastUpdated ?? null,
    stages,
  };
}

/**
 * What to do about a rejected event analytics request, when the reason DHIS2
 * gave points at one of the two usual causes. Null when it does not.
 */
export function explainEventError(message: string): string | null {
  const text = message.toLowerCase();
  if (
    text.includes("analytics table") ||
    text.includes("table does not exist") ||
    text.includes("e7131") ||
    text.includes("relation") && text.includes("does not exist")
  ) {
    return "The event analytics tables for this program have not been generated since it was created. In DHIS2, run Data Administration → Analytics tables with event tables included, then try again.";
  }
  if (
    text.includes("not allowed to view") ||
    text.includes("not authorized") ||
    text.includes("no access") ||
    text.includes("e7121") ||
    text.includes("e7122") ||
    text.includes("e7123")
  ) {
    return "The token's account cannot see this program. In DHIS2, give it metadata and data read access to the program through Sharing settings.";
  }
  return null;
}

/** The program type as a reader would say it. */
export function describeProgramType(programType: string): string {
  if (programType === "WITHOUT_REGISTRATION") return "Event program";
  if (programType === "WITH_REGISTRATION") return "Tracker program";
  return programType || "Program";
}

/* ------------------------------------------------------------ analytics */

export interface EventScope {
  /** Period ids, relative or fixed. */
  periods: string[];
  /** Organisation unit dimension items: ids, LEVEL-n and USER_ORGUNIT tokens. */
  orgUnits: string[];
  /** Restrict to one stage; needed to ask for data elements. */
  stage?: string | null;
}

export function isEventScopeRunnable(scope: EventScope): boolean {
  return scope.periods.length > 0 && scope.orgUnits.length > 0;
}

function stageParam(stage: string | null | undefined): string[] {
  return stage ? [`stage=${encodeURIComponent(stage)}`] : [];
}

function dimensionParams(scope: EventScope): string[] {
  return [
    `dimension=${encodeURIComponent(`pe:${scope.periods.join(";")}`)}`,
    `dimension=${encodeURIComponent(`ou:${scope.orgUnits.join(";")}`)}`,
  ];
}

/**
 * Event counts per period and organisation unit. `outputType=EVENT` counts
 * events — a unit that recorded two assessments counts twice — which is the
 * only honest count for a program nobody is enrolled in.
 */
export function buildEventAggregatePath(programId: string, scope: EventScope): string {
  const params = [
    ...dimensionParams(scope),
    ...stageParam(scope.stage),
    "outputType=EVENT",
    "displayProperty=NAME",
    "skipMeta=false",
  ];
  return `analytics/events/aggregate/${encodeURIComponent(programId)}?${params.join("&")}`;
}

export interface EventQueryOptions extends EventScope {
  stage: string;
  dataElements: string[];
  page: number;
  pageSize: number;
}

/**
 * One page of events, most recently changed first, with the stage's values.
 * An empty stage leaves the stage out: DHIS2 then takes a single-stage
 * program's only stage, which lets the list work when the program definition
 * could not be read.
 */
export function buildEventQueryPath(programId: string, options: EventQueryOptions): string {
  const params = [
    ...stageParam(options.stage),
    ...dimensionParams(options),
    ...options.dataElements.map((id) => `dimension=${encodeURIComponent(id)}`),
    "outputType=EVENT",
    "displayProperty=NAME",
    "desc=lastupdated",
    `page=${Math.max(1, Math.floor(options.page))}`,
    `pageSize=${Math.max(1, Math.floor(options.pageSize))}`,
    "totalPages=true",
  ];
  return `analytics/events/query/${encodeURIComponent(programId)}?${params.join("&")}`;
}

/* ---------------------------------------------------------------- counts */

export interface CountedItem {
  id: string;
  name: string;
  value: number;
}

export interface EventCounts {
  total: number;
  /** In time order. */
  byPeriod: CountedItem[];
  /** Highest first. */
  byOrgUnit: CountedItem[];
}

/** Sum the aggregate rows into the three readings the page shows. */
export function countEvents(parsed: ParsedAnalytics): EventCounts {
  const periods = new Map<string, number>();
  const units = new Map<string, number>();
  let total = 0;
  for (const row of parsed.rows) {
    const pe = String(row.pe ?? "");
    const ou = String(row.ou ?? "");
    total += row.value;
    if (pe) periods.set(pe, (periods.get(pe) ?? 0) + row.value);
    if (ou) units.set(ou, (units.get(ou) ?? 0) + row.value);
  }
  const named = (map: Map<string, number>) =>
    [...map.entries()].map(([id, value]) => ({
      id,
      name: parsed.labels[id] ?? id,
      value,
    }));
  return {
    total,
    byPeriod: named(periods).sort((a, b) =>
      periodSortKey(a.id).localeCompare(periodSortKey(b.id)),
    ),
    byOrgUnit: named(units).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
  };
}

export function parseEventCounts(response: AnalyticsResponse): EventCounts {
  return countEvents(parseAnalytics(response));
}

/* ---------------------------------------------------------------- events */

export interface EventColumn {
  id: string;
  name: string;
}

export interface EventRecord {
  id: string;
  /** The event date as DHIS2 gives it, `YYYY-MM-DD` or a full timestamp. */
  date: string;
  orgUnit: string;
  status: string;
  /** Data element id to the value shown (option names resolved). */
  values: Record<string, string>;
}

export interface EventPage {
  columns: EventColumn[];
  rows: EventRecord[];
  page: number;
  pageSize: number;
  total: number | null;
  pageCount: number | null;
}

export interface EventQueryResponse {
  headers?: { name: string; column?: string; valueType?: string; meta?: boolean }[];
  rows?: string[][];
  metaData?: {
    items?: Record<string, { name?: string }>;
    pager?: { page?: number; pageSize?: number; total?: number; pageCount?: number; isLastPage?: boolean };
  };
}

const EVENT_ID_HEADERS = ["event", "psi"];
const EVENT_DATE_HEADERS = ["occurreddate", "eventdate"];
const FIXED_HEADERS = new Set([
  ...EVENT_ID_HEADERS,
  ...EVENT_DATE_HEADERS,
  "ps",
  "programstage",
  "ou",
  "ouname",
  "oucode",
  "ounamehierarchy",
  "eventstatus",
  "programstatus",
  "storedby",
  "createdbydisplayname",
  "lastupdatedbydisplayname",
  "created",
  "lastupdated",
  "scheduleddate",
  "duedate",
  "enrollmentdate",
  "incidentdate",
  "tei",
  "trackedentity",
  "pi",
  "enrollment",
  "geometry",
  "longitude",
  "latitude",
]);

/**
 * One page of the events query as records.
 *
 * `dataElements` names the columns and resolves option codes to their names;
 * a column DHIS2 returns that the stage does not list is kept under its own
 * header so nothing is silently dropped.
 */
export function parseEventPage(
  response: EventQueryResponse,
  dataElements: ProgramDataElement[],
  fallback: { page: number; pageSize: number },
): EventPage {
  const headers = response.headers ?? [];
  const index = (names: string[]) => headers.findIndex((header) => names.includes(header.name));
  const idAt = index(EVENT_ID_HEADERS);
  const dateAt = index(EVENT_DATE_HEADERS);
  const ouNameAt = index(["ouname"]);
  const ouAt = index(["ou"]);
  const statusAt = index(["eventstatus"]);

  const known = new Map(dataElements.map((element) => [element.id, element]));
  const columns: EventColumn[] = [];
  const valueColumns: { id: string; at: number }[] = [];
  headers.forEach((header, at) => {
    if (FIXED_HEADERS.has(header.name)) return;
    const element = known.get(header.name);
    columns.push({ id: header.name, name: element?.name ?? header.column ?? header.name });
    valueColumns.push({ id: header.name, at });
  });

  const rows: EventRecord[] = (response.rows ?? []).map((raw, rowIndex) => {
    const values: Record<string, string> = {};
    for (const { id, at } of valueColumns) {
      const cell = raw[at] ?? "";
      const element = known.get(id);
      values[id] = element?.options?.[cell] ?? cell;
    }
    return {
      id: (idAt >= 0 ? raw[idAt] : "") || `row-${rowIndex}`,
      date: dateAt >= 0 ? (raw[dateAt] ?? "") : "",
      orgUnit:
        (ouNameAt >= 0 ? raw[ouNameAt] : "") ||
        (ouAt >= 0 ? (response.metaData?.items?.[raw[ouAt]]?.name ?? raw[ouAt]) : "") ||
        "",
      status: statusAt >= 0 ? (raw[statusAt] ?? "") : "",
      values,
    };
  });

  const pager = response.metaData?.pager;
  return {
    columns,
    rows,
    page: pager?.page ?? fallback.page,
    pageSize: pager?.pageSize ?? fallback.pageSize,
    total: pager?.total ?? null,
    pageCount: pager?.pageCount ?? null,
  };
}

/** The event date as a day, whatever precision DHIS2 used. */
export function eventDay(date: string): string {
  return date.slice(0, 10);
}

export function eventsToCsv(page: EventPage): string {
  const header = ["Event date", "Organisation unit", "Status", ...page.columns.map((c) => c.name)];
  const rows = page.rows.map((row) => [
    eventDay(row.date),
    row.orgUnit,
    row.status,
    ...page.columns.map((column) => row.values[column.id] ?? ""),
  ]);
  return rowsToCsv(header, rows);
}

export function countsToCsv(items: CountedItem[], title: string): string {
  return rowsToCsv(
    [title, "Events"],
    items.map((item) => [item.name, String(item.value)]),
  );
}

/* ------------------------------------------------------------- catalogue */

/**
 * One event data item as the Metadata page exports it: the id a query is
 * written with, the code the program's authors gave it, and its value type.
 * The catalogue (program-items.ts, generated from that export) is what lets
 * a tab name, group and link its items before DHIS2 has answered, and still
 * when the program definition cannot be read.
 */
export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  valueType: string;
  kind: "dataElement" | "attribute";
}

export function catalogFor(programId: string): readonly CatalogItem[] {
  return PROGRAM_ITEMS[programId] ?? [];
}

/** The analytics id of an item: program.item, what the Metadata export lists as UID. */
export function qualifiedItemId(programId: string, itemId: string): string {
  return `${programId}.${itemId}`;
}

/**
 * Find an item by whatever a reader has to hand: its id, its program.item id,
 * or its code, in any case.
 */
export function findCatalogItem(programId: string, query: string): CatalogItem | undefined {
  const wanted = query.trim();
  if (!wanted) return undefined;
  const bare = wanted.includes(".") ? wanted.slice(wanted.indexOf(".") + 1) : wanted;
  const items = catalogFor(programId);
  return (
    items.find((item) => item.id === bare) ??
    items.find((item) => item.code.toUpperCase() === wanted.toUpperCase()) ??
    items.find((item) => item.id.toLowerCase() === bare.toLowerCase())
  );
}

/** The item's name without the program prefix its authors put on every item. */
export function shortItemName(item: Pick<CatalogItem, "name">): string {
  return item.name.replace(/^(RDQA|DQAI)\s+/, "");
}

const GROUP_ORDER = [
  "Visit",
  "Facility capacity",
  "Registers",
  "Verification",
  "Findings",
  "Signal",
  "People",
  "Change",
  "Other",
];

/**
 * The section of the form an item belongs to, read from its code. The codes
 * were written with these prefixes, so this is the program's own grouping,
 * not a guess from the names.
 */
export function itemGroup(item: Pick<CatalogItem, "code">): string {
  const code = item.code;
  if (/^GHSRDQA_FC_/.test(code)) return "Facility capacity";
  if (/^GHSRDQA_REG_/.test(code)) return "Registers";
  if (/^GHSRDQA_VF_/.test(code)) return "Verification";
  if (/^GHSRDQA_(QUARTER|VISIT_TYPE|ASSESSOR_)/.test(code)) return "Visit";
  if (/^GHSRDQA_/.test(code)) return "Findings";
  if (/^DQAI_(EVENT_TYPE|VIOLATION_ID|RULE_ID|SIGNAL_TYPE|REASON_CODE|PERIOD)$/.test(code))
    return "Signal";
  if (/^DQAI_(USER_ID|USER_ROLE|APPROVER_ID)$/.test(code)) return "People";
  if (/^DQAI_/.test(code)) return "Change";
  return "Other";
}

export interface ItemGroup {
  group: string;
  items: CatalogItem[];
}

/** Items by section, sections in form order, items by name within one. */
export function groupItems(items: readonly CatalogItem[]): ItemGroup[] {
  const groups = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const group = itemGroup(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
    .map(([group, members]) => ({
      group,
      items: members.sort((a, b) => shortItemName(a).localeCompare(shortItemName(b))),
    }));
}

/** Whole numbers, decimals, percentages: items that can be totalled. */
export function isNumericValueType(valueType: string): boolean {
  return /^(INTEGER|NUMBER|PERCENTAGE|UNIT_INTERVAL)/.test(valueType);
}

/**
 * Items whose values can be counted per distinct value. Free prose and files
 * have as many values as events, so they are read in the events table only.
 */
export function isBreakableValueType(valueType: string): boolean {
  return !/^(LONG_TEXT|FILE_RESOURCE|IMAGE|COORDINATE|GEOJSON|URL|EMAIL|PHONE_NUMBER)$/.test(valueType);
}

/* -------------------------------------------------------- item readings */

export interface ItemScope extends EventScope {
  stage: string;
  item: string;
}

/** Events per distinct value of one item, besides period and unit. */
export function buildEventBreakdownPath(programId: string, scope: ItemScope): string {
  const params = [
    ...stageParam(scope.stage),
    ...dimensionParams(scope),
    `dimension=${encodeURIComponent(scope.item)}`,
    "outputType=EVENT",
    "displayProperty=NAME",
  ];
  return `analytics/events/aggregate/${encodeURIComponent(programId)}?${params.join("&")}`;
}

/** The item's values summed per period and unit, for a numeric item. */
export function buildEventSumPath(programId: string, scope: ItemScope): string {
  const params = [
    ...stageParam(scope.stage),
    ...dimensionParams(scope),
    `value=${encodeURIComponent(scope.item)}`,
    "aggregationType=SUM",
    "outputType=EVENT",
    "displayProperty=NAME",
  ];
  return `analytics/events/aggregate/${encodeURIComponent(programId)}?${params.join("&")}`;
}

const BOOLEAN_LABELS: Record<string, string> = { "1": "Yes", "0": "No", true: "Yes", false: "No" };

/**
 * The breakdown rows summed into events per value, highest first. Option
 * codes become names when the element's options are known; booleans read
 * Yes and No; an empty value is "Not recorded".
 */
export function parseBreakdown(
  response: AnalyticsResponse,
  item: Pick<CatalogItem, "id" | "valueType"> & { options?: Record<string, string> },
): CountedItem[] {
  const parsed = parseAnalytics(response);
  const totals = new Map<string, number>();
  for (const row of parsed.rows) {
    const raw = String(row[item.id] ?? "");
    totals.set(raw, (totals.get(raw) ?? 0) + row.value);
  }
  const label = (raw: string) => {
    if (raw === "") return "Not recorded";
    if (item.valueType === "BOOLEAN" || item.valueType === "TRUE_ONLY") {
      return BOOLEAN_LABELS[raw.toLowerCase()] ?? raw;
    }
    return item.options?.[raw] ?? parsed.labels[raw] ?? raw;
  };
  return [...totals.entries()]
    .map(([raw, value]) => ({ id: raw || "__blank", name: label(raw), value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------- verification */

export interface VerificationPair {
  /** The indicator key in the codes, e.g. OPD, ANC1, HIVPOS. */
  key: string;
  /** The indicator as the source item names it, e.g. "OPD", "FP new acceptors". */
  label: string;
  source: CatalogItem;
  dhis2: CatalogItem;
  reason?: CatalogItem;
}

/**
 * The recount pairs of an RDQA form: for each indicator, what the assessor
 * counted in the source register and what DHIS2 holds for the same period.
 * Read from the codes, `…_VF_<KEY>_SOURCE` and `…_VF_<KEY>_DHIS2`.
 */
export function verificationPairs(items: readonly CatalogItem[]): VerificationPair[] {
  const byKey = new Map<string, Partial<VerificationPair>>();
  for (const item of items) {
    const match = /_VF_(.+)_(SOURCE|DHIS2|REASON)$/.exec(item.code);
    if (!match) continue;
    const [, key, role] = match;
    const pair = byKey.get(key) ?? { key };
    if (role === "SOURCE") {
      pair.source = item;
      pair.label = shortItemName(item)
        .replace(/^VF\s+/, "")
        .replace(/\s+source(\s+count)?$/i, "");
    } else if (role === "DHIS2") pair.dhis2 = item;
    else pair.reason = item;
    byKey.set(key, pair);
  }
  return [...byKey.values()]
    .filter((pair): pair is VerificationPair => Boolean(pair.source && pair.dhis2 && pair.label))
    .sort((a, b) => a.source.id.localeCompare(b.source.id));
}

export interface VerificationRow {
  key: string;
  label: string;
  source: number | null;
  dhis2: number | null;
  /** DHIS2 ÷ source, as a ratio; null when the source count is missing or zero. */
  factor: number | null;
}

/**
 * The verification factor of each indicator over everything in scope: the
 * two sums first, then one division. Never an average of per-facility
 * factors, which would weight a facility that saw ten patients the same as
 * one that saw a thousand.
 */
export function verificationRows(
  pairs: VerificationPair[],
  sums: Record<string, number | null>,
): VerificationRow[] {
  return pairs.map((pair) => {
    const source = sums[pair.source.id] ?? null;
    const dhis2 = sums[pair.dhis2.id] ?? null;
    return {
      key: pair.key,
      label: pair.label,
      source,
      dhis2,
      factor: source !== null && dhis2 !== null && source > 0 ? dhis2 / source : null,
    };
  });
}

/** Every value in a sum response added up, or null when nothing came back. */
export function sumOfResponse(response: AnalyticsResponse): number | null {
  const parsed = parseAnalytics(response);
  if (!parsed.rows.length) return null;
  return parsed.rows.reduce((total, row) => total + row.value, 0);
}

export function verificationToCsv(rows: VerificationRow[]): string {
  return rowsToCsv(
    ["Indicator", "Source count", "DHIS2 value", "Verification factor"],
    rows.map((row) => [
      row.label,
      row.source === null ? "" : String(row.source),
      row.dhis2 === null ? "" : String(row.dhis2),
      row.factor === null ? "" : row.factor.toFixed(3),
    ]),
  );
}
