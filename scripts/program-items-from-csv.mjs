/**
 * Turn the Metadata page's "Event data items" export into the item catalogue
 * the program tabs are built on.
 *
 *   node scripts/program-items-from-csv.mjs [path/to/export.csv]
 *
 * Reads data/dhis2-event-data-items.csv by default and writes
 * src/lib/dhis2/program-items.ts. Only the programs that have a tab
 * (PROGRAM_TABS in src/lib/dhis2/programs.ts) are kept. Re-run it after a
 * program gains or loses a data element and export the list again first.
 *
 * The CSV is exactly what the app downloads: Name, UID, Kind, Program UID,
 * Item UID, Value type, Code. The item name is the export's name with the
 * program's name taken off the front, so "GHS Routine Data Quality
 * Assessment RDQA Quarter" becomes "RDQA Quarter".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? join(root, "data", "dhis2-event-data-items.csv"));
const target = join(root, "src", "lib", "dhis2", "program-items.ts");

/** The programs with tabs, and their names as DHIS2 prints them in front of an item. */
const PROGRAMS = {
  DQAIauditP1: "DQ-AI Audit Trail",
  GHSRDQAprog: "GHS Routine Data Quality Assessment",
};

const text = readFileSync(source, "utf8");
const rows = parseCsv(text);
const header = rows.shift();
const col = (name) => {
  const at = header.indexOf(name);
  if (at < 0) throw new Error(`The CSV has no "${name}" column; expected the Metadata page's Event data items export.`);
  return at;
};
const NAME = col("Name"), PROGRAM = col("Program UID"), ITEM = col("Item UID"), KIND = col("Kind");
const VALUE_TYPE = col("Value type"), CODE = col("Code");

const byProgram = {};
for (const row of rows) {
  if (!row.length || !row[ITEM]) continue;
  const program = row[PROGRAM];
  if (!(program in PROGRAMS)) continue;
  const prefix = PROGRAMS[program] + " ";
  const fullName = row[NAME];
  const name = fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
  (byProgram[program] ??= []).push({
    id: row[ITEM],
    code: row[CODE] === "—" ? "" : row[CODE],
    name,
    valueType: row[VALUE_TYPE],
    kind: row[KIND] === "Program attribute" ? "attribute" : "dataElement",
  });
}

for (const program of Object.keys(PROGRAMS)) {
  if (!byProgram[program]?.length) console.warn(`warning: no items for ${program} in ${source}`);
  byProgram[program]?.sort((a, b) => a.id.localeCompare(b.id));
}

const stamp = new Date().toISOString().slice(0, 10);
const lines = [
  "/**",
  " * Event data items of the programs with a tab: GENERATED, do not edit.",
  " *",
  ` * Written by scripts/program-items-from-csv.mjs on ${stamp} from the Metadata`,
  " * page's Event data items export. Re-run the script after exporting again.",
  " * Names are the export's names with the program's name taken off the front.",
  " */",
  'import type { CatalogItem } from "./programs";',
  "",
  "export const PROGRAM_ITEMS: Readonly<Record<string, readonly CatalogItem[]>> = {",
];
for (const [program, items] of Object.entries(byProgram)) {
  lines.push(`  ${program}: [`);
  for (const item of items) {
    lines.push(
      `    { id: ${q(item.id)}, code: ${q(item.code)}, name: ${q(item.name)}, valueType: ${q(item.valueType)}, kind: ${q(item.kind)} },`,
    );
  }
  lines.push("  ],");
}
lines.push("};", "");
writeFileSync(target, lines.join("\n"));
console.log(
  `Wrote ${target}: ${Object.entries(byProgram)
    .map(([program, items]) => `${program} ${items.length}`)
    .join(", ")}`,
);

function q(value) {
  return JSON.stringify(value);
}

/** A small RFC 4180 reader: quoted cells, doubled quotes, CRLF or LF. */
function parseCsv(input) {
  const out = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c !== ""));
}
