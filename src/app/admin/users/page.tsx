import type { Metadata } from "next";
import { UsersAdmin } from "@/components/auth/users-admin";
import { PageHeader } from "@/components/page-header";
import { currentSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Manage users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await currentSession();
  const isAdmin = session !== "off" && session !== null && session.role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manage users"
        description="Site accounts: add people, reset passwords, choose who is an administrator, and turn accounts off."
      />
      {isAdmin ? (
        <UsersAdmin />
      ) : (
        <p className="rounded-xl border border-hair bg-surface p-5 text-sm text-ink-2">
          Only an administrator can manage accounts. Ask one to give you access.
        </p>
      )}
    </div>
  );
}
