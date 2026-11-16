import type { Metadata } from "next";
import { AccountView } from "@/components/auth/account-view";
import { PageHeader } from "@/components/page-header";
import { currentSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "My account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const session = await currentSession();
  const query = await searchParams;
  const first = query?.first === "1";

  return (
    <div className="space-y-6">
      <PageHeader title="My account" description="Who you are signed in as, and your password." />
      {session === "off" || !session ? (
        <p className="text-sm text-ink-2">Sign-in is switched off on this server, so there is no account to manage.</p>
      ) : (
        <AccountView
          account={{ name: session.sub, displayName: session.name, role: session.role, via: session.via }}
          mustChange={session.mustChange}
          first={first}
        />
      )}
    </div>
  );
}
