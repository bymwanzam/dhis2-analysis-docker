import type { Metadata } from "next";
import { MetadataBrowser } from "@/components/metadata/metadata-browser";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Metadata" };

export default function MetadataPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Metadata"
        description="Search the indicators, data elements, data sets and hierarchy defined on this DHIS2 server."
      />
      <MetadataBrowser />
    </div>
  );
}
