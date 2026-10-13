import type { Json } from "../types.ts";
import type { RequestHandlers } from "./index.ts";

/**
 * In-memory request handlers: storage lives as long as the host, leaderboards hold only what the
 * host reports through `recordScore`. The simulator and anonymous web play use these.
 */
export function memoryHandlers(
  initial: Record<string, Json> = {},
): RequestHandlers & { recordScore(score: number, order?: "asc" | "desc"): void } {
  const kv = new Map<string, Json>(Object.entries(initial));
  let best: number | null = null;
  return {
    "storage.get": ({ key }) => ({ value: kv.has(key) ? (kv.get(key) as Json) : null }),
    "storage.set": ({ key, value }) => {
      kv.set(key, value);
      return { ok: true as const };
    },
    "leaderboard.top": () => ({
      entries: best === null ? [] : [{ rank: 1, name: "You", avatarUrl: null, score: best, isMe: true }],
    }),
    "leaderboard.me": () => ({ best, rank: best === null ? null : 1, percentile: null }),
    "share.challenge": () => ({ shared: false }),
    recordScore(score, order = "desc") {
      if (best === null || (order === "asc" ? score < best : score > best)) best = score;
    },
  };
}
