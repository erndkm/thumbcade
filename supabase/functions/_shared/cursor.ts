/**
 * Opaque feed cursor (base64url JSON). Carries the session state rank_feed needs to keep a feed
 * de-duplicated and diverse across pages.
 */
import { base64url, fromBase64url } from "./token.ts";

export interface FeedCursor {
  /** Stable id of this feed session; card ids are `${feedId}:${pos}`. */
  feedId: string;
  /** Next card position. */
  pos: number;
  /** Game ids served in this session, oldest first (bounded). */
  seen: string[];
  lastCreator: string | null;
  lastTag: string | null;
}

export const CURSOR_SEEN_MAX = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newFeedId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `f${base64url(bytes)}`;
}

export function encodeCursor(c: FeedCursor): string {
  return base64url(new TextEncoder().encode(JSON.stringify(c)));
}

/** Decodes a cursor; anything malformed yields null (the caller starts a new feed session). */
export function decodeCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw || raw.length > 8192) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(fromBase64url(raw))) as Partial<FeedCursor>;
    if (typeof v.feedId !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(v.feedId)) return null;
    const pos = Number.isInteger(v.pos) && (v.pos as number) >= 0 ? (v.pos as number) : 0;
    const seen = Array.isArray(v.seen) ? v.seen.filter((s): s is string => typeof s === "string" && UUID.test(s)).slice(-CURSOR_SEEN_MAX) : [];
    const lastCreator = typeof v.lastCreator === "string" && UUID.test(v.lastCreator) ? v.lastCreator : null;
    const lastTag = typeof v.lastTag === "string" && /^[a-z0-9_]{1,32}$/.test(v.lastTag) ? v.lastTag : null;
    return { feedId: v.feedId, pos, seen, lastCreator, lastTag };
  } catch {
    return null;
  }
}

/** Advances a cursor past a page of served cards. */
export function advanceCursor(
  c: FeedCursor,
  served: { gameId: string; creatorId: string; primaryTag: string | null }[],
): FeedCursor {
  if (served.length === 0) return c;
  const last = served[served.length - 1]!;
  return {
    feedId: c.feedId,
    pos: c.pos + served.length,
    // Keep only the latest occurrence of each game so rank_feed's recycling is least-recently-served.
    seen: dedupeKeepLast([...c.seen, ...served.map((s) => s.gameId)]).slice(-CURSOR_SEEN_MAX),
    lastCreator: last.creatorId,
    lastTag: last.primaryTag,
  };
}

function dedupeKeepLast(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i]!;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.reverse();
}
