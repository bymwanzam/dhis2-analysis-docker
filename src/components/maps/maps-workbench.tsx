"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUp, ChevronRight, Map as MapIcon, MapPinOff } from "lucide-react";
import { ChartFrame, type ChartView } from "@/components/charts/chart-frame";
import { ChoroplethMap, MapLegend } from "@/components/charts/choropleth-map";
import { Column, DataTable } from "@/components/charts/data-table";
import { useConnection } from "@/components/connection-provider";
import { PeriodPicker } from "@/components/query/period-picker";
import { Section, summarise } from "@/components/query/section";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Label,
  Segmented,
  Select,
  Spinner,
} from "@/components/ui/primitives";
import { parseAnalytics, rowsToCsv } from "@/lib/dhis2/analytics";
import {
  fetchAnalytics,
  fetchMapUnits,
  fetchOrgUnitChildren,
  fetchOrgUnitLevels,
  fetchOrgUnitRoots,
} from "@/lib/dhis2/client";
import { layoutMap, valuesByOrgUnit, type GeoFeature, type MapClass } from "@/lib/dhis2/geo";
import {
  MAP_DATA_TYPES,
  MAX_MAP_LEVEL,
  availableLevels,
  drillDown,
  drillUp,
  focusCrumb,
  hasBoundary,
  hierarchyPath,
  mapClassesFor,
  mapOuDimension,
  setLevel,
  toMapGeoJson,
  type MapDataType,
  type MapScope,
  type MapUnit,
  type OrgUnitRef,
} from "@/lib/dhis2/map-scope";
import { findPeriodOption } from "@/lib/dhis2/periods";
import { formatNumber, formatPeriod, formatTick } from "@/lib/format";
import { downloadCsv, downloadJson, stamped } from "@/lib/download";
import { useAsyncData, usePersistentState } from "@/lib/hooks";
import { panelStyle } from "@/lib/color";
import { BackgroundPicker } from "./background-picker";
import { MapDataPicker, type MapDataItem } from "./map-data-picker";

interface MapsState {
  dataType: MapDataType;
  item: MapDataItem | null;
  periods: string[];
  level: number;
  /** Root first; empty until the user's root unit is known. */
  path: OrgUnitRef[];
}

const DEFAULT_STATE: MapsState = {
  dataType: "coverage",
  item: null,
  periods: ["LAST_12_MONTHS"],
  level: 2,
  path: [],
};

