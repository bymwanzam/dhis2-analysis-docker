"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Copy, Library, Search } from "lucide-react";
import { useConnection } from "@/components/connection-provider";
import { Alert, Button, Card, CardBody, EmptyState, Input, Segmented, Spinner } from "@/components/ui/primitives";
import { fetchOrgUnitLevels, searchMetadata, type MetadataResource } from "@/lib/dhis2/client";
import type { Pager } from "@/lib/dhis2/types";
import { useAsyncData, useDebounced } from "@/lib/hooks";
import { downloadCsv, stamped } from "@/lib/download";

interface MetadataRecord {
  id: string;
  displayName: string;
  [key: string]: unknown;
}

interface MetadataColumn {
  key: string;
  header: string;
  /** The cell as text. This is what the export writes. */
  get: (row: MetadataRecord) => string;
  /** A richer cell for the table, where plain text is not enough. */
  render?: (row: MetadataRecord) => React.ReactNode;
  /** Long prose that should wrap rather than stretch the row. */
  wrap?: boolean;
}

interface ResourceConfig {
  value: MetadataResource;
  label: string;
  fields: string;
  /**
   * The columns in the order they are read. A function where the shape cannot
   * be known until the records are in hand — how deep a hierarchy runs is a
   * property of the data, not of the resource.
   */
  columns:
    | MetadataColumn[]
    | ((rows: MetadataRecord[], levelName: (level: number) => string) => MetadataColumn[]);
}

interface Ancestor {
  id: string;
  displayName: string;
  level: number;
}

const ancestorsOf = (row: MetadataRecord): Ancestor[] =>
  (row.ancestors as Ancestor[] | undefined) ?? [];

/**
 * An ancestor is found by the level it reports, never by its position in the
 * list. Branches are not all the same depth, and reading by position would
 * file a district under the region heading the moment one level is missing.
 */
const ancestorAt = (row: MetadataRecord, level: number): Ancestor | undefined =>
  ancestorsOf(row).find((unit) => unit.level === level);

const nested = (row: MetadataRecord, key: string, inner = "displayName"): string => {
  const value = row[key] as Record<string, unknown> | undefined;
  return (value?.[inner] as string) ?? "—";
};

const plain = (row: MetadataRecord, key: string): string => {
  const value = row[key];
  return value === undefined || value === null || value === "" ? "—" : String(value);
};

const date = (row: MetadataRecord, key: string): string => {
  const value = row[key];
  return typeof value === "string" ? new Date(value).toLocaleDateString() : "—";
};

/**
 * The identifier column.
 *
 * Every list carries it, because the id is what a query is written with — and
 * it stays copyable rather than being text to transcribe by hand.
 */
const NAME: MetadataColumn = {
  key: "name",
  header: "Name",
  get: (row) => row.displayName,
};

const UID: MetadataColumn = {
  key: "uid",
  header: "UID",
  get: (row) => row.id,
  render: (row) => <CopyId id={row.id} />,
};

const RESOURCES: ResourceConfig[] = [
  {
    value: "indicators",
    label: "Indicators",
    fields: "id,displayName,indicatorType[displayName],annualized,lastUpdated",
    columns: [
      NAME,
      UID,
      { key: "type", header: "Type", get: (row) => nested(row, "indicatorType") },
      { key: "annualized", header: "Annualised", get: (row) => (row.annualized ? "Yes" : "No") },
      { key: "lastUpdated", header: "Updated", get: (row) => date(row, "lastUpdated") },
    ],
  },
  {
    value: "dataElements",
    label: "Data elements",
    fields: "id,displayName,code,shortName,description",
    columns: [
      NAME,
      UID,
      { key: "code", header: "Code", get: (row) => plain(row, "code") },
      { key: "shortName", header: "shortName", get: (row) => plain(row, "shortName") },
      {
        key: "description",
        header: "Description",
        get: (row) => plain(row, "description"),
        wrap: true,
      },
    ],
  },
  {
    value: "dataSets",
    label: "Data sets",
    fields: "id,displayName,periodType,timelyDays,lastUpdated",
    columns: [
      NAME,
      UID,
      { key: "periodType", header: "Period type", get: (row) => plain(row, "periodType") },
      { key: "timelyDays", header: "Timely days", get: (row) => plain(row, "timelyDays") },
      { key: "lastUpdated", header: "Updated", get: (row) => date(row, "lastUpdated") },
    ],
  },
  {
    value: "programs",
    label: "Programs",
    fields: "id,displayName,programType,lastUpdated",
    columns: [
      NAME,
      UID,
      { key: "programType", header: "Program type", get: (row) => plain(row, "programType") },
      { key: "lastUpdated", header: "Updated", get: (row) => date(row, "lastUpdated") },
    ],
  },
  {
    value: "organisationUnits",
    label: "Organisation units",
    fields: "id,displayName,level,ancestors[id,displayName,level]",
    // Read root first, the way the hierarchy is spoken: national, region,
    // district, then the unit itself at the end of its own chain. One pair of
    // columns per level the tree actually reaches — the name the server gives
    // that level, and the id a query would be written with.
    columns: (rows, levelName) => {
      const deepest = rows.reduce(
        (max, row) =>
          ancestorsOf(row).reduce((inner, unit) => Math.max(inner, unit.level), max),
        0,
      );

      const ancestors: MetadataColumn[] = [];
      for (let level = 1; level <= deepest; level += 1) {
        const label = levelName(level);
        ancestors.push({
          key: `ancestor-${level}`,
          header: label,
          get: (row) => ancestorAt(row, level)?.displayName ?? "—",
        });
        ancestors.push({
          key: `ancestor-${level}-uid`,
          header: `${label} UID`,
          get: (row) => ancestorAt(row, level)?.id ?? "—",
        });
      }

      return [
        ...ancestors,
        NAME,
        UID,
        { key: "level", header: "Level", get: (row) => plain(row, "level") },
      ];
    },
  },
];

