# DHIS2 Analysis — working notes

A read-only DHIS2 analysis app: Next.js 16 App Router, React 19, Tailwind v4, Recharts.
See README.md for what it does and how to run it.

## Rules that are not negotiable

**The token never reaches the browser.** It lives in an httpOnly cookie or a server
environment variable, and is attached to requests only in `src/lib/dhis2/server.ts`.
Client code talks to `/api/dhis2/...`, never to DHIS2 directly.

**The proxy is read-only.** `src/app/api/dhis2/[...path]/route.ts` exports `GET` and
nothing else, and every path is checked against the allowlist in
`src/lib/dhis2/paths.ts` before the credential is attached. Adding a write endpoint to
that list would turn a viewer's session into a write credential — don't.

**GeoEpi is reached only through its proxy.** `src/app/geoepi/[...path]/route.ts`
verifies the DHIS2 connection, then forwards only what `src/lib/geoepi/paths.ts` allows.
The DHIS2 token is never sent to GeoEpi. GeoEpi runs notebooks, so a route added to that
list is reachable by every connected viewer; add the test with it.

**Charts follow `docs/DESIGN.md`.** Colour is assigned by entity in a fixed, validated
order and never cycled; there is never a second y-axis; every chart has a table view.
Re-run the palette validator if you change a colour.

**Say what the numbers are.** Where the app sums or reduces values to draw something, the
chart says so on screen. Summing a coverage rate across twelve months is meaningless, and
a chart that hides that is worse than no chart.

## Layout

- `src/lib/dhis2/` — connection, server client, path allowlist, analytics shaping. The
  analytics response is parsed into a tidy form exactly once, in `analytics.ts`; every
  chart and table is built from that. `quality.ts` holds the pairwise comparison that
  the Compare page reports — it decides which units a user is sent to investigate, so
  it is tested hard and changed carefully.
- `src/components/charts/` — chart primitives. Colours are CSS custom properties, so a
  theme change repaints the SVG without React re-rendering.
- `src/components/query/` — the three pickers and the shared query state.
- `src/lib/hooks.ts` — `useAsyncData` is the only place a fetch effect sets state; use it
  rather than writing another one.
- `geoepi/` — the GeoEpi service (FastAPI + papermill + R notebooks), its own container
  on the Compose network. Its viewer, `geoepi/app/static/index.html`, is framed by the
  `/geoepi` page. It copies the colour roles from `src/app/globals.css` and follows the
  shell's `data-theme`, so change both if you change a surface or ink colour.
- `/measles` frames the same viewer with `track=measles` (`src/lib/geoepi/launch.ts`), so it
  lists only the measles modules (`geoepi/notebooks/measles_*`, built by
  `geoepi/tools/prepare_measles.py`); `/geoepi` lists the modules with no track.
- The Maps page hands a map to GeoEpi (`POST /geoepi/api/datasets/dhis2-map`), then links
  to `/geoepi?notebook=dhis2_map_explorer&dataset=…`; the page passes those two
  parameters on to the viewer.

## Checks

```bash
npm test          # data-layer suite, Node's built-in runner, no extra dependencies
npm run lint
npm run build
```

`npm test` covers the shaping functions, the pairwise quality checks and both proxy
allowlists. It is fast and has no dependencies — keep it that way, and add to it when you
touch `analytics.ts`, `quality.ts`, `dhis2/paths.ts` or `geoepi/paths.ts`.

GeoEpi has its own checks (they need `pip install -r geoepi/requirements.txt`):

```bash
python geoepi/tests/test_api.py
node geoepi/tests/test_lib.js
```
