import {
  ANALYTICS_EVENTS,
  ANALYTICS_PER_SECOND,
  CHANNEL,
  HELLO_RETRY_MS,
  IFRAME_FALLBACK_MS,
  PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  SDK_VERSION,
  STORAGE_KEY_PATTERN,
  STORAGE_VALUE_MAX_BYTES,
} from "./constants.ts";
import { injectCss } from "./css.ts";
import { createInput } from "./input.ts";
import { createLoops, type LoopCallback, type LoopHandle, type LoopOptions } from "./loop.ts";
import { standaloneTransport, type StandaloneTransport } from "./standalone.ts";
import { detectKind, iframeTransport, rnTransport, type Transport, type TransportKind } from "./transport.ts";
import type {
  AnalyticsEventName,
  AnalyticsProps,
  Envelope,
  ErrorCode,
  FeedbackKind,
  GameplayEndInput,
  Insets,
  InsetSet,
  Json,
  LaunchContext,
  LeaderboardEntry,
  LeaderboardMe,
  LeaderboardScope,
  PauseReason,
  ReplyPayload,
  SdkEvent,
  SdkEventMap,
  ThumbcadeError,
} from "./types.ts";

type Handler<K extends SdkEvent> = (payload: SdkEventMap[K]) => void;

export interface InitOptions {
  /** Your manifest id. Optional; helps the standalone host and diagnostics. */
  manifestId?: string;
}

export interface Thumbcade {
  /** SDK release, e.g. "1.0.0". */
  readonly version: string;
  /** Connects to the host and resolves with the launch context. Safe to call more than once. */
  init(options?: InitOptions): Promise<LaunchContext>;
  /** First meaningful frame is on screen: the shell crossfades from the poster to your game. */
  ready(): void;
  gameplay: {
    /** Call on the tap that starts a run. */
    start(): void;
    /** Call within 1 s of game over. */
    end(result: GameplayEndInput): void;
  };
  on<K extends SdkEvent>(event: K, handler: Handler<K>): () => void;
  off<K extends SdkEvent>(event: K, handler: Handler<K>): void;
  /** rAF helper: stops while paused, resumes on resume. `dt` is in seconds. */
  loop(callback: LoopCallback, options?: LoopOptions): LoopHandle;
  storage: {
    get<T extends Json = Json>(key: string): Promise<T | null>;
    set(key: string, value: Json): Promise<void>;
  };
  leaderboard: {
    top(options?: { scope?: LeaderboardScope; limit?: number }): Promise<LeaderboardEntry[]>;
    me(): Promise<LeaderboardMe>;
  };
  /** Semantic feedback; the shell decides on haptics. Delivered only during a run (and 1.5 s after it ends), never while paused. */
  feedback(kind: FeedbackKind): void;
  share: {
    /** Opens the shell's challenge share flow. */
    challenge(input: { score: number }): Promise<{ shared: boolean }>;
  };
  analytics: {
    track(name: AnalyticsEventName, props?: AnalyticsProps): void;
  };
  /** Forwards a log line to the host's dev console (simulator, dev builds). No-op in production. */
  log(level: "debug" | "info" | "warn" | "error", ...args: unknown[]): void;
  /** The launch context once init() resolved, else null. */
  readonly context: LaunchContext | null;
  /** The insets that apply right now (preview or play). */
  readonly insets: Insets;
  readonly paused: boolean;
  readonly muted: boolean;
  /** Which transport is in use: React Native WebView, iframe, or the standalone mock. */
  readonly host: TransportKind;
}

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** Feedback right after game over (a "fail" thud, a "success" for a new best) still goes through. */
const FEEDBACK_AFTER_END_MS = 1500;

function sdkError(code: ErrorCode, message: string): ThumbcadeError {
  const err = new Error(message) as ThumbcadeError;
  err.name = "ThumbcadeError";
  err.code = code;
  return err;
}

/**
 * Creates an SDK instance bound to a window. Games use the `thumbcade` singleton; this factory exists
 * for tests and unusual embeddings.
 */
