import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: "Thumbcade — swipe up for the next game", template: "%s · Thumbcade" },
  description:
    "An infinite vertical feed of games you can play with one thumb. Like, comment, challenge your friends — and build your own with the Thumbcade SDK.",
  applicationName: "Thumbcade",
  openGraph: { type: "website", siteName: "Thumbcade" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
