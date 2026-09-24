import type { Metadata } from "next";
import { ConnectionForm } from "@/components/connection-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Connection" };

export default function ConnectPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Connection"
        description="Point this app at a DHIS2 server and authenticate with a personal access token."
      />
      <ConnectionForm />
    </div>
  );
}
