"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collapsible part of a query builder.
 *
 * Built on <details> so keyboard and screen-reader behaviour comes from the
 * platform, and so the summary line can carry the current selection — the
 * panel stays readable while collapsed.
 */
export function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn("group rounded-xl border border-hair bg-surface", "open:pb-4")}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-2">{summary}</span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="px-4">{children}</div>
    </details>
  );
}

/** "Malaria, ANC 1 +3 more" — a selection compressed to one line. */
export function summarise(items: string[], empty: string): string {
  if (!items.length) return empty;
  if (items.length <= 2) return items.join(", ");
  return `${items.slice(0, 2).join(", ")} +${items.length - 2} more`;
}
