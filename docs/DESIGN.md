# Chart and colour rules

Everything here is implemented in `src/app/globals.css` (the tokens) and
`src/components/charts/` (the marks). This file records what the values are and why, so
a future change is a decision rather than a guess.

## Tokens, not hex

Every colour a chart uses is a CSS custom property defined on `:root` and redefined for
dark mode. Recharts writes them straight into SVG `fill` and `stroke` attributes, so
switching theme repaints the chart without React re-rendering, and light and dark are two
deliberately chosen palettes rather than one palette flipped.

Dark values are declared twice: under `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`. The guard lets an
explicit light choice beat an OS set to dark.

## Categorical palette

Assigned by entity, in this fixed order, and never cycled.

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4a3aa7` | `#9085e9` |
| 8 | red | `#e34948` | `#e66767` |

The **order is the colourblind-safety mechanism**, not a preference. This sequence was
validated for adjacent-pair separation under simulated protanopia, deuteranopia and
tritanopia: worst adjacent CVD ΔE 9.1 light / 8.4 dark against a target of 8, and worst
adjacent normal-vision ΔE 19.6 light / 19.3 dark against a floor of 15. Re-ordering the
slots invalidates that result. If you change a hue, re-run the validator from the
`dataviz` skill against both surfaces before shipping.

**There is no ninth colour.** A ninth series is a signal to rank and cap, which
`buildSeries` does: series are ordered by total, the top eight are drawn, and the tail is
reported as hidden. The tail is never summed into an "Other" bucket, because for a rate or
a ratio that invents a number. It stays readable in the table view.

Three light-mode hues — aqua, yellow and magenta — sit below 3:1 contrast against the
light surface. The mitigation is the **table view on every chart**, plus a legend whenever
there are two or more series. Identity never rests on colour alone.

## Sequential fill

The pivot heat scale is one hue anchored to the chart surface: near-zero recedes into the
surface, the maximum is the accent, computed with `color-mix` in `heatFill`. The mix is
capped at 55% so the value text stays in ink and legible on the darkest cell in both
themes — the number is always present, so colour is a second reading of the value rather
than the only one. A scale legend is shown whenever the fill is on.

## Status colours

`--good`, `--warning`, `--serious`, `--critical` are reserved for state — analytics
freshness, connection health — and never reused as a series colour. They always ship with
an icon and a word, never colour alone.

Stat tile deltas are deliberately **not** coloured good/bad unless the caller passes
`higherIsBetter`. For half of DHIS2 indicators up is the bad news, so an arrow and a named
comparison period carry the direction instead.

## Marks

- Bars capped at 24px, 4px rounded data end, square at the baseline.
- Lines 2px, round joins, `connectNulls={false}` so a gap reads as missing data rather
  than as a value of zero.
- Markers ≥8px with a 2px ring in the surface colour so they stay legible where lines
  cross. Past 12 points only the endpoint is marked.
- Touching marks are separated by a 2px gap in the surface colour — including stacked
  segments, which is what `StackSegment` does — never by a stroke around the mark.
- Grid and axes are solid hairlines one step off the surface. Never dashed.
- Text wears ink tokens, never the series colour. A colour beside the text carries
  identity.

## Forms

- Change over time → line, or columns when the periods are few and discrete.
- Magnitude across categories → horizontal bars, ranked, one colour.
- Part-to-whole → donut, capped at six slices; past that the option is withdrawn and bars
  take over.
- One category, or one number → a stat tile. A one-bar bar chart says nothing a figure
  does not say better, so `ChartBody` substitutes a tile automatically.

**Never a second y-axis.** Two measures of different scale get two charts.

## Encoding a finding

The comparison scatter marks mismatched units in red **and** as triangles. Colour alone
would hide the one thing that chart exists to show from a red-green reader, so the shape
carries it too and the legend names both. Its diagonal is the line A = B, so distance
from the line is the size of the disagreement.

Matching units stay in the neutral series blue rather than status green. Two data
elements agreeing does not prove either number is right — both could be wrong in the same
way — and a field of green ticks would claim that it does. The same reasoning keeps the
"Matches" row in the findings table uncoloured: colour is spent on the rows that need
attention, and on the difference column where it is non-zero.

