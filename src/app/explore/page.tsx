import type { Metadata } from "next";
import { ExploreWorkbench } from "@/components/explore/explore-workbench";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Explore"
        description="Build an analytics query from data, period and organisation unit, then read it as a chart, a set of figures or a table."
      />
      <ExploreWorkbench />
    </div>
  );
}
