import { Inter } from "next/font/google";
import "@mantine/core/styles.css";
import "@sovereignsquad/gds-theme/styles.css";
import "./globals.css";
import { PwaSetup } from "./components/PwaSetup";
import { Providers } from "./components/Providers";

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
          {children}
        </Providers>
      </body>
    </html>
  );
}
