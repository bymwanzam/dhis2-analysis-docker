import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProgramWorkbench } from "@/components/programs/program-workbench";
import { findProgramTab } from "@/lib/dhis2/programs";

export async function generateMetadata({
  params,
}: PageProps<"/programs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: findProgramTab(slug)?.name ?? "Program" };
}

/**
 * One event program. `?item=<id or code>` opens it with that item selected,
 * which is how the Metadata page's Event data items list links here.
 */
export default async function ProgramPage({ params, searchParams }: PageProps<"/programs/[slug]">) {
  const { slug } = await params;
  const tab = findProgramTab(slug);
  if (!tab) notFound();

  const query = await searchParams;
  const rawItem = query?.item;
  const item = typeof rawItem === "string" ? rawItem : Array.isArray(rawItem) ? rawItem[0] : null;

  return (
    <div className="space-y-6">
      <PageHeader title={tab.name} description={tab.description} />
      <ProgramWorkbench tab={tab} initialItem={item ?? null} />
    </div>
  );
}
