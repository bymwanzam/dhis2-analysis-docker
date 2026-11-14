"use client";

import * as React from "react";
import { Check, Paintbrush } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { usePersistentState } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MAP_SCHEME,
  MAP_SCHEMES,
  isMapScheme,
  mapRamp,
  type MapScheme,
} from "./palette";

const SCHEME_KEY = "dhis2.map.scheme";

/**
 * The viewer's map colour scheme.
 *
 * A viewing preference, not part of the analysis, so it is not scoped to the
 * server: the same choice colours the Explore map and the Maps page, and it
 * survives reloads. A value this build does not know (an older or newer
 * browser store) falls back to the default rather than to a missing token.
 */
export function useMapScheme(): [MapScheme, (scheme: MapScheme) => void] {
  const [stored, setStored] = usePersistentState<string>(SCHEME_KEY, DEFAULT_MAP_SCHEME);
  const scheme = isMapScheme(stored) ? stored : DEFAULT_MAP_SCHEME;
  return [scheme, setStored];
}

/** The six steps of a ramp in a row, low to high. */
function Ramp({ scheme, className }: { scheme: MapScheme; className?: string }) {
  return (
    <span aria-hidden className={cn("flex overflow-hidden rounded-sm", className)}>
      {mapRamp(scheme).map((fill) => (
        <span key={fill} className="h-full flex-1" style={{ background: fill }} />
      ))}
    </span>
  );
}

/**
 * Chooses the ramp a choropleth's classes are drawn in.
 *
 * Every option is a single hue running pale to deep for low to high, so the
 * reading "darker means more" holds whichever is chosen. The legend beside
 * the map is drawn from the same ramp, so it changes with it.
 */
export function MapSchemePicker({
  value,
  onChange,
}: {
  value: MapScheme;
  onChange: (value: MapScheme) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = MAP_SCHEMES.find((scheme) => scheme.id === value)?.label ?? value;

  return (
    <div ref={rootRef} className="relative">
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((state) => !state)}
        title="Change the colours the map classes are drawn in"
      >
        <Ramp scheme={value} className="h-3 w-9 border border-hair" />
        <Paintbrush className="size-3.5" aria-hidden />
        Colours: {label}
      </Button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Map colours"
          className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-hair bg-surface p-2 shadow-lg"
        >
          <ul className="space-y-0.5">
            {MAP_SCHEMES.map((scheme) => {
              const active = scheme.id === value;
              return (
                <li key={scheme.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      onChange(scheme.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2",
                      active && "bg-surface-2 font-medium",
                    )}
                  >
                    <Ramp scheme={scheme.id} className="h-4 w-16 shrink-0 border border-hair" />
                    <span className="flex-1">{scheme.label}</span>
                    {active ? <Check className="size-3.5 text-accent" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-2 px-2 text-[11px] leading-snug text-muted">
            One hue, pale to deep for low to high, so a darker area always holds a larger
            value. Areas with no data stay grey. The choice is remembered in this browser
            and applies to the Explore map as well.
          </p>
        </div>
      ) : null}
    </div>
  );
}
