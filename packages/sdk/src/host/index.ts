/**
 * @thumbcade/sdk/host — a framework-agnostic host for games running in an <iframe>.
 *
 * Used by the feed simulator, the portal's web player and admin review player, and the automated
 * reviewer. It validates every inbound message with the zod schemas in @thumbcade/protocol (strict
 * origin + source check, per-type rate limits, unknown types dropped), answers `hello` with the
 * LaunchContext, routes requests to handlers, and exposes `send()` for shell -> game messages plus
 * an event stream for logs.
 */
import {
  BRIDGE_RATE_LIMITS,
  SUPPORTED_SDK_MAJORS,
  ShellToGamePayloads,
  createRateLimiter,
  envelope,
  parseGameMessage,
  REQUEST_TYPES,
} from "@thumbcade/protocol";
import type {
  Envelope,
  ErrorCode,
  GameMessageMap,
  GameMessageType,
  InsetSet,
  LaunchContext,
  ReplyPayload,
  ReplyResultMap,
  RequestMessageType,
  ShellMessageMap,
  ShellMessageType,
} from "../types.ts";

export { feedInsets, gameViewport, FEED_LAYOUT, DEVICES, type DeviceProfile } from "./insets.ts";
export { createLaunchContext } from "./context.ts";
export { observeFrameInput, type FrameInputListener, type FrameInputEvent, type FrameInputObserver } from "./observe.ts";
import { memoryHandlers } from "./memory.ts";
export { memoryHandlers };

export type HelloPayload = GameMessageMap["hello"];

/** Request handlers. Return the result (or a promise of it); throw a `HostError` to reply with an error. */
export type RequestHandlers = {
  [K in RequestMessageType]?: (payload: GameMessageMap[K]) => ReplyResultMap[K] | Promise<ReplyResultMap[K]>;
};

export class HostError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}

/** One line in the host's message log (the simulator's bridge panel renders these). */
export interface HostLogEntry {
  /** `Date.now()` when the message was seen. */
  at: number;
  dir: "in" | "out";
  type: string;
  id: string;
  replyTo?: string;
  payload?: unknown;
  /** Inbound messages that were refused: why (bad_origin, bad_envelope, unknown_type:x, rate_limited, ...). */
  dropped?: string;
}

export type GameMessageListener<K extends GameMessageType> = (payload: GameMessageMap[K], env: Envelope) => void;

export interface IframeHostOptions {
  iframe: HTMLIFrameElement;
  /**
   * Exact origin the game is served from, e.g. "https://duskrail.thumbcade.gg" or
   * "http://127.0.0.1:5555". Inbound messages from any other origin are dropped. Use "null" for a
   * sandboxed iframe without allow-same-origin. Never "*".
   */
  gameOrigin: string;
  /** The LaunchContext answered to `hello`. A function is called for every hello (a game reload says hello again). */
  context: LaunchContext | ((hello: HelloPayload) => LaunchContext | Promise<LaunchContext>);
  /** Request handlers. Defaults: in-memory storage, empty leaderboards, share returns { shared: false }. */
  handlers?: RequestHandlers;
  /** Messages per rolling second per type. Defaults to BRIDGE_RATE_LIMITS from the protocol. */
  rateLimits?: Readonly<Record<string, number>>;
  /** The window that receives postMessage (defaults to the iframe's owner window). */
  window?: Window;
}

export interface IframeHost {
  /** Sends a shell -> game message. Throws if the payload doesn't match the protocol schema. */
  send<T extends ShellMessageType>(type: T, ...payload: ShellMessageMap[T] extends undefined ? [] : [ShellMessageMap[T]]): void;
  /** Subscribes to one game -> shell message type (after validation). Returns an unsubscribe function. */
  on<K extends GameMessageType>(type: K, listener: GameMessageListener<K>): () => void;
  /** Subscribes to every inbound/outbound/dropped message. Returns an unsubscribe function. */
  subscribe(listener: (entry: HostLogEntry) => void): () => void;
  /** True once the current document said hello. Resets when the iframe navigates/reloads. */
  readonly connected: boolean;
  /** SDK version the game reported in its last hello. */
  readonly sdkVersion: string | null;
  /** Removes every listener. The iframe itself is left alone. */
  destroy(): void;
}

