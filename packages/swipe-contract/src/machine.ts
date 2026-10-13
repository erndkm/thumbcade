/**
 * The Swipe Contract — card session state machine.
 *
 * Pure and dependency-free. The mobile app and the feed simulator both drive their cards with
 * `transition()` and read gesture ownership from `gestureConfig()`, so there is exactly one
 * implementation of the rules in the whole platform.
 *
 * Phases (§5.1):
 *   LOADING   WebView booting; poster + shimmer
 *   PREVIEW   game called ready(); attract mode; full overlay
 *   PLAYING   game called gameplay.start(); overlay recedes; tab bar becomes the Dock
 *   ENDED     game called gameplay.end(); result card
 *   PAUSED    a run was interrupted (background, sheet, back, idle); resume pill
 *   OFFSCREEN not the active card
 *   FAILED    the game did not become ready in time or crashed; retry affordance
 */

export type CardPhase = "LOADING" | "PREVIEW" | "PLAYING" | "ENDED" | "PAUSED" | "OFFSCREEN" | "FAILED";

/** Phases a card returns to when it becomes active again. */
export type ResumablePhase = "LOADING" | "PREVIEW" | "PAUSED" | "ENDED" | "FAILED";

/** The subset of the manifest's `controls` the contract needs (structurally compatible with it). */
export interface ContractControls {
  vertical: boolean;
  multitouch?: boolean;
}

/** Environmental reasons a card is suspended without the user leaving it. */
export type SuspendReason = "background" | "sheet";

/** Explicit reasons a run is paused. */
export type PauseReason = "back" | "idle" | "user";

export type PauseMessageReason = "offscreen" | "background" | "sheet" | "back" | "idle" | "feedGesture" | "user";

export type ViolationCode =
  | "start_by_swipe"
  | "start_without_ready"
  | "start_while_paused"
  | "end_without_start";

export interface CardState {
  phase: CardPhase;
  /** Where an OFFSCREEN card goes when it is activated again. */
  resumeTo: ResumablePhase;
  /** The game has called ready() at least once since the last (re)load. */
  ready: boolean;
  /** This is the current card in the feed. */
  active: boolean;
  /** Active environmental suspensions. */
  suspended: SuspendReason[];
  /** The feed currently owns a gesture on this card (the card is being dragged). */
  feedGesture: boolean;
  /** What we last told the game: is it running (true) or paused (false)? Null before ready. */
  gameRunning: boolean | null;
  /** The player asked for "Play again" and we are waiting for gameplay.start(). */
  replayRequested: boolean;
  lastScore: number | null;
  runs: number;
}

export type ContractEvent =
  | { type: "ACTIVATE" }
  | { type: "DEACTIVATE" }
  | { type: "READY" }
  | { type: "LOAD_FAILED" }
  | { type: "RETRY" }
  | { type: "GAMEPLAY_START"; trigger?: "tap" | "swipe" | "key" | "none" }
  | { type: "GAMEPLAY_END"; score: number }
  | { type: "SUSPEND"; reason: SuspendReason }
  | { type: "UNSUSPEND"; reason: SuspendReason }
  | { type: "PAUSE"; reason: PauseReason }
  | { type: "RESUME_PLAY" }
  | { type: "REPLAY" }
  | { type: "FEED_GESTURE_BEGIN" }
  | { type: "FEED_GESTURE_END"; committed: boolean };

export type Effect =
  | { type: "send"; message: "pause"; reason: PauseMessageReason }
  | { type: "send"; message: "resume" }
  | { type: "send"; message: "input.cancel" }
  | { type: "send"; message: "replay" }
  | { type: "reload" }
  | { type: "track"; event: "play_start" | "play_end" | "load_failed" | "replay"; score?: number }
  | { type: "violation"; code: ViolationCode; detail: string };

export interface TransitionResult {
  state: CardState;
  effects: Effect[];
}

export function createCardState(): CardState {
  return {
    phase: "OFFSCREEN",
    resumeTo: "LOADING",
    ready: false,
    active: false,
    suspended: [],
    feedGesture: false,
    gameRunning: null,
    replayRequested: false,
    lastScore: null,
    runs: 0,
  };
}

/** Phases in which the game is visible and should be animating. */
const RUNNING_PHASES: ReadonlySet<CardPhase> = new Set(["PREVIEW", "PLAYING", "ENDED"]);

/** Should the game be running (not paused) in this state? */
export function shouldRun(s: CardState): boolean {
  return s.ready && s.active && s.suspended.length === 0 && !s.feedGesture && RUNNING_PHASES.has(s.phase);
}

function pauseReasonFor(s: CardState, explicit?: PauseReason): PauseMessageReason {
  if (!s.active) return "offscreen";
  if (s.feedGesture) return "feedGesture";
  if (s.suspended.length > 0) return s.suspended[s.suspended.length - 1] as SuspendReason;
  return explicit ?? "user";
}

/** Maps the phase a card is leaving to the phase it should return to. */
function resumableFrom(phase: CardPhase, ready: boolean): ResumablePhase {
  switch (phase) {
    case "PLAYING":
    case "PAUSED":
      return "PAUSED";
    case "ENDED":
      return "ENDED";
    case "FAILED":
      return "FAILED";
    case "PREVIEW":
      return "PREVIEW";
    case "LOADING":
      return ready ? "PREVIEW" : "LOADING";
    case "OFFSCREEN":
      return ready ? "PREVIEW" : "LOADING";
  }
}

/**
 * Applies an event. Never throws; events that make no sense in the current phase are ignored
 * (or reported as a violation when they indicate a game bug).
 */
