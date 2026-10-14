import { describe, expect, it } from "vitest";
import { shareCode, SHARE_CODE_PATTERN } from "../../supabase/functions/_shared/codes.ts";
import { pushCopy } from "../../supabase/functions/_shared/copy.ts";
import { advanceCursor, CURSOR_SEEN_MAX, decodeCursor, encodeCursor, newFeedId } from "../../supabase/functions/_shared/cursor.ts";
import { signSessionToken, verifySessionToken } from "../../supabase/functions/_shared/token.ts";

const SECRET = "test-secret-at-least-16-chars";
const UUID = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

describe("session tokens", () => {
  const claims = { sid: UUID(1), uid: UUID(2), gid: UUID(3), iat: 1_700_000_000_000 };

  it("round-trips signed claims", async () => {
    const token = await signSessionToken(claims, SECRET);
    expect(await verifySessionToken(token, SECRET, { now: claims.iat + 1000 })).toEqual(claims);
  });

  it("rejects tampering, wrong secrets, and expired tokens", async () => {
    const token = await signSessionToken(claims, SECRET);
    const [body, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...claims, uid: UUID(9) })).toString("base64url");
    expect(await verifySessionToken(`${forged}.${sig}`, SECRET, { now: claims.iat })).toBeNull();
    expect(await verifySessionToken(`${body}.${sig.slice(0, -2)}xx`, SECRET, { now: claims.iat })).toBeNull();
    expect(await verifySessionToken(token, "another-secret-of-16+", { now: claims.iat })).toBeNull();
    expect(await verifySessionToken(token, SECRET, { now: claims.iat + 7 * 3600_000 })).toBeNull();
    expect(await verifySessionToken("garbage", SECRET)).toBeNull();
  });

  it("refuses short secrets", async () => {
    await expect(signSessionToken(claims, "short")).rejects.toThrow();
  });
});

describe("feed cursor", () => {
  it("encodes, decodes and advances", () => {
    const start = { feedId: newFeedId(), pos: 0, seen: [], lastCreator: null, lastTag: null };
    const next = advanceCursor(start, [
      { gameId: UUID(1), creatorId: UUID(10), primaryTag: "arcade" },
      { gameId: UUID(2), creatorId: UUID(11), primaryTag: "puzzle" },
    ]);
    expect(next).toEqual({ feedId: start.feedId, pos: 2, seen: [UUID(1), UUID(2)], lastCreator: UUID(11), lastTag: "puzzle" });
    expect(decodeCursor(encodeCursor(next))).toEqual(next);
  });

  it("keeps only the latest occurrence of a recycled game", () => {
    const c = advanceCursor({ feedId: "fabcd", pos: 3, seen: [UUID(1), UUID(2), UUID(3)], lastCreator: null, lastTag: null }, [
      { gameId: UUID(1), creatorId: UUID(10), primaryTag: null },
    ]);
    expect(c.seen).toEqual([UUID(2), UUID(3), UUID(1)]);
  });

  it("bounds the seen list and sanitizes junk", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ gameId: UUID(i), creatorId: UUID(100), primaryTag: null }));
    const c = advanceCursor({ feedId: "fabcd", pos: 0, seen: [], lastCreator: null, lastTag: null }, many);
    expect(c.seen).toHaveLength(CURSOR_SEEN_MAX);
    expect(c.seen.at(-1)).toBe(UUID(59));
    const junk = Buffer.from(JSON.stringify({ feedId: "fabcd", pos: -3, seen: ["x", UUID(1)], lastCreator: "nope", lastTag: "Bad Tag" })).toString("base64url");
    expect(decodeCursor(junk)).toEqual({ feedId: "fabcd", pos: 0, seen: [UUID(1)], lastCreator: null, lastTag: null });
    expect(decodeCursor("%%%")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe("share codes", () => {
  it("are 8 base62 chars and unique enough", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => shareCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(SHARE_CODE_PATTERN.test(c) && c.length === 8).toBe(true);
  });
});

describe("push copy", () => {
  it("writes human copy with deep links", () => {
    expect(pushCopy({ type: "follow", payload: null, actorHandle: "kai", gameName: null, gameSlug: null })).toEqual({
      title: "New follower",
      body: "@kai followed you.",
      url: "/u/kai",
    });
    const beaten = pushCopy({ type: "score_beaten", payload: { score: 520, theirBest: 412 }, actorHandle: "mara", gameName: "Stackd", gameSlug: "stackd" });
    expect(beaten?.body).toBe("@mara beat your 412 on Stackd with 520.");
    expect(beaten?.url).toBe("/g/stackd");
    expect(pushCopy({ type: "challenge_accepted", payload: { beat: false, score: 10, challengeScore: 20 }, actorHandle: "x", gameName: "Snek", gameSlug: "snek" })?.title).toBe("Challenge held");
    expect(pushCopy({ type: "mystery", payload: null, actorHandle: null, gameName: null, gameSlug: null })).toBeNull();
  });
});
