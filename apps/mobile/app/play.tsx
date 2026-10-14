import { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { FeedScreen, type FeedSource } from "../src/feed/FeedScreen";

/** A feed scoped to a hashtag or opened from a game page / grid tile. */
export default function Play() {
  const { tag, first, reason, title } = useLocalSearchParams<{ tag?: string; first?: string; reason?: string; title?: string }>();
  const source: FeedSource = useMemo(
    () => ({ tab: "foryou", tag: tag ?? null, first: first ?? null, firstReason: reason === "gamePage" ? "gamePage" : "feed" }),
    [tag, first, reason],
  );
  return <FeedScreen source={source} mode="scoped" title={title ?? (tag ? `#${tag}` : "")} />;
}
