# DHIS2 Analysis

> **This copy is packaged for Docker.** `docker compose up -d --build` — see [DEPLOY-DOCKER.md](DEPLOY-DOCKER.md).

A read-only analysis workspace for a DHIS2 server, integrated with GeoEpi's R-based
spatial epidemiology workflows. Connect to DHIS2 to explore and export aggregate data,
then send a selected map and its boundaries to GeoEpi for a GIS-ready dataset.

The token never reaches the browser. Every DHIS2 request is made server-side through a
proxy that forwards `GET` only, and only to analytics and metadata endpoints.

## Requirements

- Node.js 20.9 or newer (developed on Node 24)
- A DHIS2 2.38+ server and a personal access token for an account that can read analytics

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts DHIS2 Analysis only. Use `docker compose up -d --build` to run the
complete integrated deployment, including the private GeoEpi service. To work on both
with `npm run dev`, start GeoEpi on port 8000 beside it — the app looks there unless
`GEOEPI_UPSTREAM_URL` says otherwise:

```bash
docker compose build geoepi
docker compose run --rm -p 127.0.0.1:8000:8000 geoepi
```

Open http://localhost:3000 and go to **Connection**. Enter:

- **Server URL** — the DHIS2 context path, e.g. `https://play.dhis2.org/demo`. A pasted
  `/api/...` URL is trimmed for you.
- **Access token** — a personal access token (`d2pat_…`), or an OIDC bearer token if your
  server is behind one.

The token is verified against `/api/me` before it is stored, so a bad URL or an expired
token fails immediately with a specific reason rather than silently.

### Creating a token in DHIS2

Profile → **Edit profile** → **Personal access tokens** → generate. DHIS2 shows the value
once. A read-only account is enough; this app never writes.

## Pinning credentials for a deployment

Set these on the server and the connection UI becomes read-only — useful for a shared
deployment where viewers should not supply their own credentials:

```bash
DHIS2_BASE_URL=https://dhis2.example.org
DHIS2_TOKEN=d2pat_...
DHIS2_TOKEN_TYPE=ApiToken   # or Bearer
```

Copy `.env.example` to `.env.local` for local development. Never commit a real token.

## What the pages do

| Page | What it is for |
|---|---|
| **Overview** | Connection health, what the server holds, and whether analytics tables are fresh |
| **Explore** | Build a query (data × period × organisation unit) and read it as a trend, ranking, share, map, figures or table |
| **Pivot** | Cross-tabulate any two dimensions of the same query, with a heat scale and totals |
| **Maps** | Shade regions, districts or sub-districts (Levels 1–4) by a count, coverage or indicator; click to drill down, with areas lacking boundaries listed under the map |
| **GeoEpi** | Run spatial epidemiology notebooks, view generated map layers, and download CSV, GeoJSON and GeoPackage outputs — inside the app, in the same theme |
| **Measles** | The Group 3 measles capstone (synthetic data): the Director's brief, then GeoEpi's measles data-preparation and modelling modules, ending in a ranked Northern Region decision table and 14-day microplan |
| **Compare** | Check two data elements against each other and report the organisation units where the relationship breaks down |
| **Metadata** | Search indicators, data elements, data sets, programs and organisation units; copy ids into a query |

Every chart can be read as a table. Metadata can be exported as CSV or JSON, and
map results can be exported as CSV or GeoJSON with each available boundary and its
map value together.

### Sending DHIS2 map data to GeoEpi

1. Connect to DHIS2, then open **Maps** and choose a data item, period and organisation-unit scope.
2. Select **Send to GeoEpi**. The selected values, organisation-unit hierarchy and available
   DHIS2 geometries are saved together as a GeoEpi dataset.
3. Select **Open in GeoEpi**: the GeoEpi page opens with Module 6 and the new dataset
   already chosen. Run **Module 6: DHIS2 Map Data Explorer**. The run makes the map
   available in the GeoEpi viewer and produces downloadable CSV, GeoJSON and GeoPackage
   files for GIS work.

This handoff is a map-level export, not a replacement for the source data required by
GeoEpi Modules 1–5. Those modules continue to require their own documented supporting
tables, rasters and prepared panel datasets.

GeoEpi keeps data preparation and modelling in separate modules:
- **Module 2** builds the district-month panel.
- **Module 2B** turns the panel into the model inputs.
- **Modules 3–5** analyse and model the result.

See [geoepi/README.md](geoepi/README.md).

