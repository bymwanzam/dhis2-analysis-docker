import type { Metadata } from "next";
import { CompareWorkbench } from "@/components/compare/compare-workbench";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Compare"
        description="Check two data elements against each other and find the organisation units where the relationship between them breaks down."
      />
      <CompareWorkbench />
    </div>
  );
}
