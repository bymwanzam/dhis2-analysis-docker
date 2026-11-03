import { GEOEPI_VIEWER_PATH } from "@/lib/geoepi/paths";

/**
 * The GeoEpi viewer, framed inside the app shell.
 *
 * The viewer is GeoEpi's own page, served same-origin through the /geoepi/
 * proxy. It opens with or without a DHIS2 connection. It follows the shell's
 * theme by watching this page's <html data-theme>, and drops its own title and
 * back link when framed.
 */
export function GeoEpiWorkspace({ launch }: { launch: string }) {
  const src = `/geoepi/${GEOEPI_VIEWER_PATH}${launch ? `?${launch}` : ""}`;

  return (
    <iframe
      // A new launch (from Maps) remounts the frame rather than leaving the old run open.
      key={src}
      src={src}
      title="GeoEpi viewer"
      className="block h-[calc(100dvh-12rem)] min-h-[560px] w-full rounded-xl border border-hair bg-surface"
    />
  );
}
