/** Push notification copy. Short, a little playful, never shouty. */
import { milestoneCopy, MilestoneKindSchema } from "./protocol.ts";

export interface NotificationRow {
  type: string;
  payload: Record<string, unknown> | null;
  actorHandle: string | null;
  gameName: string | null;
  gameSlug: string | null;
}

export interface PushCopy {
  title: string;
  body: string;
  /** Deep link path inside the app. */
  url: string;
}

function fmt(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "a score";
}

export function pushCopy(n: NotificationRow): PushCopy | null {
  const who = n.actorHandle ? `@${n.actorHandle}` : "Someone";
  const game = n.gameName ?? "a game";
  const gameUrl = n.gameSlug ? `/g/${n.gameSlug}` : "/inbox";
  const p = n.payload ?? {};
  switch (n.type) {
    case "follow":
      return { title: "New follower", body: `${who} followed you.`, url: n.actorHandle ? `/u/${n.actorHandle}` : "/inbox" };
    case "comment_like":
      return { title: "Your comment landed", body: `${who} liked your comment on ${game}.`, url: gameUrl };
    case "comment_reply":
      return {
        title: `${who} replied`,
        body: typeof p.excerpt === "string" ? `"${p.excerpt}"` : `New reply on ${game}.`,
        url: gameUrl,
      };
    case "score_beaten":
      return { title: "Your record fell", body: `${who} beat your ${fmt(p.theirBest)} on ${game} with ${fmt(p.score)}.`, url: gameUrl };
    case "challenge_accepted":
      return p.beat === true
        ? { title: "Challenge lost", body: `${who} beat your ${fmt(p.challengeScore)} on ${game}. Run it back?`, url: gameUrl }
        : { title: "Challenge held", body: `${who} took your ${game} challenge and fell short at ${fmt(p.score)}.`, url: gameUrl };
    case "new_game":
      return { title: "New drop", body: `${who} just shipped ${game}. Tap to play.`, url: gameUrl };
    case "game_approved":
      return { title: "You're live", body: `${game} passed review and is in the feed.`, url: gameUrl };
    case "game_rejected":
      return { title: "Review notes", body: `${game} needs changes before it can go live.`, url: "/create" };
    case "milestone": {
      const kind = MilestoneKindSchema.safeParse(p.kind);
      if (!kind.success || typeof p.threshold !== "number" || typeof p.value !== "number") return null;
      const detail = typeof p.detail === "object" && p.detail !== null ? (p.detail as { players?: number; ratio?: number }) : {};
      const copy = milestoneCopy({ kind: kind.data, threshold: p.threshold, value: p.value, detail }, game);
      return { title: copy.title, body: copy.body, url: "/create" };
    }
    default:
      return null;
  }
}