The `geoepi/` directory contains the GeoEpi source snapshot from
[bymwanzam/geoepi](https://github.com/bymwanzam/geoepi) at commit
`70b73c6feb54f252161ffc9a56158e3d4b6f4b44`, plus the DHIS2 map workflow and authenticated
integration for this project.

## How the token is handled

1. Posted once to `/api/connection`, which verifies it against DHIS2 before storing it.
2. Stored in an **httpOnly** cookie — no script in the page can read it — for 12 hours.
3. Attached to DHIS2 requests **on the server only**, in `src/lib/dhis2/server.ts`.
4. Forwarded by `/api/dhis2/[...path]` under two rules: `GET` only, and only endpoints on
   the allowlist in `src/lib/dhis2/paths.ts`. Data writes, metadata imports, user
   management and maintenance endpoints are refused before the token is attached.
5. GeoEpi runs on the private Compose network. The `/geoepi` page frames GeoEpi's viewer,
   and everything under `/geoepi/` goes through a proxy that verifies the DHIS2
   connection first and forwards only the routes in `src/lib/geoepi/paths.ts`. The DHIS2
   token is never forwarded to GeoEpi.

A DHIS2 redirect to a login page is treated as a rejected credential rather than as a
successful response, which is how an invalid token usually presents itself.

## Reading the numbers honestly

DHIS2 analytics answers from pre-generated tables, so data captured since the last
analytics run will not appear however recent the period. The Overview page shows when
those tables were last generated.

Where the app has to combine values to draw something, it says so rather than leaving you
to guess:

- Charts state which dimensions are being summed over, with a one-click way to break them
  out instead.
- Ranking and share views state whether they are showing the latest period, a total or an
  average — the choice is yours and it is always on screen, because summing a coverage
  rate across twelve months produces a number that means nothing.
- Series beyond the eighth are ranked out of the chart rather than lumped into an "Other"
  bucket; they stay in the table view.

## Comparing two data elements

The **Compare** page checks two data elements that are supposed to carry the *same
number* — suspected malaria cases against suspected cases tested, a register count
against its summary, doses issued against doses recorded — and lists every reporting unit
where they do not.

The test is equality, nothing else. A facility reporting 40 against 40 passes; a facility
reporting 300 against 280 fails, however ordinary that gap looks across the rest of the
region. No unit is judged against the others.

| Finding | What it means |
|---|---|
| **Does not match** | Both were reported and the numbers differ |
| **Incomplete** | Only one of the two was reported, so the pair cannot be checked |
| **Matches** | Both reported, exactly equal — which is not the same as either number being right, and is left uncoloured for that reason |

Findings come back laid out down the hierarchy, named the way your server names its own
organisation unit levels, so the table reads the way a reviewer reads it.

Two things keep those columns useful. The breakdown defaults to the **deepest level the
server defines** — the unit that actually reports — rather than a fixed level number,
which would mean facility on one server and sub-district on the next. And a level whose
value is the same in every row is dropped, because it repeats one word down the whole
table: checking facilities across a country gives *Region | District | Sub-district |
Facility*, while checking the facilities of a single region gives *District |
Sub-district | Facility*. The column naming the unit itself is always kept.

Worst disagreement first, with an **Only show problems** filter, the difference and the
gap as a share of the larger value, and CSV export carrying every column plus the reason
for each finding.

Alongside the table: a scatter of A against B where the diagonal is equality, so anything
off the line is a unit that disagrees, and the two totals tracked period by period —
either as levels or as A minus B against a zero line.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm start       # serve the production build
npm test        # data-layer test suite (Node's built-in runner, no extra dependencies)
npm run lint    # ESLint
```

GeoEpi has its own tests (Python and Node); see [geoepi/README.md](geoepi/README.md).

## Project layout

```
src/
  app/
    api/connection/        connection lifecycle: verify, store, clear
    api/dhis2/[...path]/   the read-only DHIS2 proxy
    geoepi/page.tsx        the GeoEpi page, framing GeoEpi's viewer in the app shell
    geoepi/[...path]/      the authenticated GeoEpi proxy
    connect|explore|pivot|maps|compare|metadata/
  components/
    charts/                chart primitives built on the palette in docs/DESIGN.md
    query/                 the data / period / organisation unit pickers
    ui/primitives.tsx      buttons, cards, inputs, segmented controls
  lib/
    dhis2/                 connection, server client, allowlist, analytics + quality
    geoepi/paths.ts        the GeoEpi proxy allowlist
tests/                     data-layer tests
docs/DESIGN.md             palette, chart rules and why they are what they are
geoepi/                    the GeoEpi service: FastAPI runner, viewer, R notebooks
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Recharts · lucide-react.
No database and no CMS: the DHIS2 server is the only data source, and nothing is persisted
beyond the session cookie and the query you last ran (kept in your own browser).
