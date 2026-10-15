/**
 * CardController — one per live feed card.
 *
 * Owns the card's Swipe Contract state (`transition()` from @thumbcade/swipe-contract), executes the
 * returned effects (pause/resume/input.cancel/replay messages, reloads, analytics), and terminates the
 * shell side of the bridge (zod-validated, rate-limited). Platform services are injected so the whole
 * thing runs under unit tests without React Native.
 */
import {
  BRIDGE_RATE_LIMITS,
  BUDGETS,
  PLAYING_IDLE_PAUSE_MS,
  QUALIFIED_PLAY_MS,
  SESSION_PROGRESS_INTERVAL_MS,
  REQUEST_TYPES,
  SUPPORTED_SDK_MAJORS,
  createRateLimiter,
  dailySeedFor,
  envelope,
  parseGameMessage,
  type ClientEvent,
  type FeedCard,
  type FeedbackKind,
  type GameToShellPayload,
  type GameToShellType,
  type InsetSet,
  type Insets,
  type Json,
  type LaunchContext,
  type LaunchReason,
  type LeaderboardEntry,
  type LeaderboardScope,
  type Player,
  type ReplyPayload,
  type SessionEndResponse,
  type SessionProgressResponse,
  type SessionStartResponse,
  type ShellToGameType,
} from "@thumbcade/protocol";
import {
  createCardState,
  gestureConfigFor,
  shouldRun,
  transition,
  type CardPhase,
  type CardState,
  type ContractEvent,
  type Effect,
} from "@thumbcade/swipe-contract";

export interface ChallengeInfo {
  code: string;
  fromName: string;
  score: number | null;
}

export interface CardResult {
  score: number;
  outcome: "win" | "lose" | "quit" | undefined;
  /** Waiting for session-end. */
  pending: boolean;
  best: number | null;
  isNewBest: boolean;
  percentile: number | null;
  dailyRank: number | null;
  accepted: boolean | null;
  reason?: string;
}

export interface BridgeLogLine {
  t: number;
  dir: "in" | "out" | "drop" | "violation";
  text: string;
}

export interface CardSnapshot {
  phase: CardPhase;
  ready: boolean;
  /** Bumps on reload: the view remounts its WebView. */
  loadKey: number;
  result: CardResult | null;
  runs: number;
  insets: "preview" | "play";
  log: BridgeLogLine[];
}

export interface CardDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  launch: () => Promise<{
    player: Player | null;
    locale: string;
    reducedMotion: boolean;
    muted: boolean;
    insets: { preview: Insets; play: Insets };
    host: LaunchContext["host"];
  }>;
  /** Current inset sets (synchronous; layout is known before any card mounts). */
  insets: () => { preview: Insets; play: Insets };
  sessionStart: (req: { gameId: string; versionId: string; launchReason: LaunchReason; cardId?: string }) => Promise<SessionStartResponse>;
  sessionEnd: (req: {
    sessionId: string;
    token: string;
    score: number;
    durationMs: number;
    activeMs?: number;
    outcome?: "win" | "lose" | "quit";
  }) => Promise<SessionEndResponse>;
  /** Reports an open run's active playtime: when it qualifies as a play, and when it is interrupted. */
  sessionProgress: (req: { sessionId: string; token: string; activeMs: number }) => Promise<SessionProgressResponse>;
  storageGet: (gameId: string, key: string) => Promise<Json | null>;
  storageSet: (gameId: string, key: string, value: Json) => Promise<void>;
  leaderboardTop: (gameId: string, scope: LeaderboardScope, limit: number) => Promise<LeaderboardEntry[]>;
  leaderboardMe: (gameId: string) => Promise<{ best: number | null; rank: number | null; percentile: number | null }>;
  feedback: (kind: FeedbackKind) => void;
  shareChallenge: (card: FeedCard, score: number) => Promise<boolean>;
  track: (event: Omit<ClientEvent, "ts">) => void;
  onViolation?: (code: string, detail: string) => void;
  dev?: boolean;
}

const LOG_MAX = 120;
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), "g");
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), "g");

export function injectionFor(env: unknown): string {
  // U+2028/2029 are valid JSON but terminate JS string literals in older engines.
  const json = JSON.stringify(env).replace(LINE_SEP, "\\u2028").replace(PARA_SEP, "\\u2029");
  return `window.dispatchEvent(new MessageEvent("message",{data:${json}}));true;`;
}

