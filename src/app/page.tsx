import { Overview } from "@/components/overview/overview";
import { PageHeader } from "@/components/page-header";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="A read-only analysis workspace for a DHIS2 server: trends, rankings, cross-tabulations and the metadata behind them."
      />
      <Overview />
    </div>
  );
}