export function createIframeHost(options: IframeHostOptions): IframeHost {
  const { iframe, gameOrigin } = options;
  if (!gameOrigin || gameOrigin === "*") throw new Error("createIframeHost: gameOrigin must be an exact origin");
  const win = options.window ?? iframe.ownerDocument.defaultView ?? window;
  const limiter = createRateLimiter(options.rateLimits ?? BRIDGE_RATE_LIMITS);
  const handlers: RequestHandlers = { ...memoryHandlers(), ...options.handlers };
  const typed = new Map<string, Set<GameMessageListener<GameMessageType>>>();
  const taps = new Set<(entry: HostLogEntry) => void>();
  let connected = false;
  let sdkVersion: string | null = null;

  const log = (entry: HostLogEntry) => taps.forEach((t) => t(entry));

  function post(env: Envelope): void {
    const target = iframe.contentWindow;
    if (!target) return;
    target.postMessage(env, gameOrigin === "null" ? "*" : gameOrigin);
    log({ at: Date.now(), dir: "out", type: env.type, id: env.id, replyTo: env.replyTo, payload: env.payload });
  }

  function reply(to: string, payload: ReplyPayload): void {
    post(envelope("reply", payload, to) as Envelope);
  }

  async function answer(env: Envelope, payload: unknown): Promise<void> {
    const type = env.type;
    try {
      let result: unknown;
      if (type === "hello") {
        const hello = payload as HelloPayload;
        const major = Number.parseInt(hello.sdkVersion, 10);
        if (!(SUPPORTED_SDK_MAJORS as readonly number[]).includes(major)) {
          throw new HostError("invalid", `SDK ${hello.sdkVersion} is not supported by this host`);
        }
        sdkVersion = hello.sdkVersion;
        connected = true;
        const c = options.context;
        result = typeof c === "function" ? await c(hello) : c;
      } else {
        const handler = handlers[type as RequestMessageType] as ((p: unknown) => unknown) | undefined;
        if (!handler) throw new HostError("unavailable", `${type} is not available here`);
        result = await handler(payload);
      }
      reply(env.id, { ok: true, result });
    } catch (err) {
      const e = err instanceof HostError ? err : new HostError("unknown", err instanceof Error ? err.message : String(err));
      reply(env.id, { ok: false, error: { code: e.code, message: e.message } });
    }
  }

  function onMessage(event: MessageEvent): void {
    if (event.source !== iframe.contentWindow) return;
    const raw = event.data as { ch?: unknown } | string | null;
    // Ignore unrelated postMessage traffic quietly (dev tools, HMR clients...).
    const looksOurs = typeof raw === "string" ? raw.includes('"ch":"tc"') : !!raw && typeof raw === "object" && raw.ch === "tc";
    if (!looksOurs) return;
    const base = { at: Date.now(), dir: "in" as const };
    if (event.origin !== gameOrigin) {
      log({ ...base, type: "?", id: "?", dropped: `bad_origin:${event.origin}` });
      return;
    }
    const parsed = parseGameMessage(raw);
    if (!parsed.ok) {
      const e = (typeof raw === "object" ? raw : null) as { type?: string; id?: string } | null;
      log({ ...base, type: String(e?.type ?? "?"), id: String(e?.id ?? "?"), dropped: parsed.reason });
      return;
    }
    const env = parsed.envelope as Envelope;
    const entry: HostLogEntry = { ...base, type: env.type, id: env.id, payload: parsed.payload };
    const isRequest = REQUEST_TYPES.has(parsed.envelope.type);
    if (env.type !== "hello" && !limiter(env.type)) {
      log({ ...entry, dropped: "rate_limited" });
      if (isRequest) reply(env.id, { ok: false, error: { code: "rate_limited", message: `${env.type} rate limited` } });
      return;
    }
    log(entry);
    if (isRequest) void answer(env, parsed.payload);
    typed.get(env.type)?.forEach((l) => {
      try {
        l(parsed.payload as never, env);
      } catch (err) {
        console.error(err);
      }
    });
  }

  const onLoad = () => {
    connected = false;
  };

  win.addEventListener("message", onMessage);
  iframe.addEventListener("load", onLoad);

  return {
    send(type, ...rest) {
      const schema = (ShellToGamePayloads as Record<string, { parse(v: unknown): unknown } | undefined>)[type];
      if (!schema || (type as string) === "reply") throw new Error(`unknown shell message ${type}`);
      const checked = schema.parse(rest[0]);
      post(envelope(type, checked) as Envelope);
    },
    on(type, listener) {
      let set = typed.get(type);
      if (!set) typed.set(type, (set = new Set()));
      set.add(listener as unknown as GameMessageListener<GameMessageType>);
      return () => set.delete(listener as unknown as GameMessageListener<GameMessageType>);
    },
    subscribe(listener) {
      taps.add(listener);
      return () => taps.delete(listener);
    },
    get connected() {
      return connected;
    },
    get sdkVersion() {
      return sdkVersion;
    },
    destroy() {
      win.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      taps.clear();
      typed.clear();
    },
  };
}

export type {
  Envelope,
  GameMessageMap,
  GameMessageType,
  InsetSet,
  LaunchContext,
  ReplyResultMap,
  RequestMessageType,
  ShellMessageMap,
  ShellMessageType,
};
