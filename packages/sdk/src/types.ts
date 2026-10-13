/**
 * Public types of the Thumbcade SDK.
 *
 * They mirror the bridge contract in `@thumbcade/protocol` exactly (a type-level test keeps them in
 * lockstep) but are written out by hand so the published package has no dependencies, not even
 * type-only ones.
 */

/** JSON value accepted by `tc.storage`. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Safe-area insets in CSS pixels, relative to the game viewport. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface InsetSet {
  /** Areas covered by the feed overlay while the card shows attract mode (top tabs, action rail, caption). */
  preview: Insets;
  /** Areas covered while a run is being played (status bar only). */
  play: Insets;
  /** Which set currently applies. */
  current: "preview" | "play";
}

export type LaunchReason = "feed" | "gamePage" | "challenge" | "dev";

export type HostKind = "ios" | "android" | "web" | "simulator" | "standalone";

export interface Player {
  /** Opaque, stable per (player, game). Never the real user id. */
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Guests can play; their scores are not ranked. */
  guest: boolean;
}

export interface Challenge {
  fromName: string;
  score: number;
}

/** What `tc.init()` resolves with. */
export interface LaunchContext {
  sdkVersion: string;
  gameId: string;
  versionId: string;
  player: Player | null;
  locale: string;
  reducedMotion: boolean;
  audio: { muted: boolean };
  insets: InsetSet;
  challenge?: Challenge;
  launchReason: LaunchReason;
  /** Deterministic seed for this launch. */
  seed: number;
  /** Seed shared by every player today (UTC). Use it for daily challenges. */
  dailySeed: number;
  /** The player's best score in this game, if any. */
  best: number | null;
  /** Host environment, for diagnostics only. */
  host: HostKind;
}

export type LeaderboardScope = "daily" | "allTime" | "friends";

export interface LeaderboardEntry {
  rank: number;
  name: string;
  avatarUrl: string | null;
  score: number;
  isMe: boolean;
}

export interface LeaderboardMe {
  best: number | null;
  rank: number | null;
  /** 0-100, higher is better. */
  percentile: number | null;
}

export type FeedbackKind = "tap" | "success" | "fail" | "impact";

export type Outcome = "win" | "lose" | "quit";

export type PauseReason = "offscreen" | "background" | "sheet" | "back" | "idle" | "feedGesture" | "user";

/** What the SDK observed as the input that started a run. */
export type StartTrigger = "tap" | "swipe" | "key" | "none";

export type AnalyticsEventName =
  | "level_start"
  | "level_complete"
  | "level_fail"
  | "tutorial_complete"
  | "powerup_used"
  | "milestone";

export type AnalyticsProps = Record<string, string | number | boolean>;

export interface GameplayEndInput {
  score: number;
  outcome?: Outcome;
  /** Optional numeric stats shown to the creator in analytics (e.g. { level: 4, combo: 12 }). */
  stats?: Record<string, number>;
}

export type ErrorCode = "invalid" | "rate_limited" | "unauthorized" | "quota" | "unavailable" | "unknown";

export type ReplyPayload =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

/** Every bridge message is an envelope. */
export interface Envelope {
  ch: "tc";
  v: 1;
  id: string;
  type: string;
  payload?: unknown;
  replyTo?: string;
}

/** Events a game can subscribe to with `tc.on()`. */
export interface SdkEventMap {
  /** Stop the loop and all audio. `tc.loop` handles the loop for you. */
  pause: { reason: PauseReason };
  resume: undefined;
  mute: undefined;
  unmute: undefined;
  /** The feed claimed the current gesture. Synthetic pointercancel/touchcancel were already dispatched. */
  inputCancel: undefined;
  /** The player tapped "Play again" on the result card. Start a new run and call gameplay.start(). */
  replay: undefined;
  /** The applicable insets changed (preview <-> play, or the device rotated its chrome). */
  insets: InsetSet;
}

export type SdkEvent = keyof SdkEventMap;

/** Error thrown by request methods when the shell refuses or cannot answer. */
export interface ThumbcadeError extends Error {
  code: ErrorCode;
}

/** Game -> shell messages and their payloads (as validated by the host). */
export interface GameMessageMap {
  hello: { sdkVersion: string; manifestId?: string };
  ready: Record<string, never> | undefined;
  "gameplay.start": { trigger?: StartTrigger } | undefined;
  "gameplay.end": GameplayEndInput;
  "storage.get": { key: string };
  "storage.set": { key: string; value: Json };
  "leaderboard.top": { scope: LeaderboardScope; limit: number };
  "leaderboard.me": Record<string, never> | undefined;
  feedback: { kind: FeedbackKind };
  "share.challenge": { score: number };
  "analytics.track": { name: AnalyticsEventName; props?: AnalyticsProps };
  log: { level: "debug" | "info" | "warn" | "error"; args: string[] };
}
export type GameMessageType = keyof GameMessageMap;

/** Results carried by `reply` envelopes, keyed by request type. */
export interface ReplyResultMap {
  hello: LaunchContext;
  "storage.get": { value: Json | null };
  "storage.set": { ok: true };
  "leaderboard.top": { entries: LeaderboardEntry[] };
  "leaderboard.me": LeaderboardMe;
  "share.challenge": { shared: boolean };
}
export type RequestMessageType = Exclude<keyof ReplyResultMap, "hello">;

/** Shell -> game messages (besides `reply`) and their payloads. */
export interface ShellMessageMap {
  pause: { reason: PauseReason };
  resume: undefined;
  mute: undefined;
  unmute: undefined;
  "input.cancel": undefined;
  "input.inject": { kind: "tap"; x: number; y: number };
  insets: InsetSet;
  replay: undefined;
}
export type ShellMessageType = keyof ShellMessageMap;
