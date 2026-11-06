import { describe, expect, it, vi } from "vitest";
import { createThumbcade } from "../src/sdk.ts";
import { CONTEXT, handshake, makeWindow, rnDeliver, rnSent, tick } from "./helpers.ts";

function setup() {
  const win = makeWindow({ rn: true });
  const tc = createThumbcade(win);
  return { win, tc, sent: () => rnSent(win) };
}

describe("init", () => {
  it("resolves with the LaunchContext and caches the promise", async () => {
    const { win, tc } = setup();
    const a = tc.init();
    const b = tc.init();
    expect(a).toBe(b);
    await handshake(win);
    const ctx = await a;
    expect(ctx).toMatchObject({ gameId: "duskrail", best: 120, launchReason: "feed" });
    expect(tc.context).toBe(ctx);
    expect(tc.muted).toBe(true);
  });

  it("applies insets as CSS variables and keeps ctx.insets live", async () => {
    const { win, tc } = setup();
    const p = tc.init();
    await handshake(win);
    const ctx = await p;
    const root = win.document.documentElement;
    expect(root.style.getPropertyValue("--tc-inset-right")).toBe("72px");
    expect(root.style.getPropertyValue("--tc-play-inset-top")).toBe("47px");
    expect(root.getAttribute("data-tc-insets")).toBe("preview");
    const onInsets = vi.fn();
    tc.on("insets", onInsets);
    const next = { ...CONTEXT.insets, current: "play" };
    rnDeliver(win, "insets", next);
    expect(onInsets).toHaveBeenCalledWith(next);
    expect(ctx.insets.current).toBe("play");
    expect(tc.insets).toEqual(CONTEXT.insets.play);
    expect(root.style.getPropertyValue("--tc-inset-right")).toBe("0px");
    expect(root.hasAttribute("data-tc-insets-read")).toBe(true);
  });

  it("ignores malformed insets", async () => {
    const { win, tc } = setup();
    void tc.init();
    await handshake(win);
    const onInsets = vi.fn();
    tc.on("insets", onInsets);
    rnDeliver(win, "insets", { preview: { top: 1 }, current: "play" });
    expect(onInsets).not.toHaveBeenCalled();
  });

  it("rejects when the host refuses the SDK version", async () => {
    const { win, tc } = setup();
    const p = tc.init();
    await tick();
    const hello = rnSent(win)[0]!;
    rnDeliver(win, "reply", { ok: false, error: { code: "invalid", message: "SDK 9 is not supported" } }, hello.id);
    await expect(p).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("lifecycle messages", () => {
  it("sends ready once", async () => {
    const { tc, sent } = setup();
    tc.ready();
    tc.ready();
    await tick();
    expect(sent().filter((e) => e.type === "ready")).toHaveLength(1);
  });

  it("reports the start trigger: tap", async () => {
    const { win, tc, sent } = setup();
    const el = win.document.body;
    el.dispatchEvent(new win.PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 300, bubbles: true }));
    el.dispatchEvent(new win.PointerEvent("pointerup", { pointerId: 1, clientX: 103, clientY: 302, bubbles: true }));
    tc.gameplay.start();
    expect(sent().at(-1)).toMatchObject({ type: "gameplay.start", payload: { trigger: "tap" } });
  });

  it("reports the start trigger: swipe (in progress and finished)", async () => {
    const { win, tc, sent } = setup();
    const el = win.document.body;
    el.dispatchEvent(new win.PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 500, bubbles: true }));
    el.dispatchEvent(new win.PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 420, bubbles: true }));
    tc.gameplay.start();
    expect(sent().at(-1)?.payload).toEqual({ trigger: "swipe" });
    el.dispatchEvent(new win.PointerEvent("pointerup", { pointerId: 1, clientX: 100, clientY: 380, bubbles: true }));
    tc.gameplay.start();
    expect(sent().at(-1)?.payload).toEqual({ trigger: "swipe" });
  });

  it("reports the start trigger: key and none", async () => {
    const { win, tc, sent } = setup();
    tc.gameplay.start();
    expect(sent().at(-1)?.payload).toEqual({ trigger: "none" });
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: " " }));
    tc.gameplay.start();
    expect(sent().at(-1)?.payload).toEqual({ trigger: "key" });
  });

  it("sends gameplay.end with score, outcome and stats, and rejects non-finite scores", () => {
    const { tc, sent } = setup();
    tc.gameplay.end({ score: 412, outcome: "lose", stats: { level: 3 } });
    expect(sent().at(-1)).toMatchObject({ type: "gameplay.end", payload: { score: 412, outcome: "lose", stats: { level: 3 } } });
    expect(() => tc.gameplay.end({ score: Number.NaN })).toThrow(TypeError);
  });

  it("emits pause/resume once per change and stops tc.loop", async () => {
    const { win, tc } = setup();
    const raf = vi.spyOn(win, "requestAnimationFrame");
    const onPause = vi.fn();
    const onResume = vi.fn();
    tc.on("pause", onPause);
    tc.on("resume", onResume);
    const frames = vi.fn();
    tc.loop(frames);
    expect(raf).toHaveBeenCalledTimes(1);
    rnDeliver(win, "pause", { reason: "feedGesture" });
    rnDeliver(win, "pause", { reason: "feedGesture" });
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledWith({ reason: "feedGesture" });
    expect(tc.paused).toBe(true);
    await tick(50);
    expect(frames).not.toHaveBeenCalled();
    rnDeliver(win, "resume");
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(tc.paused).toBe(false);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it("emits mute/unmute and replay", () => {
    const { win, tc } = setup();
    const onMute = vi.fn();
    const onUnmute = vi.fn();
    const onReplay = vi.fn();
    tc.on("mute", onMute);
    tc.on("unmute", onUnmute);
    tc.on("replay", onReplay);
    rnDeliver(win, "mute");
    expect(tc.muted).toBe(true);
    rnDeliver(win, "unmute");
    rnDeliver(win, "replay");
    expect(onMute).toHaveBeenCalledTimes(1);
    expect(onUnmute).toHaveBeenCalledTimes(1);
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("on() returns an unsubscribe function and a throwing handler doesn't break others", () => {
    const { win, tc } = setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    const off = tc.on("replay", bad);
    tc.on("replay", good);
    rnDeliver(win, "replay");
    off();
    rnDeliver(win, "replay");
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

describe("requests", () => {
  it("storage.get / storage.set round-trip through replies", async () => {
    const { win, tc, sent } = setup();
    const set = tc.storage.set("best", { score: 9 });
    await tick();
    const setReq = sent().at(-1)!;
    expect(setReq).toMatchObject({ type: "storage.set", payload: { key: "best", value: { score: 9 } } });
    rnDeliver(win, "reply", { ok: true, result: { ok: true } }, setReq.id);
    await expect(set).resolves.toBeUndefined();

    const get = tc.storage.get<{ score: number }>("best");
    await tick();
    rnDeliver(win, "reply", { ok: true, result: { value: { score: 9 } } }, sent().at(-1)!.id);
    await expect(get).resolves.toEqual({ score: 9 });
  });

  it("validates storage keys and value size locally", async () => {
    const { tc } = setup();
    await expect(tc.storage.get("bad key!")).rejects.toMatchObject({ code: "invalid" });
    await expect(tc.storage.set("big", "x".repeat(17 * 1024))).rejects.toMatchObject({ code: "quota" });
  });

  it("maps error replies to ThumbcadeError", async () => {
    const { win, tc, sent } = setup();
    const p = tc.leaderboard.top({ scope: "daily", limit: 5 });
    await tick();
    expect(sent().at(-1)).toMatchObject({ type: "leaderboard.top", payload: { scope: "daily", limit: 5 } });
    rnDeliver(win, "reply", { ok: false, error: { code: "rate_limited", message: "slow down" } }, sent().at(-1)!.id);
    await expect(p).rejects.toMatchObject({ name: "ThumbcadeError", code: "rate_limited", message: "slow down" });
  });

  it("leaderboard.me and share.challenge resolve with results", async () => {
    const { win, tc, sent } = setup();
    const me = tc.leaderboard.me();
    await tick();
    rnDeliver(win, "reply", { ok: true, result: { best: 10, rank: 3, percentile: 88 } }, sent().at(-1)!.id);
    await expect(me).resolves.toEqual({ best: 10, rank: 3, percentile: 88 });
    const share = tc.share.challenge({ score: 412 });
    await tick();
    expect(sent().at(-1)).toMatchObject({ type: "share.challenge", payload: { score: 412 } });
    rnDeliver(win, "reply", { ok: true, result: { shared: true } }, sent().at(-1)!.id);
    await expect(share).resolves.toEqual({ shared: true });
  });

  it("ignores replies to unknown ids", async () => {
    const { win, tc } = setup();
    void tc.init();
    expect(() => rnDeliver(win, "reply", { ok: true, result: {} }, "nope")).not.toThrow();
  });
});

describe("fire-and-forget", () => {
  it("feedback is delivered during a run and right after it, never in attract mode or while paused", async () => {
    const { win, tc, sent } = setup();
    const count = () => sent().filter((e) => e.type === "feedback").length;
    tc.feedback("tap"); // attract demo
    expect(count()).toBe(0);
    tc.gameplay.start();
    tc.feedback("impact");
    expect(sent().at(-1)).toMatchObject({ type: "feedback", payload: { kind: "impact" } });
    rnDeliver(win, "pause", { reason: "sheet" });
    tc.feedback("tap");
    expect(count()).toBe(1);
    rnDeliver(win, "resume");
    tc.gameplay.end({ score: 3 });
    tc.feedback("fail"); // the game-over thud still lands
    expect(count()).toBe(2);
  });

  it("analytics: whitelist and 10/s client-side limit", () => {
    const { tc, sent } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    tc.analytics.track("buy_gems" as never);
    expect(warn).toHaveBeenCalled();
    for (let i = 0; i < 15; i++) tc.analytics.track("level_complete", { level: i });
    expect(sent().filter((e) => e.type === "analytics.track")).toHaveLength(10);
    warn.mockRestore();
  });

  it("log only forwards in dev launches", async () => {
    const { win, tc, sent } = setup();
    void tc.init();
    await handshake(win, { ...CONTEXT, launchReason: "dev", host: "simulator" });
    tc.log("warn", "hello", { a: 1 }, new Error("x"));
    expect(sent().at(-1)).toMatchObject({ type: "log", payload: { level: "warn", args: ["hello", '{"a":1}', "Error: x"] } });

    const prod = setup();
    void prod.tc.init();
    await handshake(prod.win);
    prod.tc.log("info", "quiet");
    expect(prod.sent().some((e) => e.type === "log")).toBe(false);
  });
});

describe("input.inject", () => {
  it("synthesizes a tap at the given point", () => {
    const { win } = setup();
    const down = vi.fn();
    const click = vi.fn();
    win.document.body.addEventListener("pointerdown", down);
    win.document.body.addEventListener("click", click);
    rnDeliver(win, "input.inject", { kind: "tap", x: 10, y: 20 });
    expect(down).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
