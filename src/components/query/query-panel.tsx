"use client";

import * as React from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button, Checkbox, Label, Select } from "@/components/ui/primitives";
import { Section, summarise } from "./section";
import { DataPicker } from "./data-picker";
import { OrgUnitPicker } from "./org-unit-picker";
import { PeriodPicker } from "./period-picker";
import {
  AGGREGATION_TYPES,
  DEFAULT_QUERY,
  missingParts,
  type QueryState,
} from "./query-state";
import { findPeriodOption } from "@/lib/dhis2/periods";
import { formatPeriod } from "@/lib/format";

/**
 * The query builder: data, period and organisation unit, the three dimensions
 * every DHIS2 analytics request needs, plus the aggregation switches that
 * change what the numbers mean.
 */
export function QueryPanel({
  state,
  onChange,
  onRun,
  running,
  dirty,
  disabled,
}: {
  state: QueryState;
  onChange: (next: QueryState) => void;
  onRun: () => void;
  running: boolean;
  /** The selection has changed since the last run. */
  dirty: boolean;
  disabled?: boolean;
}) {
  const missing = missingParts(state);
  const canRun = missing.length === 0 && !disabled;

  return (
    <div className="flex flex-col gap-3">
      <Section
        title="Data"
        summary={summarise(state.data.map((item) => item.displayName), "No data chosen")}
        defaultOpen
      >
        <DataPicker
          selected={state.data}
          onChange={(data) => onChange({ ...state, data })}
        />
      </Section>

      <Section
        title="Period"
        summary={summarise(
          state.periods.map((id) => findPeriodOption(id)?.label ?? formatPeriod(id)),
          "No period chosen",
        )}
      >
        <PeriodPicker
          selected={state.periods}
          onChange={(periods) => onChange({ ...state, periods })}
        />
      </Section>

      <Section
        title="Organisation units"
        summary={summarise(
          [
            ...(state.orgUnits.useUserOrgUnit ? ["My units"] : []),
            ...state.orgUnits.units.map((unit) => unit.displayName),
            ...(state.orgUnits.level ? [`by ${state.orgUnits.level.toLowerCase()}`] : []),
          ],
          "No organisation unit chosen",
        )}
      >
        <OrgUnitPicker
          selection={state.orgUnits}
          onChange={(orgUnits) => onChange({ ...state, orgUnits })}
        />
      </Section>

      <Section title="Options" summary={aggregationLabel(state.aggregationType)}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="aggregation">Aggregation</Label>
            <Select
              id="aggregation"
              className="mt-1"
              value={state.aggregationType}
              onChange={(event) => onChange({ ...state, aggregationType: event.target.value })}
            >
              {AGGREGATION_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted">
              Overrides how DHIS2 combines values across periods and units. Leave as
              configured unless you know the measure tolerates it.
            </p>
          </div>

          <Checkbox
            label={<span className="text-xs text-ink-2">Split by category option combination</span>}
            checked={state.includeCategories}
            onChange={(event) =>
              onChange({ ...state, includeCategories: event.target.checked })
            }
          />
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-2 bg-plane/90 px-1 py-3 backdrop-blur">
        <Button
          variant="primary"
          className="flex-1"
          onClick={onRun}
          disabled={!canRun}
          loading={running}
        >
          {!running ? <Play className="size-3.5" aria-hidden /> : null}
          {running ? "Running…" : dirty ? "Run query" : "Run again"}
        </Button>
        <Button
          variant="ghost"
          size="md"
          onClick={() => onChange(DEFAULT_QUERY)}
          title="Reset the query"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          <span className="sr-only">Reset</span>
        </Button>
      </div>

      {missing.length ? (
        <p className="text-xs text-ink-2">Still needed: {missing.join(", ")}.</p>
      ) : dirty ? (
        <p className="text-xs text-ink-2">The selection has changed — run it to update.</p>
      ) : null}
    </div>
  );
}

function aggregationLabel(value: string): string {
  return AGGREGATION_TYPES.find((option) => option.value === value)?.label ?? value;
}
