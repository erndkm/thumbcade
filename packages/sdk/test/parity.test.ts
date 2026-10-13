/**
 * The SDK re-declares a few contract values and types so it ships without dependencies. These tests
 * keep them identical to @thumbcade/protocol and @thumbcade/design-tokens.
 */
import {
  ANALYTICS_EVENT_WHITELIST,
  BUDGETS,
  CHANNEL as P_CHANNEL,
  dailySeedFor,
  PROTOCOL_VERSION as P_VERSION,
  StorageKeySchema,
  type Envelope as PEnvelope,
  type GameToShellPayload,
  type InsetSet as PInsetSet,
  type LaunchContext as PLaunchContext,
  type LeaderboardEntry as PLeaderboardEntry,
  type ReplyResult,
  type ShellToGamePayload,
} from "@thumbcade/protocol";
import { layout } from "@thumbcade/design-tokens";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ANALYTICS_EVENTS, CHANNEL, PROTOCOL_VERSION, STORAGE_KEY_PATTERN, STORAGE_VALUE_MAX_BYTES } from "../src/constants.ts";
import { FEED_LAYOUT } from "../src/host/insets.ts";
import type {
  Envelope,
  GameMessageMap,
  InsetSet,
  LaunchContext,
  LeaderboardEntry,
  LeaderboardMe,
  ShellMessageMap,
} from "../src/types.ts";
import { createThumbcade } from "../src/sdk.ts";
import { makeWindow } from "./helpers.ts";

describe("contract parity", () => {
  it("constants match the protocol", () => {
    expect(CHANNEL).toBe(P_CHANNEL);
    expect(PROTOCOL_VERSION).toBe(P_VERSION);
    expect([...ANALYTICS_EVENTS]).toEqual([...ANALYTICS_EVENT_WHITELIST]);
    expect(STORAGE_VALUE_MAX_BYTES).toBe(BUDGETS.storageValueBytes);
    for (const key of ["best", "a.b:c-d_e", "x".repeat(64), "", "x".repeat(65), "has space", "ümlaut"]) {
      expect(STORAGE_KEY_PATTERN.test(key)).toBe(StorageKeySchema.safeParse(key).success);
    }
  });

  it("feed layout matches the design tokens", () => {
    expect(FEED_LAYOUT).toEqual({
      topBarHeight: layout.topBarHeight,
      actionRailWidth: layout.actionRailWidth,
      captionHeight: layout.captionHeight,
      bottomBarHeight: layout.bottomBarHeight,
    });
  });

  it("the standalone daily seed matches dailySeedFor()", async () => {
    const tc = createThumbcade(makeWindow());
    const ctx = await tc.init();
    expect(ctx.dailySeed).toBe(dailySeedFor());
  });

  it("types are structurally identical to the protocol", () => {
    expectTypeOf<LaunchContext>().toEqualTypeOf<PLaunchContext>();
    expectTypeOf<InsetSet>().toEqualTypeOf<PInsetSet>();
    expectTypeOf<LeaderboardEntry>().toEqualTypeOf<PLeaderboardEntry>();
    expectTypeOf<LeaderboardMe>().toEqualTypeOf<ReplyResult<"leaderboard.me">>();
    expectTypeOf<Envelope>().toExtend<PEnvelope>();
    expectTypeOf<GameMessageMap["gameplay.end"]>().toEqualTypeOf<GameToShellPayload<"gameplay.end">>();
    expectTypeOf<GameMessageMap["analytics.track"]>().toEqualTypeOf<GameToShellPayload<"analytics.track">>();
    expectTypeOf<GameMessageMap["leaderboard.top"]>().toEqualTypeOf<GameToShellPayload<"leaderboard.top">>();
    expectTypeOf<GameMessageMap["hello"]>().toEqualTypeOf<GameToShellPayload<"hello">>();
    expectTypeOf<ShellMessageMap["pause"]>().toEqualTypeOf<ShellToGamePayload<"pause">>();
    expectTypeOf<ShellMessageMap["insets"]>().toEqualTypeOf<ShellToGamePayload<"insets">>();
    expectTypeOf<ShellMessageMap["input.inject"]>().toEqualTypeOf<ShellToGamePayload<"input.inject">>();
  });
});
