"use client";

import * as React from "react";
import { Check, Palette, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { parseHex, toHex } from "@/lib/color";
import { cn } from "@/lib/utils";

export const PANEL_PRESETS = [
  { label: "White", value: "#ffffff" },
  { label: "Light grey", value: "#e5e7eb" },
  { label: "Dark grey", value: "#374151" },
  { label: "Black", value: "#000000" },
  { label: "Light blue", value: "#dbeafe" },
] as const;

/**
 * Chooses the background of the panel a map sits in.
 *
 * Every choice applies as it is made — the custom picker included, while it
 * is being dragged — and null means "the theme's own surface".
 */
export function BackgroundPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
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

  const current = value && parseHex(value) ? toHex(parseHex(value)!) : null;
  const preset = PANEL_PRESETS.find((option) => option.value === current);
  const summary = !current ? "Default" : (preset?.label ?? current);

  return (
    <div ref={rootRef} className="relative">
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((state) => !state)}
        title="Change the background behind the map"
      >
        <span
          aria-hidden
          className="size-3 rounded-sm border border-hair"
          style={{ background: current ?? "var(--surface)" }}
        />
        <Palette className="size-3.5" aria-hidden />
        Background: {summary}
      </Button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Map background"
          className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-hair bg-surface p-2 shadow-lg"
        >
          <ul className="space-y-0.5">
            {PANEL_PRESETS.map((option) => {
              const active = option.value === current;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2",
                      active && "bg-surface-2 font-medium",
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-4 shrink-0 rounded border border-hair"
                      style={{ background: option.value }}
                    />
                    <span className="flex-1">{option.label}</span>
                    {active ? <Check className="size-3.5 text-accent" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 border-t border-hair pt-2">
            <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
              <input
                type="color"
                value={current ?? "#ffffff"}
                onChange={(event) => onChange(event.target.value)}
                className="size-5 shrink-0 cursor-pointer rounded border border-hair bg-transparent p-0"
              />
              <span className="flex-1">Custom colour…</span>
              {current && !preset ? (
                <span className="font-mono text-xs text-ink-2">{current}</span>
              ) : null}
            </label>

            <button
              type="button"
              disabled={!current}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Reset to default
            </button>
          </div>

          <p className="mt-2 px-2 text-[11px] leading-snug text-muted">
            Only the panel changes. The map, its colours and the legend keys stay as they
            are; text switches between dark and light to stay readable.
          </p>
        </div>
      ) : null}
    </div>
  );
}
