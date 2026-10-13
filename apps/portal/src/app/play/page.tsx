import type { Metadata, Viewport } from "next";
import { FullscreenFeed } from "@/components/web-feed/fullscreen-feed";
import { getLiveGames } from "@/lib/data";
import { getWebViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Play",
  description: "The Thumbcade feed in your browser. Tap to play, swipe for the next game.",
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1, viewportFit: "cover", userScalable: false };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const [{ g }, games, viewer] = await Promise.all([searchParams, getLiveGames(40), getWebViewer()]);
  const first = g ? games.findIndex((c) => c.slug === g) : -1;
  const ordered = first > 0 ? [games[first]!, ...games.slice(0, first), ...games.slice(first + 1)] : games;
  return <FullscreenFeed cards={ordered} viewer={viewer} />;
}