export function MapsWorkbench() {
  const { status, loading: checking } = useConnection();
  const connected = status?.connected === true;
  const [geoEpiDataset, setGeoEpiDataset] = React.useState<string | null>(null);
  const [sendingToGeoEpi, setSendingToGeoEpi] = React.useState(false);
  const [geoEpiError, setGeoEpiError] = React.useState<string | null>(null);

  // Unit ids mean nothing on another server, so the selection is kept per server.
  const [state, setState, hydrated] = usePersistentState<MapsState>(
    `dhis2.maps.state::${status?.baseUrl ?? "unset"}`,
    DEFAULT_STATE,
  );

  const roots = useAsyncData(
    (signal) => (connected ? fetchOrgUnitRoots(signal) : Promise.resolve(null)),
    [connected],
  );
  const levels = useAsyncData(
    (signal) => (connected ? fetchOrgUnitLevels(signal) : Promise.resolve(null)),
    [connected],
  );

  const levelNames = React.useMemo(() => {
    const names = new Map<number, string>();
    for (const level of levels.data ?? []) names.set(level.level, level.displayName);
    return names;
  }, [levels.data]);
  const levelName = (level: number) => levelNames.get(level) ?? `Level ${level}`;

  /* ---------------------------------------------------------------- scope */

  const root: OrgUnitRef | null = state.path[0] ??
    (roots.data?.[0]
      ? {
          id: roots.data[0].id,
          name: roots.data[0].displayName,
          level: roots.data[0].level ?? 1,
        }
      : null);

  // Normalised through setLevel so a stored selection can never ask for a
  // level above its own parent or below the cap.
  const scope: MapScope | null = root
    ? setLevel({ level: state.level, path: state.path.length ? state.path : [root] }, state.level)
    : null;
  const scopeKey = scope ? `${scope.level}:${scope.path.map((unit) => unit.id).join("/")}` : null;

  const deepest = levels.data?.length
    ? Math.max(...levels.data.map((level) => level.level))
    : MAX_MAP_LEVEL;
  const levelOptions = root ? availableLevels(root.level, deepest) : [];

  const go = (next: MapScope | null) => {
    if (next) setState((current) => ({ ...current, level: next.level, path: next.path }));
  };

  /* ----------------------------------------------------------------- data */

  // Boundaries do not depend on the data item or period, so they are cached
  // per scope: changing the indicator, or drilling back up, costs no download.
  const unitCache = React.useRef(new Map<string, MapUnit[]>());
  const units = useAsyncData(async (signal) => {
    if (!scope || !scopeKey) return null;
    const cached = unitCache.current.get(scopeKey);
    if (cached) return cached;
    const fetched = await fetchMapUnits(scope, signal);
    unitCache.current.set(scopeKey, fetched);
    return fetched;
  }, [scopeKey]);

  const analyticsQuery =
    scope && state.item && state.periods.length
      ? {
          dx: [state.item.id],
          pe: state.periods,
          ou: mapOuDimension(scope),
          periodsAsFilter: true,
        }
      : null;
  const analyticsKey = analyticsQuery ? JSON.stringify(analyticsQuery) : null;

  const analytics = useAsyncData(async (signal) => {
    if (!analyticsQuery) return null;
    return parseAnalytics(await fetchAnalytics(analyticsQuery, signal));
  }, [analyticsKey]);

  const model = React.useMemo(() => {
    const all = units.data ?? [];
    const values = analytics.data && state.item
      ? valuesByOrgUnit(analytics.data, state.item.id).values
      : new Map<string, number>();
    const mapped = all.filter(hasBoundary);
    const unmapped = all.filter((unit) => !hasBoundary(unit));
    const features: GeoFeature[] = mapped.map((unit) => ({
      id: unit.id,
      name: unit.name,
      level: unit.level,
      parentName: unit.ancestors.at(-1)?.name ?? null,
      geometry: unit.geometry!,
    }));
    const drawnValues = mapped
      .map((unit) => values.get(unit.id))
      .filter((value): value is number => value !== undefined);

    return {
      all,
      byId: new Map(all.map((unit) => [unit.id, unit])),
      names: new Map(all.map((unit) => [unit.id, unit.name])),
      values,
      mapped,
      unmapped,
      layout: layoutMap(features),
      classes: mapClassesFor(state.dataType, drawnValues),
      noDataCount: mapped.filter((unit) => !values.has(unit.id)).length,
    };
  }, [units.data, analytics.data, state.item, state.dataType]);

  const [view, setView] = React.useState<ChartView>("chart");

  // A viewing preference, not part of the analysis, so it is not scoped to
  // the server: the panel keeps its colour across tabs, reloads and servers.
  const [panelBackground, setPanelBackground] = usePersistentState<string | null>(
    "dhis2.maps.panelBackground",
    null,
  );
  const frameStyle = panelStyle(panelBackground) as React.CSSProperties | null;

  /* --------------------------------------------------------------- render */

  if (!checking && !connected) {
    return (
      <Alert tone="error" title="No DHIS2 connection">
        Add a server URL and access token on the{" "}
        <Link href="/connect" className="font-medium text-accent underline">
          connection page
        </Link>{" "}
        before drawing a map.
      </Alert>
    );
  }

  const periodSummary = summarise(
    state.periods.map((id) => findPeriodOption(id)?.label ?? formatPeriod(id)),
    "No period chosen",
  );
  const shownLevel = scope ? levelName(scope.level) : "";
  const parent = scope?.path.at(-1);
  const within = scope && parent && parent.level < scope.level ? ` in ${parent.name}` : "";
  const format = (value: number) => formatMapValue(state.dataType, value);
  const nextLevel = scope && scope.level < MAX_MAP_LEVEL ? levelName(scope.level + 1) : null;

  async function sendToGeoEpi() {
    if (!state.item) return;
    setSendingToGeoEpi(true);
    setGeoEpiError(null);
    setGeoEpiDataset(null);

    try {
      const response = await fetch("/geoepi/api/datasets/dhis2-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          toMapGeoJson(model.all, model.values, {
            name: state.item.displayName,
            dataType: state.dataType,
            dataTypeName:
              MAP_DATA_TYPES.find((type) => type.value === state.dataType)?.label ??
              state.dataType,
            dataItemId: state.item.id,
            dataItem: state.item.displayName,
            periods: state.periods,
            periodLabel: periodSummary,
            organisationUnitLevel: shownLevel,
            parentOrganisationUnit: parent?.name ?? null,
          }),
        ),
      });
      const result = (await response.json()) as { id?: string; detail?: string; error?: string };
      if (!response.ok || !result.id) {
        throw new Error(result.detail ?? result.error ?? "The map data could not be sent.");
      }
      setGeoEpiDataset(result.id);
    } catch (cause) {
      setGeoEpiError(
        cause instanceof Error ? cause.message : "The map data could not be sent to GeoEpi.",
      );
    } finally {
      setSendingToGeoEpi(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[336px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
        <Section
          title="Data"
          summary={state.item?.displayName ?? "Nothing chosen"}
          defaultOpen
        >
          <div className="space-y-3">
            <div>
              <Label>Data type</Label>
              <Segmented
                className="mt-1"
                ariaLabel="Data type"
                value={state.dataType}
                onChange={(dataType) =>
                  setState((current) =>
                    current.dataType === dataType ? current : { ...current, dataType, item: null },
                  )
                }
                options={MAP_DATA_TYPES.map((type) => ({ value: type.value, label: type.label }))}
              />
              <p className="mt-1 text-xs text-muted">
                {MAP_DATA_TYPES.find((type) => type.value === state.dataType)?.hint}
              </p>
            </div>
            <MapDataPicker
              type={state.dataType}
              value={state.item}
              onChange={(item) => setState((current) => ({ ...current, item }))}
            />
          </div>
        </Section>

        <Section title="Period" summary={periodSummary}>
          <PeriodPicker
            selected={state.periods}
            onChange={(periods) => setState((current) => ({ ...current, periods }))}
          />
          {state.periods.length > 1 ? (
            <p className="mt-2 text-xs text-ink-2">
              Several periods are combined into one value by DHIS2, the same way it
              combines facilities.
            </p>
          ) : null}
        </Section>

        <Section
          title="Area"
          summary={scope ? `${shownLevel}${within}` : "Loading hierarchy…"}
          defaultOpen
        >
          {roots.error ? (
            <p className="text-xs text-critical">{roots.error}</p>
          ) : !scope || !root ? (
            <Spinner label="Loading hierarchy" />
          ) : (
            <div className="space-y-3">
              {(roots.data?.length ?? 0) > 1 ? (
                <div>
                  <Label htmlFor="map-root">Top of the hierarchy</Label>
                  <Select
                    id="map-root"
                    className="mt-1"
                    value={root.id}
                    onChange={(event) => {
                      const next = roots.data!.find((unit) => unit.id === event.target.value)!;
                      go(
                        setLevel(
                          {
                            level: state.level,
                            path: [{ id: next.id, name: next.displayName, level: next.level ?? 1 }],
                          },
                          state.level,
                        ),
                      );
                    }}
                  >
                    {roots.data!.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.displayName}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div>
                <Label htmlFor="map-level">Level</Label>
                <Select
                  id="map-level"
                  className="mt-1"
                  value={scope.level}
                  onChange={(event) => go(setLevel(scope, Number(event.target.value)))}
                >
                  {levelOptions.map((level) => (
                    <option key={level} value={level}>
                      Level {level} – {levelName(level)}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted">
                  Facility data is added up to the chosen level by DHIS2; facilities are
                  not drawn.
                </p>
              </div>

              {levelOptions
                .filter((level) => level > root.level && level < scope.level)
                .map((level) => {
                  const above = scope.path.find((unit) => unit.level === level - 1);
                  if (!above) return null;
                  const chosen = scope.path.find((unit) => unit.level === level);
                  return (
                    <ParentSelect
                      key={`${level}:${above.id}`}
                      parent={above}
                      label={`Within ${levelName(level).toLowerCase()}`}
                      value={chosen?.id ?? ""}
                      onChange={(child) => {
                        const kept = scope.path.filter((unit) => unit.level < level);
                        go({ level: scope.level, path: child ? [...kept, child] : kept });
                      }}
                    />
                  );
                })}
            </div>
          )}
        </Section>
      </aside>

      <div className="min-w-0 space-y-5">
        {scope ? (
          <nav
            aria-label="Map drill path"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hair bg-surface px-4 py-2.5"
          >
            <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
              {scope.path.map((unit, index) => (
                <li key={unit.id} className="flex items-center gap-1">
                  {index > 0 ? <ChevronRight className="size-3.5 text-muted" aria-hidden /> : null}
                  {unit.level < scope.level ? (
                    <button
                      type="button"
                      onClick={() => go(focusCrumb(scope, index))}
                      className="rounded px-1 text-accent hover:underline"
                    >
                      {unit.name}
                    </button>
                  ) : (
                    <span className="px-1 text-ink">{unit.name}</span>
                  )}
                </li>
              ))}
              {parent && parent.level < scope.level ? (
                <li className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-muted" aria-hidden />
                  <span className="px-1 font-medium text-ink">
                    {shownLevel}
                    <span className="font-normal text-ink-2"> (level {scope.level})</span>
                  </span>
                </li>
              ) : null}
            </ol>
            <Button
              size="sm"
              variant="secondary"
              disabled={!drillUp(scope)}
              onClick={() => go(drillUp(scope))}
              title="Show the level above"
            >
              <ArrowUp className="size-3.5" aria-hidden />
              Up a level
            </Button>
          </nav>
        ) : null}

        {!state.item ? (
          <div className="rounded-xl border border-hair bg-surface">
            <EmptyState
              icon={<MapIcon className="size-7" aria-hidden />}
              title={hydrated ? "Choose what to map" : "Loading…"}
            >
              Pick a data type and a data element or indicator on the left. The map
              shades each area by its value; click an area to see the level beneath it.
            </EmptyState>
          </div>
        ) : !state.periods.length ? (
          <Alert title="Choose a period">A map needs at least one period to show.</Alert>
        ) : units.error ? (
          <Alert tone="error" title="The areas could not be loaded">
            {units.error}
          </Alert>
        ) : analytics.error ? (
          <Alert tone="error" title="The values could not be loaded">
            {analytics.error}
          </Alert>
        ) : units.loading || analytics.loading || !units.data || !scope ? (
          <div className="flex justify-center rounded-xl border border-hair bg-surface py-24">
            <Spinner label="Loading the map" />
          </div>
        ) : (
          <>
            {analytics.data?.isEmpty ? (
              <Alert title="DHIS2 returned no values">
                Nothing was reported for {state.item.displayName} in {periodSummary.toLowerCase()}{" "}
                for these areas, so every area is shown as No data. Try a wider period, or
                check that analytics tables have been generated since the data was entered.
              </Alert>
            ) : null}
            {geoEpiError ? (
              <Alert tone="error" title="Could not send map to GeoEpi">
                {geoEpiError}
              </Alert>
            ) : null}

            <ChartFrame
              title={`${state.item.displayName} by ${shownLevel.toLowerCase()}${within}`}
              description={`${periodSummary} · ${aggregationNote(state.dataType, shownLevel)}`}
              view={view}
              onViewChange={setView}
              style={frameStyle ?? undefined}
              toolbar={
                <>
                  <BackgroundPicker value={panelBackground} onChange={setPanelBackground} />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void sendToGeoEpi()}
                    disabled={sendingToGeoEpi || !model.all.some((unit) => unit.geometry)}
                    loading={sendingToGeoEpi}
                    title="Send the selected DHIS2 values and boundaries to GeoEpi"
                  >
                    Send to GeoEpi
                  </Button>
                  {geoEpiDataset ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        // GeoEpi is a full-page app served by the proxy route, not a Next page.
                        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                        window.location.assign(
                          `/geoepi/?notebook=dhis2_map_explorer&dataset=${encodeURIComponent(geoEpiDataset)}`,
                        );
                      }}
                    >
                      Open in GeoEpi
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      downloadJson(
                        toMapGeoJson(model.all, model.values, {
                          name: state.item!.displayName,
                          dataType: state.dataType,
                          dataTypeName:
                            MAP_DATA_TYPES.find((type) => type.value === state.dataType)?.label ??
                            state.dataType,
                          dataItemId: state.item!.id,
                          dataItem: state.item!.displayName,
                          periods: state.periods,
                          periodLabel: periodSummary,
                          organisationUnitLevel: shownLevel,
                          parentOrganisationUnit: parent?.name ?? null,
                        }),
                        `${stamped("dhis2-map")}.json`,
                      )
                    }
                    disabled={!model.all.some((unit) => unit.geometry)}
                    title="Export boundaries and map values together as GeoJSON"
                  >
                    JSON
                  </Button>
                </>
              }
              onDownload={() =>
                downloadCsv(
                  rowsToCsv(
                    ["Organisation unit", "Hierarchy", "Level", "Value", "Boundary"],
                    model.all.map((unit) => [
                      unit.name,
                      hierarchyPath(unit),
                      levelName(unit.level),
                      model.values.has(unit.id) ? String(model.values.get(unit.id)) : "",
                      boundaryStatus(unit),
                    ]),
                  ),
                  "dhis2-map.csv",
                )
              }
              footnote={
                <MapFootnotes
                  noData={model.noDataCount}
                  unmapped={model.unmapped.length}
                  nextLevel={nextLevel}
                />
              }
            >
              {view === "table" ? (
                <UnitTable
                  units={model.all}
                  values={model.values}
                  format={format}
                  levelName={levelName}
                  onDrill={(unit) => go(drillDown(scope, unit))}
                />
              ) : model.layout.shapes.length ? (
                <ChoroplethMap
                  layout={model.layout}
                  values={model.values}
                  classes={model.classes}
                  names={model.names}
                  legend={
                    <div className="space-y-3">
                      <MapLegend
                        orientation="vertical"
                        title={legendTitle(state.dataType, state.item)}
                        classes={model.classes}
                        showNoData={model.noDataCount > 0}
                        formatRange={(range) => formatClass(state.dataType, range)}
                      />
                      <p className="text-xs leading-snug text-muted">
                        {legendNote(state.dataType, shownLevel)}
                      </p>
                    </div>
                  }
                  ariaLabel={`Map of ${shownLevel.toLowerCase()}${within} shaded by ${state.item.displayName}. The table view lists every value.`}
                  canSelect={(id) => (model.byId.get(id)?.level ?? MAX_MAP_LEVEL) < MAX_MAP_LEVEL}
                  onSelect={(id) => {
                    const unit = model.byId.get(id);
                    if (unit) go(drillDown(scope, unit));
                  }}
                  renderTooltip={(id) => {
                    const unit = model.byId.get(id);
                    if (!unit) return null;
                    const value = model.values.get(id);
                    return (
                      <UnitTooltip
                        unit={unit}
                        value={value === undefined ? "No data" : format(value)}
                        caption={periodSummary}
                        drillHint={
                          unit.level < MAX_MAP_LEVEL
                            ? `Click to see its ${levelName(unit.level + 1).toLowerCase()} areas`
                            : null
                        }
                      />
                    );
                  }}
                />
              ) : (
                <EmptyState
                  icon={<MapPinOff className="size-7" aria-hidden />}
                  title="No boundaries to draw"
                >
                  None of these {shownLevel.toLowerCase()} areas have boundary coordinates in
                  DHIS2. Their values are listed below and in the table view.
                </EmptyState>
              )}
            </ChartFrame>

            {model.unmapped.length ? (
              <UnmappedList
                units={model.unmapped}
                values={model.values}
                format={format}
                levelName={shownLevel}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- the sidebar */

/** One step of the "within" cascade: the children of a unit, or all of them. */
function ParentSelect({
  parent,
  label,
  value,
  onChange,
}: {
  parent: OrgUnitRef;
  label: string;
  value: string;
  onChange: (child: OrgUnitRef | null) => void;
}) {
  const { data, loading, error } = useAsyncData(
    (signal) => fetchOrgUnitChildren(parent.id, signal),
    [parent.id],
  );
  const id = `map-within-${parent.id}`;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        className="mt-1"
        value={value}
        disabled={loading}
        onChange={(event) => {
          const child = data?.find((unit) => unit.id === event.target.value);
          onChange(
            child
              ? { id: child.id, name: child.displayName, level: child.level ?? parent.level + 1 }
              : null,
          );
        }}
      >
        <option value="">All of {parent.name}</option>
        {(data ?? []).map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.displayName}
          </option>
        ))}
      </Select>
      {error ? <p className="mt-1 text-xs text-critical">{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------ the map */

function UnitTooltip({
  unit,
  value,
  caption,
  drillHint,
}: {
  unit: MapUnit;
  value: string;
  caption: string;
  drillHint: string | null;
}) {
  return (
    <>
      <p className="text-xs font-medium text-ink">{unit.name}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-2">{hierarchyPath(unit)}</p>
      <p className="mt-1.5 flex items-baseline justify-between gap-4 text-xs">
        <span className="text-ink-2">{caption}</span>
        <span className="font-medium tabular-nums text-ink">{value}</span>
      </p>
      {drillHint ? <p className="mt-1 text-[11px] text-muted">{drillHint}</p> : null}
    </>
  );
}

function MapFootnotes({
  noData,
  unmapped,
  nextLevel,
}: {
  noData: number;
  unmapped: number;
  nextLevel: string | null;
}) {
  const notes: React.ReactNode[] = [];
  if (nextLevel) {
    notes.push(<span key="drill">Click an area to see its {nextLevel.toLowerCase()} areas.</span>);
  }
  if (noData > 0) {
    notes.push(
      <span key="nodata">
        {noData} area{noData === 1 ? "" : "s"} reported nothing and {noData === 1 ? "is" : "are"}{" "}
        grey, not zero.
      </span>,
    );
  }
  if (unmapped > 0) {
    notes.push(
      <span key="unmapped">
        {unmapped} area{unmapped === 1 ? " has" : "s have"} no boundary and{" "}
        {unmapped === 1 ? "is" : "are"} listed below the map.
      </span>,
    );
  }
  if (!notes.length) return null;
  return <span className="flex flex-wrap items-center gap-x-4 gap-y-1">{notes}</span>;
}

/** Areas the map cannot draw, listed rather than silently dropped. */
function UnmappedList({
  units,
  values,
  format,
  levelName,
}: {
  units: MapUnit[];
  values: Map<string, number>;
  format: (value: number) => string;
  levelName: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>
            Not on the map: {units.length} {levelName.toLowerCase()} area
            {units.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            DHIS2 holds no boundary for these, so they cannot be shaded. Their values are
            still counted and shown here.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody className="pt-0">
        <ul className="divide-y divide-hair">
          {units.map((unit) => {
            const value = values.get(unit.id);
            return (
              <li key={unit.id} className="flex items-baseline justify-between gap-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{unit.name}</span>
                  <span className="block truncate text-xs text-ink-2">
                    {hierarchyPath(unit)} · {boundaryStatus(unit)}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-ink">
                  {value === undefined ? (
                    <span className="text-muted">No data</span>
                  ) : (
                    format(value)
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function UnitTable({
  units,
  values,
  format,
  levelName,
  onDrill,
}: {
  units: MapUnit[];
  values: Map<string, number>;
  format: (value: number) => string;
  levelName: (level: number) => string;
  onDrill: (unit: MapUnit) => void;
}) {
  const columns: Column<MapUnit>[] = [
    {
      key: "name",
      header: "Organisation unit",
      render: (unit) => unit.name,
      sortValue: (unit) => unit.name,
    },
    {
      key: "path",
      header: "Hierarchy",
      render: (unit) => <span className="text-ink-2">{hierarchyPath(unit)}</span>,
      sortValue: (unit) => hierarchyPath(unit),
    },
    {
      key: "boundary",
      header: "Boundary",
      render: (unit) => boundaryStatus(unit),
      sortValue: (unit) => boundaryStatus(unit),
    },
    {
      key: "value",
      header: "Value",
      numeric: true,
      render: (unit) => {
        const value = values.get(unit.id);
        return value === undefined ? <span className="text-muted">No data</span> : format(value);
      },
      sortValue: (unit) => values.get(unit.id) ?? -Infinity,
    },
    {
      key: "drill",
      header: "",
      render: (unit) =>
        unit.level < MAX_MAP_LEVEL ? (
          <button
            type="button"
            onClick={() => onDrill(unit)}
            className="whitespace-nowrap text-xs text-accent hover:underline"
          >
            {levelName(unit.level + 1)} areas →
          </button>
        ) : null,
    },
  ];

  return (
    <div className="px-3">
      <DataTable columns={columns} rows={units} caption="Every area in this view" />
    </div>
  );
}

/* ------------------------------------------------------------- wording */

function formatMapValue(type: MapDataType, value: number): string {
  if (type === "coverage") return `${formatNumber(value, 1)}%`;
  if (type === "count") return formatNumber(value, 0);
  return formatNumber(value, 2);
}

function formatClass(type: MapDataType, range: MapClass): string {
  if (type === "coverage") {
    return range.to === Infinity ? "Over 100%" : `${range.from}–${range.to}%`;
  }
  if (range.from === range.to) return formatTick(range.from);
  return `${formatTick(range.from)} – ${formatTick(range.to)}`;
}

function legendTitle(type: MapDataType, item: MapDataItem): string {
  if (type === "coverage") return "Coverage";
  if (type === "count") return "Count";
  return item.typeName ? `Value (${item.typeName.toLowerCase()})` : "Value";
}

function legendNote(type: MapDataType, level: string): string {
  const area = level.toLowerCase();
  if (type === "coverage") {
    return "Fixed scale, so a colour means the same percentage at every level. Over 100% usually means the target population is set too low.";
  }
  return `Equal steps from the lowest to the highest ${area} on this map; the steps change when you drill.`;
}

function aggregationNote(type: MapDataType, level: string): string {
  const area = level.toLowerCase();
  if (type === "count") return `facility values summed by DHIS2 up to each ${area}`;
  return `recalculated by DHIS2 for each ${area} from its numerator and denominator, not averaged from facilities`;
}

function boundaryStatus(unit: MapUnit): string {
  if (hasBoundary(unit)) return "On map";
  if (unit.geometry?.type === "point") return "Point location only";
  return "No coordinates in DHIS2";
}
