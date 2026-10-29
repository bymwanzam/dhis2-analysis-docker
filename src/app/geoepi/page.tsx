import type { Metadata } from "next";
import { GeoEpiWorkspace } from "@/components/geoepi/geoepi-workspace";
import { PageHeader } from "@/components/page-header";
import { geoEpiLaunch } from "@/lib/geoepi/launch";

export const metadata: Metadata = { title: "GeoEpi" };

export default async function GeoEpiPage({ searchParams }: PageProps<"/geoepi">) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="GeoEpi"
        description="Run the spatial epidemiology modules on the server, explore the map layers they produce, and download reports, GeoJSON and GeoPackage outputs."
      />
      <GeoEpiWorkspace launch={geoEpiLaunch(await searchParams)} />
    </div>
  );
}
