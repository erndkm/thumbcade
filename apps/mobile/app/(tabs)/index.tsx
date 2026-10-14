import { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import type { FeedTab } from "@thumbcade/protocol";
import { FeedScreen, type FeedSource } from "../../src/feed/FeedScreen";
import { useSettings } from "../../src/state/settings";
import { useDevCards } from "../../src/state/devCards";

/** Home: Following | For You. Deep links land here with `first` (and a challenge). */
export default function Home() {
  const params = useLocalSearchParams<{ first?: string; code?: string; from?: string; score?: string; reason?: string; n?: string }>();
  const tab = useSettings((s) => s.lastTab);
  const set = useSettings((s) => s.set);
  const devCards = useDevCards((s) => s.cards);
  const source: FeedSource = useMemo(
    () => ({
      tab: params.first ? "foryou" : tab,
      first: params.first ?? null,
      challenge:
        params.code && params.first
          ? { code: params.code, fromName: params.from ?? "A friend", score: params.score !== undefined && params.score !== "" ? Number(params.score) : null }
          : null,
      firstReason: params.reason === "gamePage" ? "gamePage" : "feed",
      // A deep-linked game always comes first; developer cards only lead the regular feed.
      devCards: params.first ? [] : devCards,
    }),
    // `n` forces a fresh feed when the same link is opened twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, params.first, params.code, params.from, params.score, params.reason, params.n, devCards],
  );
  return <FeedScreen key={`${source.tab}|${source.first ?? ""}|${params.n ?? ""}|${devCards.length}`} source={source} mode="home" onTabChange={(t: FeedTab) => set({ lastTab: t })} />;
}
