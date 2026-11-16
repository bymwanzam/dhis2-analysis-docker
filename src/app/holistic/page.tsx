import type { Metadata } from "next";
import { HolisticWorkspace } from "@/components/holistic/holistic-workspace";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Holistic Assessment" };

export default function HolisticPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Holistic Assessment"
        description="The Ghana Health Service annual assessment of regional and district performance, with peer review. It signs in with this app's DHIS2 connection."
      />
      <HolisticWorkspace />
    </div>
  );
}
