"use client";

import * as React from "react";
import { Download, BarChart3, ImageDown, Table2 } from "lucide-react";
import { Button, Segmented } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { downloadChartImage, type ImageFormat } from "@/lib/chart-image";
import { stamped } from "@/lib/download";
import type { SeriesDescriptor } from "@/lib/dhis2/analytics";
import { seriesColor } from "./palette";

export type ChartView = "chart" | "table";

/** A chart title as a filename stem: lower case, words joined by hyphens. */
function slug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "chart";
}

/**
 * The frame every chart sits in: title, controls, legend, plot, footnote.
 *
 * The table view is not optional decoration. Three hues in the light palette
 * sit below 3:1 against the surface, and the relief rule for that is a
 * readable table — so every figure here can be read as numbers.
 */
export function ChartFrame({
  title,
  description,
  view,
  onViewChange,
  onDownload,
  legend,
  footnote,
  toolbar,
  children,
  className,
  style,
}: {
  title: string;
  description?: string;
  view?: ChartView;
  onViewChange?: (view: ChartView) => void;
  onDownload?: () => void;
  legend?: React.ReactNode;
  footnote?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Repaints the frame, e.g. a user-chosen background with matching ink. */
  style?: React.CSSProperties;
}) {
  const frameRef = React.useRef<HTMLElement>(null);
  const [plotted, setPlotted] = React.useState(false);
  const [imageError, setImageError] = React.useState<string | null>(null);

  // Whether there is anything to rasterise depends on what the children
  // rendered, so it is read back from the DOM rather than declared: the pivot
  // heat table is an HTML table, and a table view has no plot at all. Swapping
  // chart type replaces the plot without remounting this frame, so the check
  // follows the container rather than running once.
  React.useEffect(() => {
    const plot = frameRef.current?.querySelector("[data-chart-plot]");
    if (!plot) return;

    const sync = () => setPlotted(Boolean(plot.querySelector("svg")));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(plot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function saveImage(format: ImageFormat) {
    if (!frameRef.current) return;
    setImageError(null);
    try {
      await downloadChartImage(frameRef.current, format, stamped(slug(title)));
    } catch (cause) {
      setImageError(
        cause instanceof Error ? cause.message : "The chart could not be exported.",
      );
    }
  }

  return (
    <figure
      ref={frameRef}
      className={cn("rounded-xl border border-hair bg-surface", className)}
      style={style}
    >
      <figcaption className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 data-chart-title className="text-sm font-semibold text-ink">
            {title}
          </h3>
          {description ? (
            <p data-chart-description className="mt-0.5 text-xs text-ink-2">
              {description}
            </p>
          ) : null}
        </div>
        {/* Controls keep the theme's look whatever the frame is painted. */}
        <div className="theme-ink no-print flex flex-wrap items-center gap-2">
          {toolbar}
          {view && onViewChange ? (
            <Segmented
              ariaLabel="Show as chart or table"
              value={view}
              onChange={onViewChange}
              options={[
                { value: "chart", label: "Chart", icon: <BarChart3 className="size-3.5" /> },
                { value: "table", label: "Table", icon: <Table2 className="size-3.5" /> },
              ]}
            />
          ) : null}
          {onDownload ? (
            <Button size="sm" variant="secondary" onClick={onDownload}>
              <Download className="size-3.5" aria-hidden />
              CSV
            </Button>
          ) : null}
          {plotted ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveImage("png")}
                title="Save this chart as a PNG image"
              >
                <ImageDown className="size-3.5" aria-hidden />
                PNG
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveImage("jpeg")}
                title="Save this chart as a JPEG image"
              >
                <ImageDown className="size-3.5" aria-hidden />
                JPG
              </Button>
            </>
          ) : null}
        </div>
      </figcaption>

      {legend ? (
        <div data-chart-legend className="px-5 pt-3">
          {legend}
        </div>
      ) : null}

      <div data-chart-plot className="px-2 py-4 sm:px-4">
        {children}
      </div>

      {imageError ? (
        <p className="no-print border-t border-hair px-5 py-2.5 text-xs text-critical">
          {imageError}
        </p>
      ) : null}

      {footnote ? (
        <p className="border-t border-hair px-5 py-2.5 text-xs text-ink-2">{footnote}</p>
      ) : null}
    </figure>
  );
}

/**
 * Identity never rests on colour alone: two or more series always carry a
 * legend. One series carries none — the title already names it.
 */
export function ChartLegend({
  series,
  shape = "line",
}: {
  series: SeriesDescriptor[];
  shape?: "line" | "dot";
}) {
  if (series.length < 2) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {series.map((item, index) => (
        <li key={item.id} className="flex items-center gap-1.5 text-xs text-ink-2">
          <span
            aria-hidden
            className={cn("shrink-0 rounded-full", shape === "line" ? "h-0.5 w-4" : "size-2")}
            style={{ background: seriesColor(index) }}
          />
          <span className="truncate" title={item.name}>
            {item.name}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Scale legend for a sequential fill — required whenever magnitude is a colour. */
export function ScaleLegend({
  min,
  max,
  stops,
  format,
}: {
  min: number;
  max: number;
  stops: string[];
  format: (value: number) => string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-2">
      <span className="tabular-nums">{format(min)}</span>
      <span className="flex overflow-hidden rounded-sm border border-hair" aria-hidden>
        {stops.map((stop, index) => (
          <span key={index} className="h-3 w-6" style={{ background: stop }} />
        ))}
      </span>
      <span className="tabular-nums">{format(max)}</span>
    </div>
  );
}
