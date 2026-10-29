import type { Metadata } from "next";
import { GeoEpiWorkspace } from "@/components/geoepi/geoepi-workspace";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "GeoEpi" };

/** Only these are passed on to the viewer: the Maps page links here with them. */
const LAUNCH_PARAMS = ["notebook", "dataset"] as const;

export default async function GeoEpiPage({ searchParams }: PageProps<"/geoepi">) {
  const params = await searchParams;
  const launch = new URLSearchParams();
  for (const name of LAUNCH_PARAMS) {
    const value = params[name];
    if (typeof value === "string" && value) launch.set(name, value);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="GeoEpi"
        description="Run the spatial epidemiology modules on the server, explore the map layers they produce, and download reports, GeoJSON and GeoPackage outputs."
      />
      <GeoEpiWorkspace launch={launch.toString()} />
    </div>
  );
}
