"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Check,
  Grid3x3,
  LayoutDashboard,
  Library,
  Map as MapIcon,
  MessageCircle,
  Monitor,
  Scale,
  Moon,
  Microscope,
  Plug,
  Sun,
  Syringe,
  TriangleAlert,
} from "lucide-react";
import { useConnection } from "@/components/connection-provider";
import {
  getServerTheme,
  getTheme,
  nextTheme,
  setTheme,
  subscribeTheme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Support contact on WhatsApp. wa.me wants the number in international form
 * with no plus, spaces or leading zero: Ghana 024 682 8504 is 233 24 682 8504.
 */
const WHATSAPP_NUMBER = "233246828504";
const WHATSAPP_DISPLAY = "024 682 8504";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/explore", label: "Explore", icon: Activity },
  { href: "/pivot", label: "Pivot", icon: Grid3x3 },
  { href: "/maps", label: "Maps", icon: MapIcon },
  { href: "/geoepi", label: "GeoEpi", icon: Microscope },
  { href: "/measles", label: "Measles", icon: Syringe },
  { href: "/compare", label: "Compare", icon: Scale },
  { href: "/metadata", label: "Metadata", icon: Library },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-40 border-b border-hair bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-white"
            >
              D2
            </span>
            <span className="hidden text-sm font-semibold text-ink sm:inline">
              DHIS2 Analysis
            </span>
          </Link>

          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {NAV.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-surface-2 text-ink"
                      : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <ConnectionPill />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="no-print border-t border-hair px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-xs text-muted">
          <p>
            Reads the DHIS2 Web API through a server-side proxy. The token stays on the
            server and every request is read-only.
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Built by <span className="font-medium text-ink-2">Bigvalues IT Systems</span>
            </span>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-accent hover:underline"
              title="Chat with Bigvalues IT Systems on WhatsApp"
            >
              <MessageCircle className="size-3.5" aria-hidden />
              WhatsApp {WHATSAPP_DISPLAY}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function ConnectionPill() {
  const { status, loading } = useConnection();

  const connected = status?.connected === true;
  const label = loading
    ? "Checking…"
    : connected
      ? (status?.system?.version ?? "Connected")
      : "Not connected";

  const Icon = loading ? Plug : connected ? Check : TriangleAlert;

  return (
    <Link
      href="/connect"
      title={connected ? status?.baseUrl : "Set up the DHIS2 connection"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-hair px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface-2",
        connected ? "text-success-text" : loading ? "text-ink-2" : "text-critical",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="max-w-32 truncate">{label}</span>
    </Link>
  );
}

function ThemeToggle() {
  const theme = React.useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme(theme))}
      className="inline-grid size-8 place-items-center rounded-lg border border-hair text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      title={`Theme: ${theme}. Click to change.`}
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">Change theme (currently {theme})</span>
    </button>
  );
}
