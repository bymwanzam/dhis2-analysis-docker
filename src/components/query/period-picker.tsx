"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Label, Segmented, Select } from "@/components/ui/primitives";
import {
  RELATIVE_PERIODS,
  estimatePoints,
  findPeriodOption,
  fixedYears,
  monthsOfYear,
} from "@/lib/dhis2/periods";
import { formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "relative" | "fixed";

/**
 * Picks the period dimension.
 *
 * Relative periods are resolved by DHIS2 at request time, so a saved query
 * keeps meaning "the last 12 months" instead of freezing to a list of months.
 */
export function PeriodPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (periods: string[]) => void;
}) {
  const [mode, setMode] = React.useState<Mode>("relative");
  const [year, setYear] = React.useState(() => new Date().getFullYear());

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((entry) => entry !== id));
      return;
    }
    onChange([...selected, id]);
  }

  const points = estimatePoints(selected);

  return (
    <div className="space-y-3">
      <Segmented
        ariaLabel="Period type"
        value={mode}
        onChange={setMode}
        options={[
          { value: "relative", label: "Relative" },
          { value: "fixed", label: "Fixed" },
        ]}
      />

      {selected.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex items-center gap-1 rounded-full border border-hair bg-surface-2 py-1 pl-2.5 pr-1.5 text-xs text-ink hover:border-critical"
                title={`Remove ${labelOf(id)}`}
              >
                {labelOf(id)}
                <X className="size-3 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {mode === "relative" ? (
        <div className="space-y-3">
          {RELATIVE_PERIODS.map((group) => (
            <fieldset key={group.label}>
              <legend className="mb-1.5 text-xs font-medium text-ink-2">{group.label}</legend>
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((option) => {
                  const active = selected.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(option.id)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                        active
                          ? "border-accent bg-accent text-white"
                          : "border-hair bg-surface text-ink-2 hover:text-ink",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label htmlFor="period-year">Year</Label>
            <Select
              id="period-year"
              className="mt-1"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {fixedYears(12).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FixedChip id={String(year)} selected={selected} onToggle={toggle} label="Whole year" />
            {[1, 2, 3, 4].map((quarter) => (
              <FixedChip
                key={quarter}
                id={`${year}Q${quarter}`}
                selected={selected}
                onToggle={toggle}
                label={`Q${quarter}`}
              />
            ))}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-2">Months</p>
            <div className="flex flex-wrap gap-1.5">
              {monthsOfYear(year).map((period) => (
                <FixedChip
                  key={period}
                  id={period}
                  selected={selected}
                  onToggle={toggle}
                  label={formatPeriod(period).split(" ")[0]}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        {selected.length === 0
          ? "Choose at least one period."
          : `About ${points} period${points === 1 ? "" : "s"} of data.`}
      </p>
    </div>
  );
}

function FixedChip({
  id,
  label,
  selected,
  onToggle,
}: {
  id: string;
  label: string;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const active = selected.includes(id);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onToggle(id)}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-accent bg-accent text-white"
          : "border-hair bg-surface text-ink-2 hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

function labelOf(id: string): string {
  return findPeriodOption(id)?.label ?? formatPeriod(id);
}
