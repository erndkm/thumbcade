import { BUDGETS, PLAYING_IDLE_PAUSE_MS, type Manifest } from "@thumbcade/protocol";
import {
  createIframeHost,
  createLaunchContext,
  DEVICES,
  feedInsets,
  gameViewport,
  memoryHandlers,
  observeFrameInput,
  type DeviceProfile,
  type FrameInputEvent,
  type FrameInputObserver,
  type HostLogEntry,
  type IframeHost,
} from "@thumbcade/sdk/host";
import { readProbe, type ProbeSnapshot } from "@thumbcade/sdk/probe";
import {
  claims,
  createCardState,
  gestureConfigFor,
  resolveRelease,
  shouldShowDockCoach,
  transition,
  type CardState,
  type ContractEvent,
  type Effect,
  type PanRule,
} from "@thumbcade/swipe-contract";
import type { LoadedGame } from "./source.ts";
import { SpringValue } from "./spring.ts";

/** Index of the dev game in the feed. Index 0 is a neighbor card so there is something to swipe back to. */
export const DEV_INDEX = 1;

export type Severity = "error" | "warn";

export interface Violation {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  at: number;
}

export interface LogItem {
  n: number;
  at: number;
  dir: "in" | "out" | "shell";
  type: string;
  payload?: unknown;
  dropped?: string;
}

export interface Perf {
  fps: number | null;
  heapMB: number | null;
  longTasks: number;
  longestTaskMs: number;
  readyMs: number | null;
  frames: number;
}

export interface RunResult {
  score: number;
  best: number | null;
  isNewBest: boolean;
  durationMs: number;
}

export interface SimSnapshot {
  device: DeviceProfile;
  card: CardState;
  index: number;
  muted: boolean;
  showInsets: boolean;
  sheet: "comments" | "share" | null;
  log: LogItem[];
  violations: Violation[];
  perf: Perf;
  connected: boolean;
  sdkVersion: string | null;
  result: RunResult | null;
  coach: boolean;
  /** Input observation: "probe" (lossless), "listeners" (same-origin without probe), "none" (cross-origin). */
  observe: "probe" | "listeners" | "none";
  liked: boolean;
  saved: boolean;
  following: boolean;
  gestureOwner: "game" | "feed" | null;
  reloadKey: number;
}

export interface SimRefs {
  iframe: HTMLIFrameElement;
  /** The phone screen element (unscaled size = device size; scaled with a CSS transform). */
  screen: HTMLElement;
  /** Element translated to move the pager. */
  track: HTMLElement;
}

const LOG_MAX = 400;
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};

interface Gesture {
  source: "surface" | "dock" | "chrome" | "twofinger";
  /** Where its events come from: the game frame (via the probe) or the parent document (chrome). */
  via: "frame" | "parent";
  pointerId: number;
  x0: number;
  y0: number;
  claimed: boolean;
  rule: PanRule;
  offset: number;
  samples: Array<{ t: number; y: number }>;
  /** Element to capture the pointer on once the feed claims a chrome-started gesture. */
  captureEl: Element | null;
}

export class Simulator {
  readonly game: LoadedGame;
  private snapshot: SimSnapshot;
  private listeners = new Set<() => void>();
  private host: IframeHost | null = null;
  private observer: FrameInputObserver | null = null;
  private refs: SimRefs | null = null;
  private handlers = memoryHandlers();
  private spring: SpringValue | null = null;
  private gesture: Gesture | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private loadStartedAt = 0;
  private loadTimer = 0;
  private probeTimer = 0;
  private idleTimer = 0;
  private lastInputAt = performance.now();
  private runStartedAt = 0;
  private replayAt = 0;
  private logN = 0;
  private insetsCurrent: "preview" | "play" = "preview";
  private pauseChecks: number[] = [];
  private seenErrors = 0;
  private readyAt = 0;
  private noEndWarned = false;
  private suppressClickUntil = 0;
  private wheelAccum = 0;
  private wheelLock = 0;
  private lastFpsLowAt = 0;
  private unbinders: Array<() => void> = [];
  private best: number | null = null;

