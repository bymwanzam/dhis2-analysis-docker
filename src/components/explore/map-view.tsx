"use client";

import * as React from "react";
import { MapPinOff } from "lucide-react";
import { ChoroplethMap, MapLegend } from "@/components/charts/choropleth-map";
import { Column, DataTable } from "@/components/charts/data-table";
import { Alert, EmptyState, Spinner } from "@/components/ui/primitives";
import { dimensionValues, labelFor, type ParsedAnalytics } from "@/lib/dhis2/analytics";
import { fetchGeoFeatures } from "@/lib/dhis2/client";
import {
  equalIntervalClasses,
  layoutMap,
  valuesByOrgUnit,
  type GeoFeature,
  type MapClass,
  type MapLayout,
} from "@/lib/dhis2/geo";
import { formatNumber } from "@/lib/format";
import { useAsyncData } from "@/lib/hooks";

export interface MapModel {
  loading: boolean;
  error: string | null;
  layout: MapLayout | null;
  /** Data items in the result; the map shows one at a time, never a sum. */
  dataItems: { id: string; name: string }[];
  dataItem: string | null;
  values: Map<string, number>;
  classes: MapClass[];
  names: Map<string, string>;
  features: GeoFeature[];
  /** Dimensions added together to reach one value per unit. */
  summedOver: string[];
  /** Units drawn on the map that returned no value. */
  noDataCount: number;
  /** Units with a value but no coordinates in DHIS2, so not on the map. */
  unmappedCount: number;
  /** Hierarchy levels among the coloured units. */
  levelCount: number;
}

/**
 * Everything the map view needs, derived from a period-collapsed result.
 *
 * Boundaries are requested for the query's own `ou` dimension, not for the
 * units that came back with values, so a unit that reported nothing is still
 * drawn — grey, as "No data" — rather than disappearing from the map. They
 * are only fetched once the map is actually shown, and kept per selection so
 * switching chart type and back does not download them again.
 */
export function useMapModel({
  enabled,
  collapsed,
  ou,
  selectedItem,
}: {
  enabled: boolean;
  collapsed: ParsedAnalytics | null;
  ou: string[] | null;
  selectedItem: string | null;
}): MapModel {
  const ouKey = enabled && ou?.length ? ou.join(";") : null;
  const cache = React.useRef(new Map<string, GeoFeature[]>());

  const geo = useAsyncData(async (signal) => {
    if (!ouKey || !ou) return null;
    const cached = cache.current.get(ouKey);
    if (cached) return cached;
    const features = await fetchGeoFeatures(ou, signal);
    cache.current.set(ouKey, features);
    return features;
  }, [ouKey]);

  const features = React.useMemo(() => geo.data ?? [], [geo.data]);
  const layout = React.useMemo(
    () => (geo.data ? layoutMap(geo.data) : null),
    [geo.data],
  );

  const dataItems = React.useMemo(
    () =>
      collapsed?.dimensions.includes("dx")
        ? dimensionValues(collapsed, "dx", "total").map((id) => ({
            id,
            name: labelFor(collapsed, id),
          }))
        : [],
    [collapsed],
  );

  const dataItem =
    dataItems.find((item) => item.id === selectedItem)?.id ?? dataItems[0]?.id ?? null;

  const { values, summedOver } = React.useMemo(
    () =>
      collapsed
        ? valuesByOrgUnit(collapsed, dataItem)
        : { values: new Map<string, number>(), summedOver: [] },
    [collapsed, dataItem],
  );

  const derived = React.useMemo(() => {
    const onMap = new Set(features.map((feature) => feature.id));
    const drawnValues = features
      .map((feature) => values.get(feature.id))
      .filter((value): value is number => value !== undefined);
    const levels = new Set(
      features
        .filter((feature) => values.has(feature.id))
        .map((feature) => feature.level ?? 0),
    );
    const names = new Map<string, string>();
    for (const feature of features) names.set(feature.id, feature.name);

    return {
      // The key describes what is drawn, so units that are off the map do not
      // stretch its classes.
      classes: equalIntervalClasses(drawnValues),
      names,
      noDataCount: features.filter((feature) => !values.has(feature.id)).length,
      unmappedCount: [...values.keys()].filter((id) => !onMap.has(id)).length,
      levelCount: levels.size,
    };
  }, [features, values]);

  return {
    loading: geo.loading && Boolean(ouKey),
    error: geo.error,
    layout,
    dataItems,
    dataItem,
    values,
    features,
    summedOver,
    ...derived,
  };
}

export function MapBody({
  model,
  valueCaption,
}: {
  model: MapModel;
  valueCaption: string;
}) {
  if (model.error) {
    return (
      <div className="px-3">
        <Alert tone="error" title="The boundaries could not be loaded">
          {model.error}
        </Alert>
      </div>
    );
  }

  if (model.loading || !model.layout) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Loading boundaries" />
      </div>
    );
  }

  if (!model.layout.shapes.length) {
    return (
      <EmptyState icon={<MapPinOff className="size-7" aria-hidden />} title="Nothing to map">
        None of these organisation units have coordinates in DHIS2. Choose a level whose
        boundaries have been imported, or read the values in the table.
      </EmptyState>
    );
  }

  return (
    <ChoroplethMap
      layout={model.layout}
      values={model.values}
      classes={model.classes}
      names={model.names}
      valueCaption={valueCaption}
      legend={
        <MapLegend
          orientation="vertical"
          title="Value"
          classes={model.classes}
          showNoData={model.noDataCount > 0}
        />
      }
    />
  );
}

interface MapTableRow {
  id: string;
  name: string;
  parent: string;
  value: number | null;
  onMap: boolean;
}

/** Every unit the map knows about, including the ones it could not draw. */
export function MapTable({
  model,
  parsed,
}: {
  model: MapModel;
  parsed: ParsedAnalytics;
}) {
  const rows = React.useMemo<MapTableRow[]>(() => {
    const byId = new Map<string, MapTableRow>();
    for (const feature of model.features) {
      byId.set(feature.id, {
        id: feature.id,
        name: feature.name,
        parent: feature.parentName ?? "",
        value: model.values.get(feature.id) ?? null,
        onMap: true,
      });
    }
    for (const [id, value] of model.values) {
      if (byId.has(id)) continue;
      byId.set(id, { id, name: labelFor(parsed, id), parent: "", value, onMap: false });
    }
    return [...byId.values()].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  }, [model.features, model.values, parsed]);

  const columns: Column<MapTableRow>[] = [
    {
      key: "name",
      header: "Organisation unit",
      render: (row) => row.name,
      sortValue: (row) => row.name,
    },
    {
      key: "parent",
      header: "Parent",
      render: (row) => row.parent || <span className="text-muted">–</span>,
      sortValue: (row) => row.parent,
    },
    {
      key: "onMap",
      header: "On map",
      render: (row) => (row.onMap ? "Yes" : "No coordinates"),
      sortValue: (row) => (row.onMap ? 1 : 0),
    },
    {
      key: "value",
      header: "Value",
      numeric: true,
      render: (row) =>
        row.value === null ? <span className="text-muted">No data</span> : formatNumber(row.value),
      sortValue: (row) => row.value ?? -Infinity,
    },
  ];

  return (
    <div className="px-3">
      <DataTable columns={columns} rows={rows} caption="Every organisation unit on the map" />
    </div>
  );
}