/**
 * Active playtime of the open run: the time it spends in PLAYING while the game is running (not paused,
 * not under a feed drag, not offscreen). This is what the creator dashboard calls playtime.
 */
interface RunClock {
  session: Promise<SessionStartResponse | null>;
  /** Time folded in from finished stretches. */
  activeMs: number;
  /** Start of the current running stretch, or null while stopped. */
  runningSince: number | null;
  qualified: boolean;
  qualifyTimer: unknown;
  /** Last value sent to session-progress, and when. */
  reportedMs: number;
  reportedAt: number;
  trailingTimer: unknown;
  /** The game ended the run; session-end carries the final time. */
  ended: boolean;
}

let instances = 0;

export class CardController {
  /** Unique per controller: a new controller for the same card gets a fresh WebView (see GameFrame). */
  readonly instance = `${++instances}.${Math.random().toString(36).slice(2, 8)}`;
  readonly card: FeedCard;
  readonly launchReason: LaunchReason;
  readonly challenge: ChallengeInfo | null;
  private state: CardState = createCardState();
  private snapshot: CardSnapshot;
  private listeners = new Set<() => void>();
  private inject: ((js: string) => void) | null = null;
  private allow = createRateLimiter(BRIDGE_RATE_LIMITS);
  private loadTimer: unknown = null;
  private idleTimer: unknown = null;
  private loadStartedAt = 0;
  private activatedAt = 0;
  private impressed = false;
  private helloDone = false;
  private sentInsets: "preview" | "play" | null = null;
  private runStartedAt = 0;
  private session: Promise<SessionStartResponse | null> | null = null;
  private clock: RunClock | null = null;
  private best: number | null;
  private disposed = false;
  private seed: number;

  constructor(
    card: FeedCard,
    private deps: CardDeps,
    opts: { launchReason?: LaunchReason; challenge?: ChallengeInfo | null } = {},
  ) {
    this.card = card;
    this.launchReason = opts.launchReason ?? "feed";
    this.challenge = opts.challenge ?? null;
    this.best = card.viewer.best;
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.snapshot = { phase: this.state.phase, ready: false, loadKey: 0, result: null, runs: 0, insets: "preview", log: [] };
  }

