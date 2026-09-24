import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { ConnectionProvider } from "@/components/connection-provider";
import { readConnection } from "@/lib/dhis2/connection";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "DHIS2 Analysis",
    template: "%s · DHIS2 Analysis",
  },
  description:
    "Explore, chart and cross-tabulate DHIS2 aggregate data through a read-only, token-authenticated connection.",
  robots: { index: false, follow: false },
};

/** Applied before paint so a stored theme never flashes the other mode. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("dhis2-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Cheap presence check only — the full probe happens client-side once.
  const hasCredentials = Boolean(await readConnection());

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <ConnectionProvider hasCredentials={hasCredentials}>
          <AppShell>{children}</AppShell>
        </ConnectionProvider>
      </body>
    </html>
  );
}
