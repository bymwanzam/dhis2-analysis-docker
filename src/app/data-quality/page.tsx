import type { Metadata } from "next";
import { DqWorkbench } from "@/components/data-quality/dq-workbench";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Data Quality" };

export default function DataQualityPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Quality"
        description="Build rules from any data elements and indicators — add, subtract, multiply, divide, compare — check them across periods and organisation units, and get a report."
      />
      <DqWorkbench />
    </div>
  );
}
