import { dailySeedFor } from "@thumbcade/protocol";
import { SDK_VERSION } from "../constants.ts";
import type { LaunchContext } from "../types.ts";

/** A complete LaunchContext with sensible defaults; pass what you know. */
export function createLaunchContext(partial: Partial<LaunchContext> & Pick<LaunchContext, "gameId">): LaunchContext {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const reduced =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
  return {
    sdkVersion: SDK_VERSION,
    versionId: "local",
    player: null,
    locale: nav?.language ?? "en-US",
    reducedMotion: reduced,
    audio: { muted: true },
    insets: { preview: zero, play: zero, current: "preview" },
    launchReason: "feed",
    seed: Math.floor(Math.random() * 2 ** 31),
    dailySeed: dailySeedFor(),
    best: null,
    host: "web",
    ...partial,
  };
}
