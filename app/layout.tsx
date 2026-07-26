import { Inter } from "next/font/google";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@sovereignsquad/gds-theme/styles.css";
import "./globals.css";
import { PwaSetup } from "./components/PwaSetup";
import { Providers } from "./components/Providers";
import { AppNav } from "./components/AppNav";
import { BackToTopButton } from "./components/BackToTopButton";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  // Brand-specific pages (e.g. /sales/[brand]) set `title` to just the
  // brand label via generateMetadata(); Next.js substitutes it into this
  // template so browser tabs show the brand name first — easier to tell
  // apart when multiple brand tabs are open side by side.
  title: {
    template: "%s · Sales Lead Generator",
    default: "Sales Lead Generator",
  },
  description: "AI-powered sales lead collection platform" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} data-gds-theme-preset="default">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no" />
        <meta name="theme-color" content="#1a1a2e" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>
        <Providers>
          <PwaSetup />
          <BackToTopButton />
          {/* Issue #95: the only persistent, always-reachable nav surface
              in the app — every other page previously had no link to any
              other page at all, including Sales Settings. A bare icon with
              no label read as decorative and was missed entirely in real
              use; pairing it with the app name makes the whole bar
              unambiguously a header/nav, not a stray floating icon. */}
          <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--mantine-color-body)', borderBottom: '1px solid var(--mantine-color-gray-3)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AppNav />
            <span style={{ fontWeight: 700, fontSize: '15px' }}>Sales Lead Generator</span>
          </div>
          {children}
        </Providers>
      </body>
    </html>
  );
}