  constructor(game: LoadedGame) {
    this.game = game;
    const deviceId = (store.get("tc-sim-device") as DeviceProfile["id"] | null) ?? "iphone";
    this.snapshot = {
      device: DEVICES[deviceId] ?? DEVICES.iphone,
      card: createCardState(),
      index: DEV_INDEX,
      muted: store.get("tc-sim-muted") !== "0",
      showInsets: store.get("tc-sim-insets") === "1",
      sheet: null,
      log: [],
      violations: [],
      perf: { fps: null, heapMB: null, longTasks: 0, longestTaskMs: 0, readyMs: null, frames: 0 },
      connected: false,
      sdkVersion: null,
      result: null,
      coach: false,
      observe: "none",
      liked: false,
      saved: false,
      following: false,
      gestureOwner: null,
      reloadKey: 0,
    };
  }

  get manifest(): Manifest | null {
    return this.game.manifest;
  }

  get controls() {
    return { vertical: this.manifest?.controls.vertical ?? false, multitouch: this.manifest?.controls.multitouch ?? false };
  }

  get viewport() {
    return gameViewport(this.snapshot.device);
  }

  // ---------------------------------------------------------------------------
  // Store plumbing for React (useSyncExternalStore)
  // ---------------------------------------------------------------------------
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): SimSnapshot => this.snapshot;
  private patch(p: Partial<SimSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...p };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  mount(refs: SimRefs): void {
    this.refs = refs;
    this.spring = new SpringValue(0, (v) => this.applyTrack(v));
    this.spring.set(this.trackFor(this.snapshot.index));
    this.attachHost();
    this.dispatch({ type: "ACTIVATE" });
    this.load();
    this.probeTimer = window.setInterval(() => this.pollProbe(), 500);
    this.idleTimer = window.setInterval(() => this.checkIdle(), 1000);
    const onMove = (e: PointerEvent) => this.onParentPointer("move", e);
    const onUp = (e: PointerEvent) => this.onParentPointer("up", e);
    const onCancel = (e: PointerEvent) => this.onParentPointer("cancel", e);
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    this.unbinders.push(
      () => window.removeEventListener("pointermove", onMove),
      () => window.removeEventListener("pointerup", onUp),
      () => window.removeEventListener("pointercancel", onCancel),
      () => window.removeEventListener("keydown", onKey),
    );
  }

  unmount(): void {
    window.clearInterval(this.probeTimer);
    window.clearInterval(this.idleTimer);
    window.clearTimeout(this.loadTimer);
    this.pauseChecks.forEach((t) => window.clearTimeout(t));
    this.observer?.stop();
    this.host?.destroy();
    this.spring?.stop();
    this.unbinders.forEach((u) => u());
    this.unbinders = [];
    this.refs = null;
  }

  private attachHost(): void {
    const refs = this.refs;
    if (!refs) return;
    const origin = new URL(this.game.source.entryUrl, location.href).origin;
    this.host?.destroy();
    this.host = createIframeHost({
      iframe: refs.iframe,
      gameOrigin: origin,
      handlers: this.handlers,
      context: () =>
        createLaunchContext({
          gameId: this.manifest?.id ?? this.game.source.slug,
          versionId: "dev",
          player: { id: "sim-player-0001", name: "You", avatarUrl: null, guest: false },
          audio: { muted: this.snapshot.muted },
          insets: feedInsets(this.snapshot.device.statusBar, this.insetsCurrent),
          launchReason: "dev",
          host: "simulator",
          best: this.bestScore(),
        }),
    });
    this.host.subscribe((e) => this.onHostLog(e));
    this.host.on("hello", () => this.patch({ connected: true, sdkVersion: this.host?.sdkVersion ?? null }));
    this.host.on("ready", () => {
      this.readyAt = performance.now();
      const readyMs = Math.round(this.readyAt - this.loadStartedAt);
      this.patch({ perf: { ...this.snapshot.perf, readyMs } });
      if (readyMs > BUDGETS.readyMs) {
        this.violate("ready_slow", "warn", `ready() took ${(readyMs / 1000).toFixed(1)} s`, `Budget is ${BUDGETS.readyMs / 1000} s cold on a mid-range phone. Here it's measured on your machine without throttling, so real devices will be slower.`);
      }
      window.clearTimeout(this.loadTimer);
      this.dispatch({ type: "READY" });
      window.setTimeout(() => this.checkInsetsRead(), 4000);
    });
    this.host.on("gameplay.start", (p) => {
      const trigger = p?.trigger;
      if (trigger === "none" && performance.now() - this.replayAt > 2000) {
        this.violate("start_without_tap", "warn", "Run started without a tap", "gameplay.start() arrived with no tap or key press before it. Runs start on a tap (rule 1), or after the shell sends replay.");
      }
      this.runStartedAt = performance.now();
      this.noEndWarned = false;
      this.dispatch({ type: "GAMEPLAY_START", trigger });
    });
    this.host.on("gameplay.end", (p) => {
      const order = this.manifest?.score.order ?? "desc";
      this.handlers.recordScore(p.score, order);
      const better = this.best === null || (order === "asc" ? p.score < this.best : p.score > this.best);
      // A first run of 0 is a best, but not worth a stamp.
      const isNewBest = better && (this.best !== null || p.score !== 0);
      if (better) this.best = p.score;
      const best = this.best;
      const durationMs = this.runStartedAt ? performance.now() - this.runStartedAt : 0;
      this.patch({ result: { score: p.score, best, isNewBest, durationMs } });
      this.dispatch({ type: "GAMEPLAY_END", score: p.score });
    });
    this.host.on("log", (p) => {
      if (p.level === "error") this.violate("uncaught_error", "error", "Error in the game", p.args.join(" ").slice(0, 300));
    });
  }

  private bestScore(): number | null {
    return this.best;
  }

  /** (Re)loads the dev game into the iframe. */
  load(): void {
    const refs = this.refs;
    if (!refs) return;
    window.clearTimeout(this.loadTimer);
    this.observer?.stop();
    this.loadStartedAt = performance.now();
    this.seenErrors = 0;
    this.insetsCurrent = "preview";
    this.patch({ connected: false, perf: { fps: null, heapMB: null, longTasks: 0, longestTaskMs: 0, readyMs: null, frames: 0 }, result: null });
    refs.iframe.src = this.game.source.entryUrl;
    this.observer = observeFrameInput(refs.iframe, (e) => this.onFrameInput(e));
    const updateObserve = () => this.patch({ observe: !this.observer?.attached ? "none" : this.observer.viaProbe ? "probe" : "listeners" });
    refs.iframe.addEventListener("load", updateObserve, { once: true });
    this.loadTimer = window.setTimeout(() => {
      if (!this.snapshot.card.ready) {
        this.violate("ready_timeout", "error", "ready() never arrived", `No ready() within ${BUDGETS.loadTimeoutMs / 1000} s. The feed shows the poster with a retry button and logs load_failed.`);
        this.dispatch({ type: "LOAD_FAILED" });
      }
    }, BUDGETS.loadTimeoutMs);
  }

  /** Full reset: new machine, reload the game. */
  reload(): void {
    const active = this.snapshot.index === DEV_INDEX;
    this.patch({ card: createCardState(), result: null, reloadKey: this.snapshot.reloadKey + 1 });
    if (active) this.dispatch({ type: "ACTIVATE" });
    if (Math.abs(this.snapshot.index - DEV_INDEX) <= 1) this.load();
  }

  // ---------------------------------------------------------------------------
  // The Swipe Contract
  // ---------------------------------------------------------------------------
  dispatch(ev: ContractEvent): void {
    const prev = this.snapshot.card;
    const r = transition(prev, ev);
    this.patch({ card: r.state });
    this.logShell(ev);
    for (const effect of r.effects) this.run(effect);
    if (r.state.phase !== prev.phase) this.onPhase(prev.phase, r.state.phase);
    const want = gestureConfigFor(r.state.phase, this.controls).insets;
    if (want !== this.insetsCurrent && r.state.ready) {
      this.insetsCurrent = want;
      this.host?.send("insets", feedInsets(this.snapshot.device.statusBar, want));
    }
  }

  private run(effect: Effect): void {
    switch (effect.type) {
      case "send":
        if (effect.message === "pause") {
          this.host?.send("pause", { reason: effect.reason });
          this.schedulePauseCheck();
        } else this.host?.send(effect.message);
        return;
      case "violation":
        this.violate(effect.code, effect.code === "end_without_start" ? "warn" : "error", VIOLATION_TITLES[effect.code] ?? effect.code, effect.detail);
        return;
      case "reload":
        this.load();
        return;
      case "track":
        this.pushLog({ dir: "shell", type: `event:${effect.event}`, payload: effect.score !== undefined ? { score: effect.score } : undefined });
        return;
    }
  }

  private onPhase(from: string, to: string): void {
    if (to === "PLAYING" && from !== "PAUSED") {
      const key = "tc-sim-coach";
      const shown = Number(store.get(key) ?? "0");
      if (shouldShowDockCoach("PLAYING", this.controls, shown)) {
        store.set(key, String(shown + 1));
        this.patch({ coach: true });
        window.setTimeout(() => this.patch({ coach: false }), 2600);
      }
    }
    if (to === "PLAYING") this.lastInputAt = performance.now();
  }

  private logShell(ev: ContractEvent): void {
    if (ev.type === "FEED_GESTURE_END" || ev.type === "FEED_GESTURE_BEGIN" || ev.type === "ACTIVATE" || ev.type === "DEACTIVATE" || ev.type === "SUSPEND" || ev.type === "UNSUSPEND" || ev.type === "PAUSE" || ev.type === "RESUME_PLAY" || ev.type === "REPLAY") {
      const { type, ...rest } = ev;
      this.pushLog({ dir: "shell", type, payload: Object.keys(rest).length ? rest : undefined });
    }
  }

  // ---------------------------------------------------------------------------
  // Violations, log, perf
  // ---------------------------------------------------------------------------
  violate(code: string, severity: Severity, title: string, detail: string): void {
    const list = this.snapshot.violations;
    const i = list.findIndex((v) => v.code === code);
    const at = Date.now();
    const next = i >= 0 ? list.map((v, k) => (k === i ? { ...v, count: v.count + 1, at, detail } : v)) : [{ code, severity, title, detail, count: 1, at }, ...list];
    this.patch({ violations: next });
  }

  clearViolations(): void {
    this.patch({ violations: [] });
  }

  private onHostLog(e: HostLogEntry): void {
    this.pushLog({ dir: e.dir, type: e.type, payload: e.payload, dropped: e.dropped });
    if (e.dropped && e.dropped !== "rate_limited") {
      this.violate(`dropped:${e.dropped}`, "warn", "Bridge message dropped", `${e.dropped}. The shell validates every message and drops unknown or malformed ones.`);
    } else if (e.dropped === "rate_limited") {
      this.violate("rate_limited", "warn", `${e.type} rate limited`, `More ${e.type} messages per second than the shell accepts. Batch or debounce them.`);
    }
  }

  private pushLog(item: Omit<LogItem, "n" | "at">): void {
    const log = this.snapshot.log;
    const next = [...log, { ...item, n: ++this.logN, at: performance.now() }];
    this.patch({ log: next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next });
  }

  clearLog(): void {
    this.patch({ log: [] });
  }

  private probe() {
    try {
      return readProbe(this.refs?.iframe.contentWindow);
    } catch {
      return null;
    }
  }

  private pollProbe(): void {
    const probe = this.probe();
    if (!probe) return;
    let snap: ProbeSnapshot;
    try {
      snap = probe.snapshot();
    } catch {
      return;
    }
    const readyGameT = this.readyAt ? snap.now - (performance.now() - this.readyAt) : Infinity;
    const after = snap.longTasks.filter((t) => t.start > readyGameT);
    const longest = after.reduce((m, t) => Math.max(m, t.duration), 0);
    if (longest > BUDGETS.longTaskMs && longest > this.snapshot.perf.longestTaskMs) {
      this.violate("long_task", "warn", `Long task: ${Math.round(longest)} ms`, `A main-thread task after ready() ran longer than ${BUDGETS.longTaskMs} ms. Players feel it as a hitch.`);
    }
    const running = this.snapshot.card.gameRunning === true;
    if (running && this.snapshot.card.phase === "PREVIEW" && snap.fps > 0 && snap.fps < BUDGETS.minFps - 5) {
      if (performance.now() - this.lastFpsLowAt > 3000 && this.readyAt && performance.now() - this.readyAt > 2000) {
        this.lastFpsLowAt = performance.now();
        this.violate("low_fps", "warn", `Attract mode at ${snap.fps} fps`, `Budget: a sustained ${BUDGETS.minFps}+ fps in attract mode.`);
      }
    }
    if (snap.heapBytes && snap.heapBytes > BUDGETS.heapBytes) {
      this.violate("heap", "warn", `JS heap at ${Math.round(snap.heapBytes / 1048576)} MB`, `Budget: ${BUDGETS.heapBytes / 1048576} MB.`);
    }
    if (snap.errors.length > this.seenErrors) {
      for (const err of snap.errors.slice(this.seenErrors)) {
        if (err.startsWith("CSP blocked")) this.violate("csp", "error", "Blocked by the game CSP", `${err}. Games can only load files from their own origin.`);
        else this.violate("uncaught_error", "error", "Uncaught error", err);
        this.pushLog({ dir: "shell", type: "error", payload: err });
      }
      this.seenErrors = snap.errors.length;
    }
    if (snap.foreignRequests.length) {
      this.violate("network", "error", "Request to another origin", `${snap.foreignRequests[0]} — the game CSP blocks every request off the game's own origin.`);
    }
    this.patch({
      perf: {
        fps: running ? snap.fps : 0,
        heapMB: snap.heapBytes ? Math.round((snap.heapBytes / 1048576) * 10) / 10 : null,
        longTasks: after.length,
        longestTaskMs: Math.round(longest),
        readyMs: this.snapshot.perf.readyMs,
        frames: snap.frames,
      },
    });
  }

  /** After a pause, the loop and all audio must stop (rule 5). */
  private schedulePauseCheck(): void {
    const probe = this.probe();
    if (!probe) return;
    let t0: number;
    try {
      t0 = probe.snapshot().now;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      this.pauseChecks = this.pauseChecks.filter((x) => x !== timer);
      if (this.snapshot.card.gameRunning !== false) return;
      const p = this.probe();
      if (!p) return;
      const frames = p.callbacksSince(t0 + 300);
      if (frames > 3) {
        this.violate("loop_after_pause", "error", "Loop still running after pause", `${frames} animation frames ran in the 0.6 s after pause. Stop your loop on pause (tc.loop does it for you).`);
      }
      const audio = p.audio();
      if (audio.audible) {
        this.violate("audio_after_pause", "error", "Audio still playing after pause", `${audio.activeSources + audio.mediaPlaying} sound source(s) still running. Suspend your AudioContext or pause media on pause (rule 5).`);
      }
    }, 900);
    this.pauseChecks.push(timer);
  }

  private checkInsetsRead(): void {
    const probe = this.probe();
    if (!probe) return;
    try {
      if (!probe.snapshot().insetsRead) {
        this.violate("insets_unread", "warn", "Insets never read", "In attract mode the overlay covers the top tabs, the action rail on the right and the caption at the bottom. Read ctx.insets (or the --tc-preview-inset-* CSS variables) and keep your title and prompt clear of them (rule 4).");
      }
    } catch {
      /* frame navigated */
    }
  }

  private checkIdle(): void {
    const s = this.snapshot.card;
    if (s.phase !== "PLAYING") return;
    const idle = performance.now() - this.lastInputAt;
    if (idle > 10_000 && !this.noEndWarned) {
      this.noEndWarned = true;
      this.violate("no_end_after_idle", "warn", "gameplay.end not called after 10 s of inactivity", "No input for 10 s and the run is still going. If the game is over, call gameplay.end() within 1 s (rule 3).");
    }
    if (idle > PLAYING_IDLE_PAUSE_MS) this.dispatch({ type: "PAUSE", reason: "idle" });
  }

  // ---------------------------------------------------------------------------
  // Pager + gestures
  // ---------------------------------------------------------------------------
  private cardHeight(): number {
    return this.viewport.height;
  }

  private trackFor(index: number): number {
    return -index * this.cardHeight();
  }

  private applyTrack(v: number): void {
    if (this.refs) this.refs.track.style.transform = `translate3d(0, ${v}px, 0)`;
  }

  /** Converts a parent-window point to phone-screen points. */
  private toScreen(clientX: number, clientY: number): { x: number; y: number } {
    const el = this.refs?.screen;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    const scale = r.width / this.snapshot.device.width;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  }

  /** Top of the dev card in screen points right now. */
  private devCardTop(): number {
    const pos = this.spring?.value ?? this.trackFor(this.snapshot.index);
    return pos + DEV_INDEX * this.cardHeight();
  }

  private onFrameInput(e: FrameInputEvent): void {
    if (e.synthetic) return;
    if (e.kind === "wheel") {
      this.onWheel(e.dy, "surface");
      return;
    }
    this.lastInputAt = performance.now();
    const p = { x: e.x, y: e.y + this.devCardTop() };
    if (this.gesture && this.gesture.via !== "frame") return;
    this.track(e.kind, e.pointerId, p, e.altKey ? "twofinger" : "surface", "frame");
  }

  /** Pointer down on feed chrome (Dock, overlay, neighbor cards). */
  onChromePointerDown(e: { button: number; pointerId: number; clientX: number; clientY: number; altKey: boolean; currentTarget: EventTarget | null }, source: "dock" | "chrome"): void {
    if (e.button !== 0) return;
    this.lastInputAt = performance.now();
    const p = this.toScreen(e.clientX, e.clientY);
    this.track("down", e.pointerId, p, e.altKey ? "twofinger" : source, "parent");
    // Capture only once the feed claims the gesture (capturing now would retarget the click of a button).
    if (this.gesture && this.gesture.pointerId === e.pointerId) this.gesture.captureEl = e.currentTarget as Element | null;
  }

  private onParentPointer(kind: "move" | "up" | "cancel", e: PointerEvent): void {
    const g = this.gesture;
    // Surface gestures are tracked through the frame (the probe sees them even after input.cancel).
    if (!g || g.pointerId !== e.pointerId || g.via !== "parent") return;
    this.lastInputAt = performance.now();
    this.track(kind, e.pointerId, this.toScreen(e.clientX, e.clientY), g.source, "parent");
  }

  private track(
    kind: "down" | "move" | "up" | "cancel",
    pointerId: number,
    p: { x: number; y: number },
    source: Gesture["source"],
    via: Gesture["via"],
  ): void {
    if (kind === "down") {
      this.pointers.set(pointerId, p);
      if (this.pointers.size >= 2 && this.gesture && !this.gesture.claimed) {
        // A second finger: this is a two-finger gesture now.
        this.gesture.source = "twofinger";
        this.gesture.rule = this.ruleFor("twofinger");
        return;
      }
      if (this.gesture) return;
      if (this.spring?.animating) {
        // Catch the card mid-snap, like a native pager.
        this.spring.stop();
      }
      this.gesture = {
        source,
        via,
        pointerId,
        x0: p.x,
        y0: p.y,
        claimed: false,
        rule: this.ruleFor(source),
        offset: (this.spring?.value ?? 0) - this.trackFor(this.snapshot.index),
        samples: [{ t: performance.now(), y: p.y }],
        captureEl: null,
      };
      return;
    }
    if (kind === "up" || kind === "cancel") this.pointers.delete(pointerId);
    else this.pointers.set(pointerId, p);
    const g = this.gesture;
    if (!g || g.pointerId !== pointerId) return;
    const dx = p.x - g.x0;
    const dy = p.y - g.y0;
    const now = performance.now();
    g.samples.push({ t: now, y: p.y });
    while (g.samples.length > 2 && now - g.samples[0]!.t > 100) g.samples.shift();

    if (!g.claimed && kind === "move" && claims(g.rule, dx, dy)) {
      g.claimed = true;
      g.y0 += Math.sign(dy) * g.rule.activationDistance;
      if (this.snapshot.index === DEV_INDEX) this.dispatch({ type: "FEED_GESTURE_BEGIN" });
      this.patch({ gestureOwner: "feed" });
      this.suppressClickUntil = Infinity;
      try {
        g.captureEl?.setPointerCapture(pointerId);
      } catch {
        /* the pointer is already gone */
      }
    }
    if (g.claimed) {
      const canPrev = this.snapshot.index > 0;
      let drag = g.offset + (p.y - g.y0);
      if (!canPrev && drag > 0) drag *= 0.3;
      this.spring?.set(this.trackFor(this.snapshot.index) + drag);
    } else if (kind === "move" && Math.hypot(dx, dy) > 8 && g.source === "surface") {
      this.patch({ gestureOwner: "game" });
    }

    if (kind === "up" || kind === "cancel") {
      this.gesture = null;
      this.patch({ gestureOwner: null });
      if (!g.claimed) {
        if (g.offset !== 0) this.settle(this.snapshot.index, 0, false);
        return;
      }
      this.suppressClickUntil = performance.now() + 50;
      const first = g.samples[0]!;
      const last = g.samples[g.samples.length - 1]!;
      const vy = last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
      const drag = (this.spring?.value ?? 0) - this.trackFor(this.snapshot.index);
      const decision = kind === "cancel" ? "stay" : resolveRelease(drag, vy, this.cardHeight(), { canNext: true, canPrev: this.snapshot.index > 0 });
      const target = decision === "next" ? this.snapshot.index + 1 : decision === "prev" ? this.snapshot.index - 1 : this.snapshot.index;
      this.settle(target, vy, true);
    }
  }

  /** True when a click on chrome should be ignored because it ended a feed drag. */
  shouldSuppressClick(): boolean {
    return performance.now() < this.suppressClickUntil;
  }

  private ruleFor(source: Gesture["source"]): PanRule {
    const cfg = gestureConfigFor(this.snapshot.index === DEV_INDEX ? this.snapshot.card.phase : "PREVIEW", this.controls);
    if (source === "dock") return cfg.dockPan;
    if (source === "twofinger") return cfg.twoFingerPan.enabled ? cfg.twoFingerPan : cfg.surfacePan;
    return cfg.surfacePan;
  }

  /** Animates the pager to `index`, committing the move to the state machine. */
  private settle(index: number, velocity: number, fromGesture: boolean): void {
    const prev = this.snapshot.index;
    const committed = index !== prev;
    if (fromGesture && prev === DEV_INDEX && this.snapshot.card.feedGesture) this.dispatch({ type: "FEED_GESTURE_END", committed });
    if (committed) this.goTo(index);
    this.spring?.animateTo(this.trackFor(index), velocity);
  }

  private goTo(index: number): void {
    const prev = this.snapshot.index;
    if (index === prev) return;
    if (prev === DEV_INDEX) this.dispatch({ type: "DEACTIVATE" });
    this.patch({ index, sheet: null });
    if (index === DEV_INDEX) {
      this.dispatch({ type: "ACTIVATE" });
      this.lastInputAt = performance.now();
    }
    const distance = Math.abs(index - DEV_INDEX);
    if (distance > 1 && this.refs && !this.refs.iframe.src.startsWith("about:")) {
      // The 3-slot pool: two cards away, the dev game's WebView is recycled. It reloads when it is a neighbor again.
      window.clearTimeout(this.loadTimer);
      this.refs.iframe.src = "about:blank";
      this.patch({ card: createCardState(), connected: false, result: null });
      this.pushLog({ dir: "shell", type: "recycle", payload: { reason: "left the 3-slot pool" } });
    } else if (distance === 1 && this.refs?.iframe.src.startsWith("about:")) {
      // Back in the pool as the next/previous card: preload OFFSCREEN (it pauses itself after ready).
      this.load();
    }
  }

  next(): void {
    this.settle(this.snapshot.index + 1, 0, false);
  }

  prev(): void {
    if (this.snapshot.index > 0) this.settle(this.snapshot.index - 1, 0, false);
  }

  private onWheel(dy: number, where: "surface" | "chrome"): void {
    const phase = this.snapshot.index === DEV_INDEX ? this.snapshot.card.phase : "PREVIEW";
    if (where === "surface" && phase === "PLAYING" && this.controls.vertical) return;
    const now = performance.now();
    if (now < this.wheelLock) return;
    this.wheelAccum += dy;
    if (Math.abs(this.wheelAccum) > 60) {
      const dir = this.wheelAccum > 0 ? 1 : -1;
      this.wheelAccum = 0;
      this.wheelLock = now + 450;
      if (this.snapshot.index === DEV_INDEX && phase === "PLAYING") {
        this.dispatch({ type: "FEED_GESTURE_BEGIN" });
        this.dispatch({ type: "FEED_GESTURE_END", committed: true });
      }
      if (dir > 0) this.next();
      else this.prev();
    }
  }

  onChromeWheel(dy: number): void {
    this.onWheel(dy, "chrome");
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === "ArrowDown" || e.key === "PageDown") {
      e.preventDefault();
      this.next();
    } else if (e.key === "ArrowUp" || e.key === "PageUp") {
      e.preventDefault();
      this.prev();
    }
  }

  // ---------------------------------------------------------------------------
  // UI actions
  // ---------------------------------------------------------------------------
  setDevice(id: DeviceProfile["id"]): void {
    store.set("tc-sim-device", id);
    this.patch({ device: DEVICES[id] });
    this.spring?.set(this.trackFor(this.snapshot.index));
    this.reload();
  }

  toggleMute(): void {
    const muted = !this.snapshot.muted;
    store.set("tc-sim-muted", muted ? "1" : "0");
    this.patch({ muted });
    if (this.snapshot.card.ready) this.host?.send(muted ? "mute" : "unmute");
  }

  toggleInsets(): void {
    const showInsets = !this.snapshot.showInsets;
    store.set("tc-sim-insets", showInsets ? "1" : "0");
    this.patch({ showInsets });
  }

  replay(): void {
    this.replayAt = performance.now();
    this.dispatch({ type: "REPLAY" });
  }

  resume(): void {
    this.lastInputAt = performance.now();
    this.dispatch({ type: "RESUME_PLAY" });
  }

  retry(): void {
    this.dispatch({ type: "RETRY" });
  }

  openSheet(kind: "comments" | "share"): void {
    this.patch({ sheet: kind });
    if (this.snapshot.index === DEV_INDEX) this.dispatch({ type: "SUSPEND", reason: "sheet" });
  }

  closeSheet(): void {
    this.patch({ sheet: null });
    if (this.snapshot.index === DEV_INDEX) this.dispatch({ type: "UNSUSPEND", reason: "sheet" });
  }

  /** Simulates what the phone does: app to background and back, Android back during play, 20 s idle. */
  simulate(kind: "background" | "foreground" | "back" | "idle"): void {
    if (kind === "background") this.dispatch({ type: "SUSPEND", reason: "background" });
    else if (kind === "foreground") this.dispatch({ type: "UNSUSPEND", reason: "background" });
    else if (kind === "back") this.dispatch({ type: "PAUSE", reason: "back" });
    else this.dispatch({ type: "PAUSE", reason: "idle" });
  }

  /** Raw shell -> game message (manual testing from the controls panel). */
  send(type: "pause" | "resume" | "input.cancel" | "replay" | "mute" | "unmute"): void {
    if (!this.host) return;
    if (type === "pause") this.host.send("pause", { reason: "user" });
    else this.host.send(type);
  }

  toggle(key: "liked" | "saved" | "following"): void {
    this.patch({ [key]: !this.snapshot[key] } as Partial<SimSnapshot>);
  }
}

const VIOLATION_TITLES: Record<string, string> = {
  start_by_swipe: "Run started by a swipe",
  start_without_ready: "gameplay.start before ready",
  start_while_paused: "gameplay.start while paused",
  end_without_start: "gameplay.end without a run",
};