export function createThumbcade(win: Window = window): Thumbcade {
  const doc = win.document;
  injectCss(doc);

  let transport: Transport | null = null;
  let standalone: StandaloneTransport | null = null;
  const input = createInput(
    win as Window & typeof globalThis,
    (e) => !!standalone?.hud && e.composedPath().includes(standalone.hud),
    (e) => standalone?.onHud(e),
  );
  const loops = createLoops(win);
  const handlers = new Map<SdkEvent, Set<Handler<SdkEvent>>>();
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: number }>();
  let seq = 0;
  let ctx: LaunchContext | null = null;
  let initPromise: Promise<LaunchContext> | null = null;
  let insetSet: InsetSet = { preview: ZERO, play: ZERO, current: "preview" };
  let paused = false;
  let muted = false;
  let readySent = false;
  let devLogging = false;
  // Feedback (haptics) only belongs to the player's own run: never to an attract-mode demo.
  let inRun = false;
  let endedAt = -Infinity;
  const analyticsHits: number[] = [];

  const nextId = () => `g${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;

  function connect(kind: TransportKind = detectKind(win)): Transport {
    transport?.close();
    standalone = null;
    if (kind === "rn") transport = rnTransport(win, receive);
    else if (kind === "iframe") transport = iframeTransport(win, receive);
    else transport = standalone = standaloneTransport(win, receive);
    return transport;
  }
  const tp = () => transport ?? connect();

  function post(type: string, payload?: unknown, id = nextId()): string {
    const env: Envelope = { ch: CHANNEL, v: PROTOCOL_VERSION, id, type };
    if (payload !== undefined) env.payload = payload;
    tp().send(env);
    return id;
  }

  function request<T>(type: string, payload?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId();
      const timer = win.setTimeout(() => {
        pending.delete(id);
        reject(sdkError("unavailable", `${type}: the host did not answer`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      post(type, payload, id);
    });
  }

  function emit<K extends SdkEvent>(event: K, payload: SdkEventMap[K]): void {
    handlers.get(event)?.forEach((h) => {
      try {
        (h as Handler<K>)(payload);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function applyInsets(set: InsetSet): void {
    insetSet = set;
    const root = doc.documentElement;
    const cur = set[set.current] ?? ZERO;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      root.style.setProperty(`--tc-inset-${side}`, `${cur[side]}px`);
      root.style.setProperty(`--tc-preview-inset-${side}`, `${set.preview[side]}px`);
      root.style.setProperty(`--tc-play-inset-${side}`, `${set.play[side]}px`);
    }
    root.setAttribute("data-tc-insets", set.current);
  }

  /** Lets the reviewer see that the game consults insets (it can't see CSS variable use). */
  function markInsetsRead(): void {
    doc.documentElement.setAttribute("data-tc-insets-read", "");
  }

  function isInsetSet(v: unknown): v is InsetSet {
    const s = v as InsetSet | null;
    const ok = (i: Insets | undefined) =>
      !!i && ["top", "right", "bottom", "left"].every((k) => typeof i[k as keyof Insets] === "number");
    return !!s && ok(s.preview) && ok(s.play) && (s.current === "preview" || s.current === "play");
  }

  function setPaused(next: boolean, reason?: PauseReason): void {
    if (paused === next) return;
    paused = next;
    if (next) {
      loops.pause();
      emit("pause", { reason: reason ?? "user" });
    } else {
      loops.resume();
      emit("resume", undefined);
    }
  }

  function receive(env: Envelope): void {
    const p = env.payload as Record<string, unknown> | undefined;
    switch (env.type) {
      case "reply": {
        const entry = env.replyTo ? pending.get(env.replyTo) : undefined;
        if (!entry || !env.replyTo) return;
        pending.delete(env.replyTo);
        win.clearTimeout(entry.timer);
        const r = env.payload as ReplyPayload | undefined;
        if (r && r.ok) entry.resolve(r.result);
        else entry.reject(sdkError(r?.error?.code ?? "unknown", r?.error?.message ?? "request failed"));
        return;
      }
      case "pause":
        setPaused(true, p?.reason as PauseReason | undefined);
        return;
      case "resume":
        setPaused(false);
        return;
      case "mute":
      case "unmute":
        if (muted === (env.type === "mute")) return;
        muted = env.type === "mute";
        emit(env.type, undefined);
        return;
      case "insets":
        if (!isInsetSet(p)) return;
        applyInsets(p);
        emit("insets", p);
        return;
      case "input.cancel":
        input.cancel();
        emit("inputCancel", undefined);
        return;
      case "input.inject":
        if (typeof p?.x === "number" && typeof p.y === "number") input.inject(p.x, p.y);
        return;
      case "replay":
        emit("replay", undefined);
        return;
    }
  }

  function handshake(options: InitOptions): Promise<LaunchContext> {
    return new Promise<LaunchContext>((resolve, reject) => {
      const id = nextId();
      const hello = { sdkVersion: SDK_VERSION, ...(options.manifestId ? { manifestId: options.manifestId } : {}) };
      const started = Date.now();
      let retry = 0;
      // No timeout: the host may take its time (e.g. an offscreen preload). Retries cover a host that
      // attached its listener after our first hello.
      pending.set(id, {
        resolve: (result) => {
          win.clearInterval(retry);
          resolve(adopt(result as LaunchContext));
        },
        reject: (err) => {
          win.clearInterval(retry);
          reject(err);
        },
        timer: 0,
      });
      retry = win.setInterval(() => {
        if (!pending.has(id)) return win.clearInterval(retry);
        if (tp().kind === "iframe" && Date.now() - started > IFRAME_FALLBACK_MS) {
          // Embedded somewhere that isn't a Thumbcade host: behave like a standalone tab.
          connect("standalone");
        }
        post("hello", hello, id);
      }, HELLO_RETRY_MS);
      post("hello", hello, id);
    });
  }

  function adopt(raw: LaunchContext): LaunchContext {
    const base = raw && typeof raw === "object" ? raw : ({} as LaunchContext);
    const set = isInsetSet(base.insets) ? base.insets : insetSet;
    muted = !!base.audio?.muted;
    devLogging = base.launchReason === "dev" || base.host === "simulator";
    applyInsets(set);
    const context = { ...base, audio: { muted } } as LaunchContext;
    // `insets` always reflects the latest insets message.
    Object.defineProperty(context, "insets", { enumerable: true, get: () => (markInsetsRead(), insetSet) });
    ctx = context;
    if (devLogging && tp().kind !== "standalone") {
      win.addEventListener("error", (e) => api.log("error", e.message || String(e.error)));
      win.addEventListener("unhandledrejection", (e) => api.log("error", "Unhandled rejection:", e.reason));
    }
    return context;
  }

  const api: Thumbcade = {
    version: SDK_VERSION,
    init(options = {}) {
      // The RN bridge can appear after import on some WebViews: re-detect before the handshake.
      if (!initPromise && detectKind(win) !== tp().kind) connect();
      return (initPromise ??= handshake(options));
    },
    ready() {
      if (readySent) return;
      readySent = true;
      post("ready", {});
    },
    gameplay: {
      start() {
        inRun = true;
        post("gameplay.start", { trigger: input.trigger() });
      },
      end(result) {
        const score = Number(result?.score);
        if (!Number.isFinite(score)) throw new TypeError("gameplay.end({ score }) needs a finite number");
        const payload: GameplayEndInput = { score };
        if (result.outcome) payload.outcome = result.outcome;
        if (result.stats) payload.stats = result.stats;
        inRun = false;
        endedAt = Date.now();
        post("gameplay.end", payload);
      },
    },
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      set.add(handler as Handler<SdkEvent>);
      if (event === "insets") markInsetsRead();
      return () => api.off(event, handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler as Handler<SdkEvent>);
    },
    loop: (cb, opts) => loops.loop(cb, opts),
    storage: {
      get<T extends Json = Json>(key: string) {
        if (!STORAGE_KEY_PATTERN.test(key)) return Promise.reject(sdkError("invalid", `bad storage key "${key}"`));
        return request<{ value: Json | null }>("storage.get", { key }).then((r) => (r?.value ?? null) as T | null);
      },
      set(key, value) {
        if (!STORAGE_KEY_PATTERN.test(key)) return Promise.reject(sdkError("invalid", `bad storage key "${key}"`));
        const size = JSON.stringify(value ?? null).length;
        if (size > STORAGE_VALUE_MAX_BYTES) return Promise.reject(sdkError("quota", `value is ${size} bytes (max 16 KB)`));
        return request("storage.set", { key, value }).then(() => undefined);
      },
    },
    leaderboard: {
      top(options = {}) {
        return request<{ entries: LeaderboardEntry[] }>("leaderboard.top", {
          scope: options.scope ?? "allTime",
          limit: options.limit ?? 10,
        }).then((r) => r?.entries ?? []);
      },
      me: () => request<LeaderboardMe>("leaderboard.me", {}),
    },
    feedback(kind) {
      if (paused || (!inRun && Date.now() - endedAt > FEEDBACK_AFTER_END_MS)) return;
      post("feedback", { kind });
    },
    share: {
      challenge: ({ score }) => request<{ shared: boolean }>("share.challenge", { score }),
    },
    analytics: {
      track(name, props) {
        if (!(ANALYTICS_EVENTS as readonly string[]).includes(name)) {
          console.warn(`[thumbcade] analytics event "${name}" is not on the whitelist`);
          return;
        }
        const t = Date.now();
        while (analyticsHits.length && t - (analyticsHits[0] ?? 0) >= 1000) analyticsHits.shift();
        if (analyticsHits.length >= ANALYTICS_PER_SECOND) return;
        analyticsHits.push(t);
        post("analytics.track", props ? { name, props } : { name });
      },
    },
    log(level, ...args) {
      if (!devLogging || tp().kind === "standalone") return;
      const text = args.slice(0, 20).map((a) => {
        let s: string;
        try {
          s = typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}` : JSON.stringify(a);
        } catch {
          s = String(a);
        }
        return String(s).slice(0, 2000);
      });
      post("log", { level, args: text });
    },
    get context() {
      return ctx;
    },
    get insets() {
      markInsetsRead();
      return insetSet[insetSet.current] ?? ZERO;
    },
    get paused() {
      return paused;
    },
    get muted() {
      return muted;
    },
    get host() {
      return tp().kind;
    },
  };
  // Connect now so shell messages that arrive before init() (pause on an offscreen preload) are seen.
  connect();
  return api;
}
