import { describe, expect, it, vi } from "vitest";
import { createIframeHost, feedInsets, HostError, type HostLogEntry } from "../src/host/index.ts";
import { CONTEXT, tick } from "./helpers.ts";

const ORIGIN = "http://127.0.0.1:5555";

function setup(opts: Partial<Parameters<typeof createIframeHost>[0]> = {}) {
  const game = { postMessage: vi.fn() };
  const listeners = new Map<string, EventListener>();
  const iframe = {
    contentWindow: game,
    ownerDocument: { defaultView: window },
    addEventListener: (t: string, l: EventListener) => listeners.set(t, l),
    removeEventListener: (t: string) => listeners.delete(t),
  } as unknown as HTMLIFrameElement;
  const log: HostLogEntry[] = [];
  const host = createIframeHost({ iframe, gameOrigin: ORIGIN, context: CONTEXT, ...opts });
  host.subscribe((e) => log.push(e));
  const fromGame = (data: unknown, origin = ORIGIN, source: unknown = game) =>
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
  const env = (type: string, payload?: unknown, id = `g${Math.random().toString(36).slice(2, 7)}`) => ({ ch: "tc", v: 1, id, type, payload });
  const replies = () => game.postMessage.mock.calls.map((c) => c[0] as { type: string; replyTo?: string; payload: { ok: boolean; result?: unknown; error?: { code: string } } });
  return { host, game, iframe, log, fromGame, env, replies, listeners };
}