export function transition(prev: CardState, event: ContractEvent): TransitionResult {
  const s: CardState = { ...prev, suspended: [...prev.suspended] };
  const effects: Effect[] = [];
  let explicitPause: PauseReason | undefined;

  switch (event.type) {
    case "ACTIVATE": {
      if (s.active) break;
      s.active = true;
      s.phase = s.phase === "OFFSCREEN" ? s.resumeTo : s.phase;
      break;
    }
    case "DEACTIVATE": {
      if (!s.active) break;
      s.resumeTo = resumableFrom(s.phase, s.ready);
      s.active = false;
      s.feedGesture = false;
      s.replayRequested = false;
      s.phase = "OFFSCREEN";
      break;
    }
    case "READY": {
      if (s.ready) break;
      s.ready = true;
      // A freshly loaded game runs until told otherwise.
      s.gameRunning = true;
      if (s.phase === "LOADING") s.phase = "PREVIEW";
      if (s.phase === "OFFSCREEN" && s.resumeTo === "LOADING") s.resumeTo = "PREVIEW";
      break;
    }
    case "LOAD_FAILED": {
      if (s.ready) break;
      if (s.phase === "LOADING") {
        s.phase = "FAILED";
        effects.push({ type: "track", event: "load_failed" });
      } else if (s.phase === "OFFSCREEN" && s.resumeTo === "LOADING") {
        s.resumeTo = "FAILED";
      }
      break;
    }
    case "RETRY": {
      const failed = s.phase === "FAILED" || (s.phase === "OFFSCREEN" && s.resumeTo === "FAILED");
      if (!failed) break;
      s.ready = false;
      s.gameRunning = null;
      s.runs = 0;
      s.lastScore = null;
      if (s.phase === "FAILED") s.phase = "LOADING";
      else s.resumeTo = "LOADING";
      effects.push({ type: "reload" });
      break;
    }
    case "GAMEPLAY_START": {
      if (event.trigger === "swipe") {
        effects.push({
          type: "violation",
          code: "start_by_swipe",
          detail: "A run was started by a swipe. Runs must start with a tap (Swipe Contract rule 1).",
        });
      }
      if (!s.ready) {
        effects.push({
          type: "violation",
          code: "start_without_ready",
          detail: "gameplay.start() was called before ready().",
        });
        break;
      }
      if (s.phase === "PREVIEW" || s.phase === "ENDED") {
        if (!s.active || s.suspended.length > 0) {
          effects.push({
            type: "violation",
            code: "start_while_paused",
            detail: "gameplay.start() arrived while the card was paused. Stop input handling on pause.",
          });
          break;
        }
        s.phase = "PLAYING";
        s.replayRequested = false;
        s.runs += 1;
        effects.push({ type: "track", event: "play_start" });
      } else if (s.phase === "PAUSED" || s.phase === "OFFSCREEN") {
        effects.push({
          type: "violation",
          code: "start_while_paused",
          detail: "gameplay.start() arrived while the card was paused. Stop input handling on pause.",
        });
      }
      break;
    }
    case "GAMEPLAY_END": {
      const inRun = s.phase === "PLAYING" || s.phase === "PAUSED" || (s.phase === "OFFSCREEN" && s.resumeTo === "PAUSED");
      if (!inRun) {
        if (s.phase === "PREVIEW") {
          effects.push({
            type: "violation",
            code: "end_without_start",
            detail: "gameplay.end() was called without gameplay.start(). Call start on the tap that begins a run.",
          });
        }
        break;
      }
      s.lastScore = event.score;
      if (s.phase === "OFFSCREEN") s.resumeTo = "ENDED";
      else s.phase = "ENDED";
      effects.push({ type: "track", event: "play_end", score: event.score });
      break;
    }
    case "SUSPEND": {
      if (!s.suspended.includes(event.reason)) s.suspended.push(event.reason);
      if (s.phase === "PLAYING") s.phase = "PAUSED";
      break;
    }
    case "UNSUSPEND": {
      s.suspended = s.suspended.filter((r) => r !== event.reason);
      break;
    }
    case "PAUSE": {
      if (s.phase !== "PLAYING") break;
      s.phase = "PAUSED";
      explicitPause = event.reason;
      break;
    }
    case "RESUME_PLAY": {
      if (s.phase !== "PAUSED" || s.suspended.length > 0 || !s.active) break;
      s.phase = "PLAYING";
      break;
    }
    case "REPLAY": {
      if (s.phase !== "ENDED" || !s.active) break;
      s.replayRequested = true;
      effects.push({ type: "send", message: "replay" }, { type: "track", event: "replay" });
      break;
    }
    case "FEED_GESTURE_BEGIN": {
      if (!s.active || s.feedGesture) break;
      s.feedGesture = true;
      if (s.ready) effects.push({ type: "send", message: "input.cancel" });
      break;
    }
    case "FEED_GESTURE_END": {
      if (!s.feedGesture) break;
      // On commit the feed MUST deactivate this card next. We keep the gesture flag so the game is not
      // resumed for a single frame before DEACTIVATE pauses it again.
      if (!event.committed) s.feedGesture = false;
      break;
    }
  }

  // Reconcile what the game was told with what it should be doing.
  if (s.ready && s.gameRunning !== null) {
    const run = shouldRun(s);
    if (run !== s.gameRunning) {
      effects.push(run ? { type: "send", message: "resume" } : { type: "send", message: "pause", reason: pauseReasonFor(s, explicitPause) });
      s.gameRunning = run;
    }
  }

  return { state: s, effects };
}

/** Folds a list of events. Handy for tests and for the simulator's timeline scrubber. */
export function run(events: ContractEvent[], from: CardState = createCardState()): TransitionResult {
  let state = from;
  const effects: Effect[] = [];
  for (const e of events) {
    const r = transition(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
