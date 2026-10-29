"use client";

import Link from "next/link";
import { useConnection } from "@/components/connection-provider";
import { Alert, Spinner } from "@/components/ui/primitives";
import { GEOEPI_VIEWER_PATH } from "@/lib/geoepi/paths";

/**
 * The GeoEpi viewer, framed inside the app shell.
 *
 * The viewer is GeoEpi's own page, served same-origin through the
 * authenticated /geoepi/ proxy. It follows the shell's theme by watching this
 * page's <html data-theme>, and drops its own title and back link when framed.
 */
export function GeoEpiWorkspace({ launch }: { launch: string }) {
  const { status, loading } = useConnection();

  if (loading) {
    return (
      <div className="flex justify-center rounded-xl border border-hair bg-surface py-24">
        <Spinner label="Checking the connection" />
      </div>
    );
  }

  if (status?.connected !== true) {
    return (
      <Alert tone="error" title="No DHIS2 connection">
        GeoEpi opens for connected users only. Add a server URL and access token on the{" "}
        <Link href="/connect" className="font-medium text-accent underline">
          connection page
        </Link>{" "}
        first.
      </Alert>
    );
  }

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
