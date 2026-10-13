import { thumbcade as tc, type FeedbackKind, type Insets, type LaunchContext, type Outcome } from "@thumbcade/sdk";
import { onTap } from "./input.ts";

/**
 * The run lifecycle every launch game shares:
 *
 *   attract --tap--> playing --end()--> over --tap / "Play again"--> playing ...
 *
 * It calls the SDK at the right moments (start on a tap, end within the same frame as game over),
 * keeps the best score in `tc.storage`, and tells you which insets apply right now.
 */

export type Phase = "attract" | "playing" | "over";

export interface SessionEvents {
  /** A run begins: reset your world here. */
  start: void;
  /** A run ended. */
  end: { score: number; best: number | null; isBest: boolean };
  attract: void;
  pause: void;
  resume: void;
  /** The feed claimed the gesture in progress. Drop any half-finished input. */
  cancel: void;
  /** Insets changed; re-layout. */
  insets: void;
}

export interface SessionOptions {
  /** Manifest id. */
  id: string;
  /** "desc" = higher is better (default), "asc" = lower is better. */
  order?: "asc" | "desc";
  /** Taps in "over" are ignored for this long so a frantic last tap doesn't restart instantly. */
  restartDelayMs?: number;
  bestKey?: string;
}

export interface Session {
  readonly ctx: LaunchContext;
  readonly phase: Phase;
  readonly best: number | null;
  readonly runs: number;
  readonly paused: boolean;
  readonly reducedMotion: boolean;
  /**
   * True when no Thumbcade shell is around (a plain browser tab). In the feed the shell draws a result
   * card over the game after `end()`, so only draw your own "tap to retry" CTA when this is true.
   */
  readonly standalone: boolean;
  /** Seconds since the phase last changed (advance with `tick`). */
  readonly phaseTime: number;
  /** Insets for the current phase: preview outside a run, play during a run. */
  safe(): Insets;
  preview(): Insets;
  play(): Insets;
  /** Starts a run if allowed (attract, or over after the restart delay). Call from a tap. */
  start(): boolean;
  /** Ends the run now: reports to the shell immediately and persists the best score. */
  end(score: number, opts?: { outcome?: Outcome; stats?: Record<string, number> }): { best: number | null; isBest: boolean };
  /** Back to attract mode without a run. */
  attract(): void;
  /** First frame is on screen. */
  ready(): void;
  feedback(kind: FeedbackKind): void;
  tick(dt: number): void;
  on<K extends keyof SessionEvents>(event: K, cb: (payload: SessionEvents[K]) => void): () => void;
  /** Taps on `target` start a run in attract/over. Returns an unsubscribe function. */
  startOnTap(target?: EventTarget): () => void;
}

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export async function createSession(opts: SessionOptions): Promise<Session> {
  const ctx = await tc.init({ manifestId: opts.id });
  const order = opts.order ?? "desc";
  const bestKey = opts.bestKey ?? "best";
  const restartDelay = (opts.restartDelayMs ?? 700) / 1000;
  const better = (a: number, b: number | null) => b === null || (order === "asc" ? a < b : a > b);

  let best: number | null = ctx.best;
  try {
    const stored = await tc.storage.get(bestKey);
    if (typeof stored === "number" && better(stored, best)) best = stored;
  } catch {
    /* storage unavailable (guest, offline): the shell's best is enough */
  }

  let phase: Phase = "attract";
  let phaseTime = 0;
  let runs = 0;
  let paused = tc.paused;
  const listeners = new Map<keyof SessionEvents, Set<(p: never) => void>>();
  const emit = <K extends keyof SessionEvents>(k: K, p: SessionEvents[K]) =>
    listeners.get(k)?.forEach((cb) => (cb as (p: SessionEvents[K]) => void)(p));
  const setPhase = (p: Phase) => {
    phase = p;
    phaseTime = 0;
  };

  const session: Session = {
    ctx,
    get phase() {
      return phase;
    },
    get best() {
      return best;
    },
    get runs() {
      return runs;
    },
    get paused() {
      return paused;
    },
    get reducedMotion() {
      return ctx.reducedMotion;
    },
    get standalone() {
      return tc.host === "standalone";
    },
    get phaseTime() {
      return phaseTime;
    },
    safe() {
      return phase === "playing" ? session.play() : session.preview();
    },
    preview() {
      return tc.context?.insets.preview ?? ZERO;
    },
    play() {
      return tc.context?.insets.play ?? ZERO;
    },
    start() {
      if (paused) return false;
      if (phase === "playing") return false;
      if (phase === "over" && phaseTime < restartDelay) return false;
      setPhase("playing");
      runs++;
      tc.gameplay.start();
      emit("start", undefined);
      return true;
    },
    end(score, o = {}) {
      if (phase !== "playing") return { best, isBest: false };
      setPhase("over");
      const isBest = better(score, best);
      if (isBest) {
        best = score;
        tc.storage.set(bestKey, score).catch(() => undefined);
      }
      tc.gameplay.end({ score, outcome: o.outcome ?? "lose", ...(o.stats ? { stats: o.stats } : {}) });
      tc.feedback(isBest ? "success" : "fail");
      emit("end", { score, best, isBest });
      return { best, isBest };
    },
    attract() {
      setPhase("attract");
      emit("attract", undefined);
    },
    ready() {
      tc.ready();
    },
    feedback(kind) {
      // Haptics belong to the player's own run: an attract-mode demo must never buzz someone scrolling past.
      if (phase === "playing" && !paused) tc.feedback(kind);
    },
    tick(dt) {
      phaseTime += dt;
    },
    on(event, cb) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb as (p: never) => void);
      return () => set.delete(cb as (p: never) => void);
    },
    startOnTap(target = window) {
      return onTap(target, () => {
        if (phase !== "playing") session.start();
      });
    },
  };

  tc.on("pause", () => {
    paused = true;
    emit("pause", undefined);
  });
  tc.on("resume", () => {
    paused = false;
    emit("resume", undefined);
  });
  tc.on("replay", () => {
    if (phase === "over") {
      phaseTime = restartDelay;
      session.start();
    }
  });
  tc.on("inputCancel", () => emit("cancel", undefined));
  tc.on("insets", () => emit("insets", undefined));
  return session;
}
