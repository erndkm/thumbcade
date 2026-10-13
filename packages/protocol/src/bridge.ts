import { z } from "zod";
import { ANALYTICS_EVENT_WHITELIST, PROTOCOL_VERSION } from "./constants.ts";
import { InsetSetSchema, LaunchContextSchema } from "./launch.ts";

/**
 * The shell <-> game bridge.
 *
 * Every message is an Envelope. Requests from the game carry an `id`; the shell answers with a
 * `reply` envelope whose `replyTo` is that id. The reply to `hello` carries the LaunchContext
 * (this is what the SDK exposes as the result of `tc.init()`).
 *
 * Transports (the SDK auto-detects):
 * - React Native WebView: game -> shell via `window.ReactNativeWebView.postMessage(JSON.stringify(env))`;
 *   shell -> game via `injectJavaScript` dispatching `new MessageEvent("message", { data: env })` on window.
 * - iframe (simulator, web player): `window.parent.postMessage(env, "*")` out; in, the SDK only accepts
 *   messages whose `event.source === window.parent`. The host checks `event.origin` against the game origin.
 * - standalone (bare browser tab): an in-page mock host, so a game can be opened directly.
 *
 * The `ch` marker lets both sides ignore unrelated postMessage traffic.
 */

export const CHANNEL = "tc" as const;

export const EnvelopeSchema = z.object({
  ch: z.literal(CHANNEL),
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(48),
  payload: z.unknown().optional(),
  replyTo: z.string().max(64).optional(),
});
export type Envelope<T extends string = string, P = unknown> = {
  ch: typeof CHANNEL;
  v: typeof PROTOCOL_VERSION;
  id: string;
  type: T;
  payload?: P;
  replyTo?: string;
};

// ---------------------------------------------------------------------------
// Shared payload pieces
// ---------------------------------------------------------------------------

/** JSON value accepted by `tc.storage`. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonSchema), z.record(z.string(), JsonSchema)]),
);

export const StorageKeySchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);

export const LeaderboardScopeSchema = z.enum(["daily", "allTime", "friends"]);
export type LeaderboardScope = z.infer<typeof LeaderboardScopeSchema>;

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  score: z.number(),
  isMe: z.boolean(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const FeedbackKindSchema = z.enum(["tap", "success", "fail", "impact"]);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;

export const OutcomeSchema = z.enum(["win", "lose", "quit"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const PauseReasonSchema = z.enum(["offscreen", "background", "sheet", "back", "idle", "feedGesture", "user"]);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

// ---------------------------------------------------------------------------
// Game -> shell
// ---------------------------------------------------------------------------

export const GameToShellPayloads = {
  hello: z.object({ sdkVersion: z.string(), manifestId: z.string().optional() }),
  ready: z.object({}).optional(),
  "gameplay.start": z
    .object({
      /**
       * What the SDK observed as the input that started the run. The SDK derives it from the last
       * pointer sequence (small movement = tap). "swipe" is a Swipe Contract violation (§5.5 rule 1).
       */
      trigger: z.enum(["tap", "swipe", "key", "none"]).optional(),
    })
    .optional(),
  "gameplay.end": z.object({
    score: z.number().finite(),
    outcome: OutcomeSchema.optional(),
    stats: z.record(z.string(), z.number().finite()).optional(),
  }),
  "storage.get": z.object({ key: StorageKeySchema }),
  "storage.set": z.object({ key: StorageKeySchema, value: JsonSchema }),
  "leaderboard.top": z.object({
    scope: LeaderboardScopeSchema,
    limit: z.number().int().min(1).max(50).default(10),
  }),
  "leaderboard.me": z.object({}).optional(),
  feedback: z.object({ kind: FeedbackKindSchema }),
  "share.challenge": z.object({ score: z.number().finite() }),
  "analytics.track": z.object({
    name: z.enum(ANALYTICS_EVENT_WHITELIST),
    props: z.record(z.string(), z.union([z.string().max(64), z.number(), z.boolean()])).optional(),
  }),
  log: z.object({ level: z.enum(["debug", "info", "warn", "error"]), args: z.array(z.string().max(2000)).max(20) }),
} as const;

export type GameToShellType = keyof typeof GameToShellPayloads;
export type GameToShellPayload<T extends GameToShellType> = z.infer<(typeof GameToShellPayloads)[T]>;
export const GAME_TO_SHELL_TYPES = Object.keys(GameToShellPayloads) as GameToShellType[];

