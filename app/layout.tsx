import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GDSProvider } from "./components/gds-provider";
import "@mantine/core/styles.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CogMap - Pipeline Intelligence Platform",
  description: "AI-powered lead intelligence and pipeline management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <GDSProvider>{children}</GDSProvider>
      </body>
    </html>
  );
}
