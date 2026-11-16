import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { readAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const config = readAuthConfig();
  const query = await searchParams;
  const rawNext = query?.next;
  const next = safeNext(typeof rawNext === "string" ? rawNext : null);

  let serverHost: string | null = null;
  if (config.dhis2Url) {
    try {
      serverHost = new URL(config.dhis2Url).host;
    } catch {
      serverHost = null;
    }
  }

  return (
    <LoginForm
      next={next}
      problem={config.enabled ? config.problem : null}
      disabled={!config.enabled}
      dhis2Host={serverHost}
      localAccounts={config.localUsers.length > 0}
    />
  );
}