/** Messages that expect a `reply`. */
export const REQUEST_TYPES = new Set<GameToShellType>([
  "hello",
  "storage.get",
  "storage.set",
  "leaderboard.top",
  "leaderboard.me",
  "share.challenge",
]);

/** Result payloads carried by `reply` envelopes, keyed by the request type. */
export const ReplyResults = {
  hello: LaunchContextSchema,
  "storage.get": z.object({ value: JsonSchema.nullable() }),
  "storage.set": z.object({ ok: z.literal(true) }),
  "leaderboard.top": z.object({ entries: z.array(LeaderboardEntrySchema) }),
  "leaderboard.me": z.object({
    best: z.number().nullable(),
    rank: z.number().int().nullable(),
    percentile: z.number().min(0).max(100).nullable(),
  }),
  "share.challenge": z.object({ shared: z.boolean() }),
} as const;
export type ReplyResult<T extends keyof typeof ReplyResults> = z.infer<(typeof ReplyResults)[T]>;

export const ReplyPayloadSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(["invalid", "rate_limited", "unauthorized", "quota", "unavailable", "unknown"]),
      message: z.string(),
    }),
  }),
]);
export type ReplyPayload = z.infer<typeof ReplyPayloadSchema>;

// ---------------------------------------------------------------------------
// Shell -> game
// ---------------------------------------------------------------------------

export const ShellToGamePayloads = {
  reply: ReplyPayloadSchema,
  pause: z.object({ reason: PauseReasonSchema }),
  resume: z.object({}).optional(),
  mute: z.object({}).optional(),
  unmute: z.object({}).optional(),
  /** The feed claimed the current gesture: cancel any in-progress pointer interaction. */
  "input.cancel": z.object({}).optional(),
  /** Fallback tap injection used only if native gesture arbitration is unavailable on a platform. */
  "input.inject": z.object({ kind: z.literal("tap"), x: z.number(), y: z.number() }),
  insets: InsetSetSchema,
  /** The player tapped "Play again" on the result card. Start a new run and call gameplay.start(). */
  replay: z.object({}).optional(),
} as const;

export type ShellToGameType = keyof typeof ShellToGamePayloads;
export type ShellToGamePayload<T extends ShellToGameType> = z.infer<(typeof ShellToGamePayloads)[T]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
export function makeId(prefix = "m"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function envelope<T extends string, P>(type: T, payload?: P, replyTo?: string): Envelope<T, P> {
  const env: Envelope<T, P> = { ch: CHANNEL, v: PROTOCOL_VERSION, id: makeId(), type };
  if (payload !== undefined) env.payload = payload;
  if (replyTo !== undefined) env.replyTo = replyTo;
  return env;
}

export type ParsedGameMessage =
  | { ok: true; envelope: Envelope<GameToShellType>; payload: unknown }
  | { ok: false; reason: string };

/**
 * Shell-side validation of an inbound message from a game. Accepts a JSON string or an object.
 * Unknown types and malformed payloads are rejected; callers drop them.
 */
export function parseGameMessage(raw: unknown): ParsedGameMessage {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 64 * 1024) return { ok: false, reason: "too_large" };
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "not_json" };
    }
  }
  const env = EnvelopeSchema.safeParse(data);
  if (!env.success) return { ok: false, reason: "bad_envelope" };
  const type = env.data.type as GameToShellType;
  const schema = GameToShellPayloads[type];
  if (!schema) return { ok: false, reason: `unknown_type:${env.data.type}` };
  const payload = schema.safeParse(env.data.payload);
  if (!payload.success) return { ok: false, reason: `bad_payload:${type}` };
  return { ok: true, envelope: env.data as Envelope<GameToShellType>, payload: payload.data };
}

/** Simple per-type sliding-window limiter (1s window). */
export function createRateLimiter(limits: Readonly<Record<string, number>>) {
  const hits = new Map<string, number[]>();
  return (type: string, now = Date.now()): boolean => {
    const limit = limits[type] ?? limits.default ?? 60;
    const list = (hits.get(type) ?? []).filter((t) => now - t < 1000);
    if (list.length >= limit) {
      hits.set(type, list);
      return false;
    }
    list.push(now);
    hits.set(type, list);
    return true;
  };
}
