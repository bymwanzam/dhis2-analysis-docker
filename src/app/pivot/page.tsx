import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PivotWorkbench } from "@/components/pivot/pivot-workbench";

export const metadata: Metadata = { title: "Pivot" };

export default function PivotPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pivot"
        description="Cross-tabulate any two dimensions of a query and read the whole matrix at once."
      />
      <PivotWorkbench />
    </div>
  );
}
