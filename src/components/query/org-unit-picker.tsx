"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { Checkbox, Label, Select, Spinner } from "@/components/ui/primitives";
import { fetchOrgUnitChildren, fetchOrgUnitLevels, fetchOrgUnitRoots } from "@/lib/dhis2/client";
import { useAsyncData } from "@/lib/hooks";
import type { DimensionItem, OrgUnit } from "@/lib/dhis2/types";
import { cn } from "@/lib/utils";

export interface OrgUnitSelection {
  units: DimensionItem[];
  /** A LEVEL-n token, applied inside the selected units. */
  level: string;
  /** Use the org units attached to the token's own user. */
  useUserOrgUnit: boolean;
}

export function toOuDimension(selection: OrgUnitSelection): string[] {
  const parts: string[] = [];
  if (selection.level) parts.push(selection.level);
  if (selection.useUserOrgUnit) parts.push("USER_ORGUNIT");
  parts.push(...selection.units.map((unit) => unit.id));
  return parts;
}

/**
 * Picks the organisation unit dimension.
 *
 * The hierarchy is loaded a level at a time — a national DHIS2 tree is far
 * too large to pull in one request — and a level token can be combined with
 * the chosen parents to mean "every district inside these regions".
 */
export function OrgUnitPicker({
  selection,
  onChange,
}: {
  selection: OrgUnitSelection;
  onChange: (next: OrgUnitSelection) => void;
}) {
  const {
    data: roots,
    error,
    loading: loadingRoots,
  } = useAsyncData((signal) => fetchOrgUnitRoots(signal), []);

  const { data: levels } = useAsyncData((signal) => fetchOrgUnitLevels(signal), []);

  const selectedIds = React.useMemo(
    () => new Set(selection.units.map((unit) => unit.id)),
    [selection.units],
  );

  function toggleUnit(unit: OrgUnit) {
    if (selectedIds.has(unit.id)) {
      onChange({
        ...selection,
        units: selection.units.filter((entry) => entry.id !== unit.id),
      });
      return;
    }
    onChange({
      ...selection,
      units: [...selection.units, { id: unit.id, displayName: unit.displayName }],
    });
  }

  return (
    <div className="space-y-3">
      {selection.units.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {selection.units.map((unit) => (
            <li key={unit.id}>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...selection,
                    units: selection.units.filter((entry) => entry.id !== unit.id),
                  })
                }
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-hair bg-surface-2 py-1 pl-2.5 pr-1.5 text-xs text-ink hover:border-critical"
                title={`Remove ${unit.displayName}`}
              >
                <span className="truncate">{unit.displayName}</span>
                <X className="size-3 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="max-h-64 overflow-y-auto rounded-lg border border-hair px-1 py-1.5">
        {loadingRoots ? (
          <div className="px-2 py-6 text-center">
            <Spinner label="Loading hierarchy…" />
          </div>
        ) : error ? (
          <p className="px-2 py-6 text-center text-xs text-critical">{error}</p>
        ) : !roots?.length ? (
          <p className="px-2 py-6 text-center text-xs text-ink-2">
            This token cannot see any organisation units.
          </p>
        ) : (
          <ul>
            {roots.map((root) => (
              <TreeNode
                key={root.id}
                unit={root}
                depth={0}
                selectedIds={selectedIds}
                onToggle={toggleUnit}
                defaultExpanded={roots.length === 1}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <Label htmlFor="ou-level">Break down by level</Label>
        <Select
          id="ou-level"
          className="mt-1"
          value={selection.level}
          onChange={(event) => onChange({ ...selection, level: event.target.value })}
        >
          <option value="">Selected units only</option>
          {(levels ?? []).map((level) => (
            <option key={level.id} value={`LEVEL-${level.level}`}>
              All {level.displayName.toLowerCase()} within selection
            </option>
          ))}
        </Select>
      </div>

      <Checkbox
        label={<span className="text-xs text-ink-2">Include the token user&rsquo;s own units</span>}
        checked={selection.useUserOrgUnit}
        onChange={(event) =>
          onChange({ ...selection, useUserOrgUnit: event.target.checked })
        }
      />
    </div>
  );
}

function TreeNode({
  unit,
  depth,
  selectedIds,
  onToggle,
  defaultExpanded = false,
}: {
  unit: OrgUnit;
  depth: number;
  selectedIds: Set<string>;
  onToggle: (unit: OrgUnit) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const hasChildren = unit.leaf === false || unit.children !== undefined || depth < 4;

  // Children are fetched the first time a branch opens, and only then.
  const { data: children, loading } = useAsyncData(
    (signal) =>
      expanded ? fetchOrgUnitChildren(unit.id, signal) : Promise.resolve<OrgUnit[]>([]),
    [expanded, unit.id],
  );

  const checked = selectedIds.has(unit.id);

  return (
    <li>
      <div
        className="flex items-center gap-1 rounded-md hover:bg-surface-2"
        style={{ paddingLeft: depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${unit.displayName}` : `Expand ${unit.displayName}`}
            className="grid size-5 shrink-0 place-items-center text-muted hover:text-ink"
          >
            {expanded && loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : expanded ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onToggle(unit)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded border text-[10px]",
              checked ? "border-accent bg-accent text-white" : "border-hair",
            )}
          >
            {checked ? "✓" : ""}
          </span>
          <span className={cn("truncate", checked ? "text-ink" : "text-ink-2")}>
            {unit.displayName}
          </span>
        </button>
      </div>

      {expanded && children?.length ? (
        <ul>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              unit={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
