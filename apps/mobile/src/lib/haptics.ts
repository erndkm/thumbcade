import * as Haptics from "expo-haptics";
import { haptics as tokens } from "@thumbcade/design-tokens";
import type { FeedbackKind } from "@thumbcade/protocol";

type Token = (typeof tokens)[keyof typeof tokens];

function play(kind: Token): void {
  switch (kind) {
    case "soft":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      return;
    case "light":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case "medium":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case "rigid":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      return;
    case "selection":
      void Haptics.selectionAsync();
      return;
    case "success":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case "error":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
  }
}

/** Shell haptics, named by moment (design tokens decide the feel). */
export const haptic = {
  snap: () => play(tokens.snap),
  like: () => play(tokens.like),
  newBest: () => play(tokens.newBest),
  result: () => play(tokens.result),
  coach: () => play(tokens.coach),
};

let lastGameHaptic = 0;
/** Maps a game's semantic `feedback` to a haptic. Games never touch the native API. */
export function gameFeedback(kind: FeedbackKind, now = Date.now()): void {
  if (now - lastGameHaptic < 45) return;
  lastGameHaptic = now;
  const map: Record<FeedbackKind, Token> = {
    tap: tokens.gameTap,
    success: tokens.gameSuccess,
    fail: tokens.gameFail,
    impact: tokens.gameImpact,
  };
  play(map[kind]);
}
