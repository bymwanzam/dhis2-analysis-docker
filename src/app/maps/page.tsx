import type { Metadata } from "next";
import { MapsWorkbench } from "@/components/maps/maps-workbench";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Maps" };

export default function MapsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Maps"
        description="Shade regions, districts or sub-districts by a count, a coverage or an indicator, then click an area to drill into the level beneath it."
      />
      <MapsWorkbench />
    </div>
  );
}