## Direct labels

Sparing, and measured before they are placed. The time-series chart computes the pixel gap
between final values and only draws end-labels when they cannot collide; otherwise the
legend and tooltip carry identity. Ranked bars label the tip, but only when there is a
single series.

## Maps

The Explore map is a choropleth drawn as plain SVG from DHIS2's own `geoFeatures`, with
no tile layer: nothing is sent to a third-party map server, fills are the same CSS tokens
as every other chart, and the image export reads it like any other plot.

- **One data item at a time.** Two data items are never added together to colour a
  unit; a picker chooses which one is shown. Periods are collapsed by the same
  Latest / Total / Average choice as the ranked view, and it is on screen. Anything
  else summed away (category options) is named in the footnote.
- **Equal-interval classes, at most five**, never more than there are distinct values.
  Equal steps keep colour honest about magnitude. The ramp is the heat-table hue, but it
  runs from 16% to 90% accent rather than 4% to 55%: no number is printed on a shape, so
  the lowest class must stand off the surface and the top can go darker.
- **No data is neutral grey, never filled as zero.** A unit that reported nothing and a
  unit that reported 0 are different findings. The grey carries a faint hatch so it stays
  apart from the palest class for a reader who cannot separate grey from light blue, and
  the tooltip and legend both say "No data". Boundaries are requested for the whole scope
  rather than for the units that returned values, which is what lets a silent unit be
  drawn at all.
- **Shapes are separated by a 1px surface-colour gap**, not the 2px used between bars:
  facility-level polygons can be a few pixels across and 2px swallows them. The
  mechanism, a gap in the surface colour and never an outline, is the same.
- **Area labels** sit at a point guaranteed inside the largest piece of the area (the
  centroid is only a first guess — it falls outside a crescent or a U-shaped district),
  wrapped between words over at most three lines and cut with an ellipsis past that.
  Text is ink with a 3px halo in the surface colour, so it reads on every class in both
  themes. An area too small to hold at least four characters gets no label rather than
  one spilling over its neighbours; the name is always in the tooltip and the table.
- **The legend sits to the right of the map** on a wide screen, as a vertical key, and
  drops below it on a narrow one.
- Facilities stored as points are 10px markers with a 2px surface ring, drawn above the
  areas.
- The footnote says when units from several hierarchy levels share one scale, when units
  with values have no coordinates (they stay in the table), and how many units are hatched.

### The Maps page

The Maps page draws one level at a time, Levels 1 to 4. Level 5 (facility) is never a
map level: DHIS2 rolls facility data up to the chosen level (`ou:LEVEL-n;<parent>`, with
periods sent as a filter), so a count is summed and an indicator is recalculated from
summed numerators and denominators. The app never averages percentages.

- **Coverage uses a fixed scale**: 0–20, 20–40, 40–60, 60–80, 80–100 and over 100%. A
  colour then means the same percentage in every region and after every drill. Over 100%
  is a class of its own because it usually signals a target population that is too small,
  and it must not hide in the top band.
- **Counts and indicators use equal steps** between the lowest and highest area on the
  current map, and the legend says the steps change on drilling.
- Units come from `organisationUnits` with `ancestors` and `geometry` rather than from
  `geoFeatures`, so units with no boundary (none, or a point only) are known and listed
  under the map instead of disappearing. The tooltip shows the full hierarchy path from
  the same response.
- **The map panel's background can be repainted** (White, Light grey, Dark grey, Black,
  Light blue, or any custom colour; remembered in the browser). Only the panel changes.
  Its text is re-inked from the background by `panelInk` in `src/lib/color.ts`: black or
  white, whichever contrasts more (one of them always clears 4.58:1), with the secondary
  and muted tints softened only as far as WCAG AA allows. The map, the toolbar and the
  legend swatches keep the theme's colours through `--base-*` tokens captured at the root
  and restored with the `.theme-ink` class, so a black panel never changes a fill, a
  boundary gap or an area label.
