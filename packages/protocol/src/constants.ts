/**
 * Platform-wide constants. Every budget the reviewer enforces and the simulator displays
 * lives here so the two can never drift apart.
 */

/** Current bridge protocol version (the `v` field of every envelope). */
export const PROTOCOL_VERSION = 1 as const;

/** SDK major versions the shell accepts (current and previous). */
export const SUPPORTED_SDK_MAJORS = [1] as const;
export const CURRENT_SDK_MAJOR = 1 as const;

export const BUDGETS = {
  /** Gzipped bytes of everything requested before `ready()`. */
  initialPayloadGzipBytes: 3 * 1024 * 1024,
  /** Hard cap on the uncompressed size of the whole bundle. */
  totalBundleBytes: 15 * 1024 * 1024,
  /** Cold load to `ready()` on the mid-tier profile (4x CPU throttle, Fast 4G). */
  readyMs: 2500,
  /** Shell gives up waiting for `ready()` after this long and shows a retry state. */
  loadTimeoutMs: 8000,
  /** Max single main-thread task after `ready()`. */
  longTaskMs: 100,
  /** Minimum sustained frame rate in attract mode. */
  minFps: 55,
  /** JS heap ceiling. */
  heapBytes: 150 * 1024 * 1024,
  /** `gameplay.end()` must follow game over within this window. */
  gameplayEndMs: 1000,
  /** `tc.storage` quota per player per game. */
  storageBytesPerGame: 64 * 1024,
  /** Max size of a single storage value. */
  storageValueBytes: 16 * 1024,
} as const;

/** Rate limits the shell applies per message type (messages per rolling second). */
export const BRIDGE_RATE_LIMITS: Readonly<Record<string, number>> = {
  "storage.set": 10,
  "storage.get": 30,
  "leaderboard.top": 4,
  "leaderboard.me": 4,
  "analytics.track": 10,
  feedback: 30,
  log: 50,
  default: 60,
};

/** Custom analytics event names a game may send through `tc.analytics.track`. */
export const ANALYTICS_EVENT_WHITELIST = [
  "level_start",
  "level_complete",
  "level_fail",
  "tutorial_complete",
  "powerup_used",
  "milestone",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_WHITELIST)[number];

/** Idle time in PLAYING before the shell auto-pauses the card. */
export const PLAYING_IDLE_PAUSE_MS = 20_000;

/**
 * A run counts as a play once the game ends it (`gameplay.end`) or once it reaches this much active playtime,
 * whichever comes first. Mirrored in SQL (`feed_config` key `analytics`); a test keeps the two equal.
 */
export const QUALIFIED_PLAY_MS = 3000;

/** The shell reports a run's active playtime to `session-progress` at most this often. */
export const SESSION_PROGRESS_INTERVAL_MS = 5000;

/** Creator-dashboard rates are shown only when their denominator reaches this. */
export const ANALYTICS_MIN_SAMPLE = 20;

/** Categories surfaced in Discover. Hashtags are free-form; these are curated buckets. */
export const CATEGORIES = [
  { id: "arcade", label: "Arcade", tags: ["arcade", "onetap", "flyer", "runner"] },
  { id: "puzzle", label: "Puzzle", tags: ["puzzle", "merge", "logic", "chess"] },
  { id: "brain", label: "Brain", tags: ["brain", "matching", "chess", "logic"] },
  { id: "3d", label: "3D", tags: ["3d"] },
  { id: "chill", label: "Chill", tags: ["chill", "zen", "relax"] },
  { id: "reflex", label: "Reflex", tags: ["reflex", "reaction", "speed"] },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];