  // ---------------------------------------------------------------------------------------------
  // React glue
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): CardSnapshot => this.snapshot;
  get machine(): CardState {
    return this.state;
  }
  private emit(patch: Partial<CardSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------------------------------------
  // WebView lifecycle

  /** The WebView for this card mounted (or remounted after a reload). */
  attach(inject: (js: string) => void): void {
    this.inject = inject;
  }
  detach(): void {
    this.inject = null;
  }

  /** Navigation into the game started: arm the ready() timeout. */
  loadStarted(): void {
    if (this.state.ready) return;
    this.loadStartedAt = this.deps.now();
    this.armLoadTimer(BUDGETS.loadTimeoutMs);
  }

  private hostVisible = true;
  private loadBudgetLeft: number = BUDGETS.loadTimeoutMs;
  private armedAt = 0;

  private armLoadTimer(ms: number): void {
    this.deps.clearTimer(this.loadTimer);
    this.loadTimer = null;
    this.loadBudgetLeft = ms;
    if (!this.hostVisible || this.state.ready) return;
    this.armedAt = this.deps.now();
    this.loadTimer = this.deps.setTimer(() => this.failLoad("timeout"), ms);
  }

  /**
   * The screen hosting this card was covered or revealed. Hidden WebViews stop painting (no rAF),
   * so the ready() budget only counts while the feed is on screen.
   */
  setHostVisible(visible: boolean): void {
    if (visible === this.hostVisible) return;
    if (!visible && this.loadTimer) {
      this.loadBudgetLeft = Math.max(1000, this.loadBudgetLeft - (this.deps.now() - this.armedAt));
      this.deps.clearTimer(this.loadTimer);
      this.loadTimer = null;
    }
    this.hostVisible = visible;
    if (visible && !this.state.ready && this.loadStartedAt) this.armLoadTimer(this.loadBudgetLeft);
  }

  /** The web content process died or the page failed to load. */
  failLoad(reason: string): void {
    if (this.disposed) return;
    this.deps.clearTimer(this.loadTimer);
    if (this.state.ready) {
      // Crashed after ready: reload transparently.
      this.abandonRun();
      this.state = { ...createCardState(), active: this.state.active, phase: this.state.active ? "LOADING" : "OFFSCREEN" };
      this.resetBridge();
      this.emit({ phase: this.state.phase, ready: false, loadKey: this.snapshot.loadKey + 1 });
      return;
    }
    this.log("violation", `load failed: ${reason}`);
    this.dispatch({ type: "LOAD_FAILED" });
  }

  // ---------------------------------------------------------------------------------------------
  // Contract events

  dispatch(event: ContractEvent): void {
    if (this.disposed) return;
    const prevPhase = this.state.phase;
    const { state, effects } = transition(this.state, event);
    this.state = state;
    if (event.type === "ACTIVATE" && state.active) this.onActivated();
    if (event.type === "DEACTIVATE") this.onDeactivated(prevPhase);
    for (const e of effects) this.run(e);
    this.afterTransition(prevPhase);
  }

  activate(): void {
    this.dispatch({ type: "ACTIVATE" });
  }
  deactivate(): void {
    this.dispatch({ type: "DEACTIVATE" });
  }
  retry(): void {
    this.dispatch({ type: "RETRY" });
  }
  replay(): void {
    this.dispatch({ type: "REPLAY" });
  }
  resumePlay(): void {
    this.dispatch({ type: "RESUME_PLAY" });
  }

  /** Any touch on the card (idle detection in PLAYING). */
  markActivity(): void {
    if (this.state.phase === "PLAYING") this.armIdle();
  }

  setMuted(muted: boolean): void {
    if (this.helloDone) this.send(muted ? "mute" : "unmute");
  }

  /** Layout changed (e.g. rotation of insets). Re-send the inset set. */
  refreshInsets(): void {
    if (this.helloDone) this.sendInsets(true);
  }

  dispose(): void {
    this.abandonRun();
    this.disposed = true;
    this.deps.clearTimer(this.loadTimer);
    this.deps.clearTimer(this.idleTimer);
    this.listeners.clear();
    this.inject = null;
  }

  private onActivated(): void {
    this.activatedAt = this.deps.now();
    if (!this.impressed) {
      this.impressed = true;
      this.track({ type: "impression" });
    }
  }

  private onDeactivated(prevPhase: CardPhase): void {
    if (!this.activatedAt) return;
    const dwellMs = Math.max(0, Math.round(this.deps.now() - this.activatedAt));
    this.track({ type: "skip", dwellMs, state: prevPhase });
    this.activatedAt = 0;
  }

  private afterTransition(prevPhase: CardPhase): void {
    const phase = this.state.phase;
    this.syncClock();
    // Leaving PLAYING (paused, a sheet, background, swiped away) keeps the server's playtime current.
    if (this.clock && prevPhase === "PLAYING" && phase !== "PLAYING") this.reportProgress(this.clock);
    if (phase === "PLAYING") this.armIdle();
    else {
      this.deps.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.helloDone) this.sendInsets(false);
    if (phase !== prevPhase || this.snapshot.ready !== this.state.ready || this.snapshot.runs !== this.state.runs) {
      this.emit({ phase, ready: this.state.ready, runs: this.state.runs });
    }
  }

  private armIdle(): void {
    this.deps.clearTimer(this.idleTimer);
    this.idleTimer = this.deps.setTimer(() => {
      if (this.state.phase === "PLAYING") this.dispatch({ type: "PAUSE", reason: "idle" });
    }, PLAYING_IDLE_PAUSE_MS);
  }

  private run(effect: Effect): void {
    switch (effect.type) {
      case "send":
        if (effect.message === "pause") this.send("pause", { reason: effect.reason });
        else this.send(effect.message);
        return;
      case "reload":
        this.abandonRun();
        this.resetBridge();
        this.emit({ loadKey: this.snapshot.loadKey + 1, ready: false, result: null });
        return;
      case "track":
        if (effect.event === "play_start") this.onRunStarted();
        else if (effect.event === "play_end") this.onRunEnded(effect.score ?? 0);
        else if (effect.event === "load_failed") this.track({ type: "load_failed", meta: { afterMs: Math.round(this.deps.now() - this.loadStartedAt) } });
        else if (effect.event === "replay") this.track({ type: "replay" });
        return;
      case "violation":
        this.log("violation", `${effect.code}: ${effect.detail}`);
        this.deps.onViolation?.(effect.code, effect.detail);
        return;
    }
  }

  private resetBridge(): void {
    this.deps.clearTimer(this.loadTimer);
    this.helloDone = false;
    this.sentInsets = null;
    this.session = null;
    this.allow = createRateLimiter(BRIDGE_RATE_LIMITS);
  }

  // ---------------------------------------------------------------------------------------------
  // Runs, sessions, scores

  private pendingOutcome: CardResult["outcome"];

  private onRunStarted(): void {
    this.runStartedAt = this.deps.now();
    this.emit({ result: null });
    this.track({ type: "play_start" });
    const { game, version } = this.card;
    this.session =
      isUuid(game.id) && isUuid(version.id)
        ? this.deps
            .sessionStart({ gameId: game.id, versionId: version.id, launchReason: this.launchReason, cardId: this.card.cardId.slice(0, 80) })
            .catch(() => null)
        : Promise.resolve(null);
    this.abandonRun();
    // afterTransition starts it: the machine is in PLAYING by now.
    this.clock = {
      session: this.session,
      activeMs: 0,
      runningSince: null,
      qualified: false,
      qualifyTimer: null,
      reportedMs: 0,
      reportedAt: -Infinity,
      trailingTimer: null,
      ended: false,
    };
  }

  private onRunEnded(score: number): void {
    const durationMs = Math.max(0, Math.round(this.deps.now() - this.runStartedAt));
    const clock = this.clock;
    this.clock = null;
    let activeMs: number | undefined;
    if (clock) {
      this.stopClock(clock);
      clock.ended = true;
      this.deps.clearTimer(clock.trailingTimer);
      clock.trailingTimer = null;
      activeMs = Math.round(clock.activeMs);
    }
    const order = this.card.game.score.order;
    const better = (a: number, b: number | null) => b === null || (order === "asc" ? a < b : a > b);
    const previousBest = this.best;
    const localNewBest = better(score, this.best);
    const result: CardResult = {
      score,
      outcome: this.pendingOutcome,
      pending: true,
      best: localNewBest ? score : this.best,
      isNewBest: localNewBest && this.best !== null,
      percentile: null,
      dailyRank: null,
      accepted: null,
    };
    if (localNewBest) this.best = score;
    this.emit({ result });
    const meta: ClientEvent["meta"] = this.challenge ? { challengeCode: this.challenge.code } : undefined;
    this.track({ type: "play_end", score, durationMs, ...(meta ? { meta } : null) });
    const session = this.session;
    this.session = null;
    void (async () => {
      const s = session ? await session : null;
      if (!s) {
        this.patchResult(result, { pending: false });
        return;
      }
      try {
        const res = await this.deps.sessionEnd({
          sessionId: s.sessionId,
          token: s.token,
          score,
          durationMs,
          ...(activeMs !== undefined ? { activeMs } : null),
          ...(this.pendingOutcome ? { outcome: this.pendingOutcome } : null),
        });
        const hadBest = previousBest !== null;
        if (res.best !== null && better(res.best, this.best)) this.best = res.best;
        this.patchResult(result, {
          pending: false,
          best: res.best ?? result.best,
          // A first-ever run is a score, not a record.
          isNewBest: res.isNewBest && hadBest,
          percentile: res.percentile,
          dailyRank: res.dailyRank,
          accepted: res.accepted,
          ...(res.reason ? { reason: res.reason } : null),
        });
      } catch {
        this.patchResult(result, { pending: false });
      }
    })();
  }

  // ---------------------------------------------------------------------------------------------
  // Active playtime (creator analytics): see RunClock.

  private clockMs(c: RunClock): number {
    return c.activeMs + (c.runningSince === null ? 0 : this.deps.now() - c.runningSince);
  }

  /** Runs the clock exactly while the run is in PLAYING and the game is running. */
  private syncClock(): void {
    const c = this.clock;
    if (!c) return;
    const running = this.state.phase === "PLAYING" && shouldRun(this.state);
    if (running && c.runningSince === null) {
      c.runningSince = this.deps.now();
      if (!c.qualified) c.qualifyTimer = this.deps.setTimer(() => this.onQualified(c), Math.max(0, QUALIFIED_PLAY_MS - c.activeMs));
    } else if (!running) {
      this.stopClock(c);
    }
  }

  private stopClock(c: RunClock): void {
    if (c.runningSince !== null) {
      c.activeMs += this.deps.now() - c.runningSince;
      c.runningSince = null;
    }
    this.deps.clearTimer(c.qualifyTimer);
    c.qualifyTimer = null;
  }

  /** The run reached QUALIFIED_PLAY_MS of active play: it counts as a play from now on. */
  private onQualified(c: RunClock): void {
    c.qualifyTimer = null;
    if (c.qualified || c.ended) return;
    c.qualified = true;
    this.reportProgress(c);
  }

  /** Sends the clock to session-progress, at most once per SESSION_PROGRESS_INTERVAL_MS (the latest value trails). */
  private reportProgress(c: RunClock): void {
    if (c.ended) return;
    const activeMs = Math.round(this.clockMs(c));
    if (activeMs <= c.reportedMs) return;
    const now = this.deps.now();
    const wait = c.reportedAt + SESSION_PROGRESS_INTERVAL_MS - now;
    if (wait > 0) {
      c.trailingTimer ??= this.deps.setTimer(() => {
        c.trailingTimer = null;
        this.reportProgress(c);
      }, wait);
      return;
    }
    c.reportedMs = activeMs;
    c.reportedAt = now;
    void c.session
      .then((s) => (s ? this.deps.sessionProgress({ sessionId: s.sessionId, token: s.token, activeMs }) : null))
      .catch(() => null);
  }

  /** The run is gone without an end (reload, crash, card recycled): report what was played. */
  private abandonRun(): void {
    const c = this.clock;
    if (!c) return;
    this.clock = null;
    this.stopClock(c);
    this.reportProgress(c);
  }

  private patchResult(base: CardResult, patch: Partial<CardResult>): void {
    // Ignore late answers for a run the player already replaced.
    if (this.snapshot.result && this.snapshot.result.score === base.score) this.emit({ result: { ...this.snapshot.result, ...patch } });
  }

  // ---------------------------------------------------------------------------------------------
  // Bridge

  /** Raw message from the WebView (already origin-checked by the view). */
  onMessage(raw: string): void {
    if (this.disposed) return;
    const parsed = parseGameMessage(raw);
    if (!parsed.ok) {
      this.log("drop", parsed.reason);
      return;
    }
    const { envelope: env, payload } = parsed;
    const type = env.type as GameToShellType;
    if (!this.allow(type, this.deps.now())) {
      this.log("drop", `rate_limited:${type}`);
      if (REQUEST_TYPES.has(type)) this.replyError(env.id, "rate_limited", `Too many ${type} requests`);
      return;
    }
    if (type !== "log") this.log("in", type);
    switch (type) {
      case "hello":
        void this.onHello(env.id, payload as GameToShellPayload<"hello">);
        return;
      case "ready":
        this.deps.clearTimer(this.loadTimer);
        if (!this.state.ready) {
          this.track({ type: "ready", meta: { ms: Math.round(this.deps.now() - this.loadStartedAt) } });
        }
        this.dispatch({ type: "READY" });
        return;
      case "gameplay.start": {
        const p = payload as GameToShellPayload<"gameplay.start">;
        this.dispatch({ type: "GAMEPLAY_START", ...(p?.trigger ? { trigger: p.trigger } : null) });
        return;
      }
      case "gameplay.end": {
        const p = payload as GameToShellPayload<"gameplay.end">;
        this.pendingOutcome = p.outcome;
        this.dispatch({ type: "GAMEPLAY_END", score: p.score });
        return;
      }
      case "feedback":
        if (this.state.active && this.state.gameRunning) this.deps.feedback((payload as GameToShellPayload<"feedback">).kind);
        return;
      case "analytics.track": {
        const p = payload as GameToShellPayload<"analytics.track">;
        this.track({ type: "custom", meta: { name: p.name, ...(p.props ?? {}) } });
        return;
      }
      case "log":
        if (this.deps.dev) {
          const p = payload as GameToShellPayload<"log">;
          this.log("in", `log.${p.level}: ${p.args.join(" ")}`);
        }
        return;
      case "storage.get":
      case "storage.set":
      case "leaderboard.top":
      case "leaderboard.me":
      case "share.challenge":
        void this.onRequest(env.id, type, payload);
        return;
    }
  }

  private async onHello(id: string, p: GameToShellPayload<"hello">): Promise<void> {
    const major = Number.parseInt(p.sdkVersion, 10);
    if (!SUPPORTED_SDK_MAJORS.includes(major as (typeof SUPPORTED_SDK_MAJORS)[number])) {
      this.replyError(id, "unavailable", `SDK ${p.sdkVersion} is not supported by this app`);
      this.failLoad(`unsupported sdk ${p.sdkVersion}`);
      return;
    }
    const base = await this.deps.launch();
    if (this.disposed) return;
    const current: "preview" | "play" = this.state.phase === "PLAYING" ? "play" : "preview";
    const ctx: LaunchContext = {
      sdkVersion: p.sdkVersion,
      gameId: this.card.game.id,
      versionId: this.card.version.id,
      player: base.player,
      locale: base.locale,
      reducedMotion: base.reducedMotion,
      audio: { muted: base.muted },
      insets: { ...base.insets, current },
      launchReason: this.launchReason,
      seed: this.seed,
      dailySeed: dailySeedFor(new Date(this.deps.now())),
      best: this.best,
      host: base.host,
      ...(this.challenge && this.challenge.score !== null
        ? { challenge: { fromName: this.challenge.fromName, score: this.challenge.score } }
        : null),
    };
    this.helloDone = true;
    this.sentInsets = current;
    this.reply(id, ctx);
  }

  private async onRequest(id: string, type: GameToShellType, payload: unknown): Promise<void> {
    const gameId = this.card.game.id;
    try {
      switch (type) {
        case "storage.get": {
          const p = payload as GameToShellPayload<"storage.get">;
          this.reply(id, { value: await this.deps.storageGet(gameId, p.key) });
          return;
        }
        case "storage.set": {
          const p = payload as GameToShellPayload<"storage.set">;
          if (JSON.stringify(p.value).length > BUDGETS.storageValueBytes) {
            this.replyError(id, "quota", "Values are limited to 16 KB");
            return;
          }
          await this.deps.storageSet(gameId, p.key, p.value);
          this.reply(id, { ok: true });
          return;
        }
        case "leaderboard.top": {
          const p = payload as GameToShellPayload<"leaderboard.top">;
          this.reply(id, { entries: await this.deps.leaderboardTop(gameId, p.scope, p.limit) });
          return;
        }
        case "leaderboard.me":
          this.reply(id, await this.deps.leaderboardMe(gameId));
          return;
        case "share.challenge": {
          const p = payload as GameToShellPayload<"share.challenge">;
          const shared = await this.deps.shareChallenge(this.card, p.score);
          this.reply(id, { shared });
          return;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      this.replyError(id, /quota|exceeds/i.test(msg) ? "quota" : "unavailable", msg);
    }
  }

  private reply(replyTo: string, result: unknown): void {
    const payload: ReplyPayload = { ok: true, result };
    this.post(envelope("reply", payload, replyTo));
  }

  private replyError(replyTo: string, code: "invalid" | "rate_limited" | "unauthorized" | "quota" | "unavailable" | "unknown", message: string): void {
    const payload: ReplyPayload = { ok: false, error: { code, message } };
    this.post(envelope("reply", payload, replyTo));
  }

  private send(type: Exclude<ShellToGameType, "reply">, payload?: unknown): void {
    this.post(envelope(type, payload));
  }

  private sendInsets(force: boolean): void {
    const cfg = gestureConfigFor(this.state.phase, this.card.game.controls);
    if (!force && cfg.insets === this.sentInsets) return;
    // OFFSCREEN cards keep the set they will return to.
    if (this.state.phase === "OFFSCREEN" && !force) return;
    this.sentInsets = cfg.insets;
    const set: InsetSet = { ...this.deps.insets(), current: cfg.insets };
    this.emit({ insets: cfg.insets });
    this.send("insets", set);
  }

  private post(env: { type: string }): void {
    if (env.type !== "reply" || this.deps.dev) this.log("out", env.type);
    this.inject?.(injectionFor(env));
  }

  private track(e: Omit<ClientEvent, "ts" | "gameId" | "versionId" | "cardId">): void {
    const { game, version } = this.card;
    this.deps.track({
      ...e,
      ...(isUuid(game.id) ? { gameId: game.id } : null),
      ...(isUuid(version.id) ? { versionId: version.id } : null),
      cardId: this.card.cardId.slice(0, 80),
    });
  }

  private log(dir: BridgeLogLine["dir"], text: string): void {
    if (!this.deps.dev && dir !== "violation") return;
    const log = [...this.snapshot.log, { t: this.deps.now(), dir, text }].slice(-LOG_MAX);
    this.snapshot = { ...this.snapshot, log };
    if (this.deps.dev) for (const l of this.listeners) l();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID.test(v);
}