describe("createIframeHost", () => {
  it("answers hello with the LaunchContext, targeting the game origin", async () => {
    const { host, fromGame, env, game } = setup();
    fromGame(env("hello", { sdkVersion: "1.0.0" }, "h1"));
    await tick();
    expect(game.postMessage).toHaveBeenCalledTimes(1);
    const [msg, target] = game.postMessage.mock.calls[0]!;
    expect(target).toBe(ORIGIN);
    expect(msg).toMatchObject({ ch: "tc", v: 1, type: "reply", replyTo: "h1", payload: { ok: true, result: CONTEXT } });
    expect(host.connected).toBe(true);
    expect(host.sdkVersion).toBe("1.0.0");
  });

  it("builds the context per hello when given a function", async () => {
    const context = vi.fn(async () => ({ ...CONTEXT, seed: 99 }));
    const { fromGame, env, replies } = setup({ context });
    fromGame(env("hello", { sdkVersion: "1.2.0", manifestId: "stackd" }));
    await tick();
    expect(context).toHaveBeenCalledWith({ sdkVersion: "1.2.0", manifestId: "stackd" });
    expect(replies()[0]!.payload.result).toMatchObject({ seed: 99 });
  });

  it("refuses unsupported SDK majors", async () => {
    const { fromGame, env, replies, host } = setup();
    fromGame(env("hello", { sdkVersion: "7.0.0" }));
    await tick();
    expect(replies()[0]!.payload).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(host.connected).toBe(false);
  });

  it("drops messages from the wrong origin or source, malformed envelopes and unknown types", async () => {
    const { fromGame, env, log, game } = setup();
    fromGame(env("ready"), "https://evil.example");
    fromGame(env("ready"), ORIGIN, { postMessage() {} }); // another window: ignored silently
    fromGame({ ch: "tc", v: 1, type: "ready" });
    fromGame(env("teleport", {}));
    fromGame(env("gameplay.end", { score: "lots" }));
    fromGame({ unrelated: true });
    await tick();
    expect(log.map((e) => e.dropped)).toEqual([
      `bad_origin:https://evil.example`,
      "bad_envelope",
      "unknown_type:teleport",
      "bad_payload:gameplay.end",
    ]);
    expect(game.postMessage).not.toHaveBeenCalled();
  });

  it("accepts JSON-string envelopes", async () => {
    const { host, fromGame, env } = setup();
    const ready = vi.fn();
    host.on("ready", ready);
    fromGame(JSON.stringify(env("ready", {})));
    await tick();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("routes typed listeners after validation", async () => {
    const { host, fromGame, env } = setup();
    const onEnd = vi.fn();
    const onStart = vi.fn();
    host.on("gameplay.end", onEnd);
    host.on("gameplay.start", onStart);
    fromGame(env("gameplay.start", { trigger: "swipe" }));
    fromGame(env("gameplay.end", { score: 412, outcome: "lose" }));
    await tick();
    expect(onStart.mock.calls[0]![0]).toEqual({ trigger: "swipe" });
    expect(onEnd.mock.calls[0]![0]).toEqual({ score: 412, outcome: "lose" });
  });

  it("rate-limits per type and answers rate-limited requests with an error", async () => {
    const { fromGame, env, replies, log } = setup({ rateLimits: { "storage.set": 2, default: 60 } });
    for (let i = 0; i < 4; i++) fromGame(env("storage.set", { key: "k", value: i }, `s${i}`));
    await tick();
    const r = replies();
    expect(r.filter((x) => x.payload.ok)).toHaveLength(2);
    expect(r.filter((x) => !x.payload.ok).map((x) => x.payload.error?.code)).toEqual(["rate_limited", "rate_limited"]);
    expect(log.filter((e) => e.dropped === "rate_limited")).toHaveLength(2);
  });

  it("uses in-memory storage by default and custom handlers when given", async () => {
    const { fromGame, env, replies } = setup();
    fromGame(env("storage.set", { key: "best", value: 7 }, "a"));
    fromGame(env("storage.get", { key: "best" }, "b"));
    await tick();
    expect(replies().find((x) => x.replyTo === "b")!.payload.result).toEqual({ value: 7 });

    const custom = setup({
      handlers: {
        "leaderboard.top": () => {
          throw new HostError("unauthorized", "sign in first");
        },
        "leaderboard.me": async () => ({ best: 5, rank: 2, percentile: 90 }),
      },
    });
    custom.fromGame(custom.env("leaderboard.top", { scope: "friends", limit: 3 }, "t"));
    custom.fromGame(custom.env("leaderboard.me", {}, "m"));
    await tick();
    expect(custom.replies().find((x) => x.replyTo === "t")!.payload).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(custom.replies().find((x) => x.replyTo === "m")!.payload.result).toEqual({ best: 5, rank: 2, percentile: 90 });
  });

  it("send() validates payloads against the protocol and logs outbound messages", () => {
    const { host, game, log } = setup();
    host.send("pause", { reason: "feedGesture" });
    host.send("input.cancel");
    host.send("insets", feedInsets(47, "play"));
    expect(game.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(["pause", "input.cancel", "insets"]);
    expect(log.map((e) => `${e.dir}:${e.type}`)).toEqual(["out:pause", "out:input.cancel", "out:insets"]);
    expect(() => host.send("pause", { reason: "nap" } as never)).toThrow();
  });

  it("resets connected on iframe reload and stops listening after destroy", async () => {
    const { host, fromGame, env, listeners, log } = setup();
    fromGame(env("hello", { sdkVersion: "1.0.0" }));
    await tick();
    listeners.get("load")!(new Event("load"));
    expect(host.connected).toBe(false);
    host.destroy();
    fromGame(env("ready"));
    expect(log.filter((e) => e.type === "ready")).toHaveLength(0);
  });

  it("refuses a wildcard origin", () => {
    expect(() => setup({ gameOrigin: "*" })).toThrow();
  });
});

describe("feedInsets", () => {
  it("covers status bar + top tabs, the action rail and the caption in preview; only the status bar in play", () => {
    expect(feedInsets(47)).toEqual({
      preview: { top: 91, right: 72, bottom: 148, left: 0 },
      play: { top: 47, right: 0, bottom: 0, left: 0 },
      current: "preview",
    });
  });
});