/**
 * One page is one export batch: 100 records at a time. Walking Next and
 * exporting each page gives a complete list in 100-row files, and what the
 * CSV contains is always exactly what is on screen.
 */
const PAGE_SIZE = 100;

/**
 * Exporting everything reads in larger batches than the page shows: the screen
 * is paged for legibility, a file has no such need, and fewer round trips mean
 * a shorter wait. The page cap guards against a server that keeps claiming
 * there is another page.
 */
const EXPORT_BATCH = 500;
const MAX_EXPORT_PAGES = 400;

/** Quote a CSV cell. Server-supplied names can carry a comma or a quote. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

function toCsvLines(rows: MetadataRecord[], columns: MetadataColumn[]): string {
  const lines = [
    columns.map((column) => csvCell(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(column.get(row))).join(",")),
  ];
  return lines.join("\r\n");
}

/**
 * A reader for what the server actually defines.
 *
 * Every id shown here can be pasted into a query, which is why copying one is
 * a single click.
 */
export function MetadataBrowser() {
  const { status, loading: checking } = useConnection();
  const connected = status?.connected === true;

  const [resource, setResource] = React.useState<MetadataResource>("indicators");
  const [term, setTerm] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [exporting, setExporting] = React.useState(false);
  const [exported, setExported] = React.useState(0);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const exportAbort = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => exportAbort.current?.abort(), []);

  const debouncedTerm = useDebounced(term, 350);
  const config = RESOURCES.find((item) => item.value === resource)!;

  const { data, error, loading } = useAsyncData(
    (signal) =>
      connected
        ? searchMetadata<MetadataRecord>(resource, {
            query: debouncedTerm,
            fields: config.fields,
            pageSize: PAGE_SIZE,
            page,
            signal,
          })
        : Promise.resolve({ items: [] as MetadataRecord[], pager: undefined as Pager | undefined }),
    [resource, debouncedTerm, page, config.fields, connected],
  );

  // Stable identity: the column list is derived from these rows.
  const rows = React.useMemo(() => data?.items ?? [], [data]);
  const pager = data?.pager;

  // Hierarchy headings are the server's own words for its levels, falling back
  // to a number when it will not name them.
  const { data: levels } = useAsyncData(
    (signal) => (connected ? fetchOrgUnitLevels(signal) : Promise.resolve([])),
    [connected],
  );

  const levelName = React.useCallback(
    (level: number) =>
      (levels ?? []).find((entry) => entry.level === level)?.displayName ?? `Level ${level}`,
    [levels],
  );

  const columns = React.useMemo(
    () =>
      typeof config.columns === "function"
        ? config.columns(rows, levelName)
        : config.columns,
    [config, rows, levelName],
  );

  if (!checking && !connected) {
    return (
      <Alert tone="error" title="No DHIS2 connection">
        Add a server URL and access token on the{" "}
        <Link href="/connect" className="font-medium text-accent underline">
          connection page
        </Link>{" "}
        to browse metadata.
      </Alert>
    );
  }

  const total = pager?.total;
  const pageCount = pager?.pageCount ?? 1;
  const firstRow = rows.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastRow = firstRow ? firstRow + rows.length - 1 : 0;

  function exportPage() {
    // The row range is in the filename so consecutive batches never collide.
    downloadCsv(
      toCsvLines(rows, columns),
      `${stamped(`dhis2-${resource}-${firstRow}-${lastRow}`)}.csv`,
    );
  }

  /**
   * Every record the current search matches, not just the page on screen.
   *
   * Columns are worked out from the whole set rather than from the visible
   * page: a hierarchy can run deeper further down the list, and a file whose
   * columns were decided by the first hundred rows would truncate the rest.
   */
  async function exportAll() {
    exportAbort.current?.abort();
    const controller = new AbortController();
    exportAbort.current = controller;

    setExporting(true);
    setExported(0);
    setExportError(null);

    try {
      const all: MetadataRecord[] = [];
      let next = 1;
      let pages = 1;

      do {
        const batch = await searchMetadata<MetadataRecord>(resource, {
          query: debouncedTerm,
          fields: config.fields,
          pageSize: EXPORT_BATCH,
          page: next,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        all.push(...batch.items);
        setExported(all.length);

        pages = Math.min(batch.pager?.pageCount ?? 1, MAX_EXPORT_PAGES);
        next += 1;
        if (!batch.items.length) break;
      } while (next <= pages);

      if (!all.length) {
        setExportError("There was nothing to export.");
        return;
      }

      const full =
        typeof config.columns === "function"
          ? config.columns(all, levelName)
          : config.columns;

      downloadCsv(toCsvLines(all, full), `${stamped(`dhis2-${resource}-all`)}.csv`);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setExportError(
        cause instanceof Error ? cause.message : "The export could not be completed.",
      );
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Metadata type"
          value={resource}
          onChange={(value) => {
            setResource(value);
            setPage(1);
          }}
          options={RESOURCES.map((item) => ({ value: item.value, label: item.label }))}
        />

        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            className="pl-8"
            placeholder={`Search ${config.label.toLowerCase()}…`}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            aria-label={`Search ${config.label.toLowerCase()}`}
          />
        </div>

        <Button
          variant="secondary"
          onClick={exportPage}
          disabled={!rows.length || exporting}
        >
          Export this page
        </Button>

        <Button
          variant="primary"
          onClick={() => void exportAll()}
          disabled={!rows.length}
          loading={exporting}
          title="Download every record matching this search, not just the page on screen"
        >
          {exporting
            ? `Exporting… ${exported.toLocaleString()}`
            : `Export all${total !== undefined ? ` ${total.toLocaleString()}` : ""}`}
        </Button>
      </div>

      {error ? (
        <Alert tone="error" title="Could not load metadata">
          {error}
        </Alert>
      ) : null}

      {exportError ? (
        <Alert tone="error" title="Could not export">
          {exportError}
        </Alert>
      ) : null}

      <Card>
        <CardBody className="p-0">
          {loading && !rows.length ? (
            <div className="px-5 py-12 text-center">
              <Spinner label="Loading…" />
            </div>
          ) : !rows.length ? (
            <EmptyState icon={<Library className="size-7" aria-hidden />} title="Nothing found">
              {debouncedTerm
                ? `No ${config.label.toLowerCase()} match “${debouncedTerm}”.`
                : `This server has no ${config.label.toLowerCase()} visible to your token.`}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-ink-2"
                      >
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-hair hover:bg-surface-2">
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={
                            column.wrap
                              ? "min-w-64 max-w-md px-4 py-2 text-ink-2"
                              : "whitespace-nowrap px-4 py-2 text-ink-2"
                          }
                        >
                          {column.render ? column.render(row) : column.get(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-2">
          {rows.length
            ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()}${
                total !== undefined ? ` of ${total.toLocaleString()}` : ""
              } ${config.label.toLowerCase()}`
            : `No ${config.label.toLowerCase()} to show`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </Button>
          <span className="text-xs tabular-nums text-ink-2">
            Page {page} of {pageCount}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pageCount || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be blocked; the id is visible either way.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-hair px-2 py-1 font-mono text-xs text-ink-2 hover:text-ink"
      title={`Copy ${id}`}
    >
      {id}
      {copied ? (
        <Check className="size-3 text-success-text" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
      <span className="sr-only">Copy identifier</span>
    </button>
  );
}
