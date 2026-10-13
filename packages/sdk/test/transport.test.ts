import { describe, expect, it, vi } from "vitest";
import { createThumbcade } from "../src/sdk.ts";
import { detectKind, toEnvelope } from "../src/transport.ts";
import { CONTEXT, makeWindow, rnDeliver, rnSent, tick } from "./helpers.ts";

describe("envelope guard", () => {
  it("accepts objects and JSON strings with the tc channel", () => {
    const env = { ch: "tc", v: 1, id: "a", type: "pause", payload: { reason: "user" } };
    expect(toEnvelope(env)).toEqual(env);
    expect(toEnvelope(JSON.stringify(env))).toEqual(env);
  });
  it("rejects unrelated traffic", () => {
    expect(toEnvelope({ ch: "other", v: 1, id: "a", type: "x" })).toBeNull();
    expect(toEnvelope({ ch: "tc", v: 2, id: "a", type: "x" })).toBeNull();
    expect(toEnvelope({ ch: "tc", v: 1, type: "x" })).toBeNull();
    expect(toEnvelope({ ch: "tc", v: 1, id: "a", type: "x", replyTo: 5 })).toBeNull();
    expect(toEnvelope("webpackHotUpdate")).toBeNull();
    expect(toEnvelope("{not json")).toBeNull();
    expect(toEnvelope(null)).toBeNull();
    expect(toEnvelope(42)).toBeNull();
  });
});

describe("transport detection", () => {
  it("prefers the React Native bridge", () => {
    expect(detectKind(makeWindow({ rn: true }))).toBe("rn");
  });
  it("detects an iframe", () => {
    expect(detectKind(makeWindow({ parent: { postMessage: vi.fn() } }))).toBe("iframe");
  });
  it("falls back to standalone in a top-level tab", () => {
    expect(detectKind(makeWindow())).toBe("standalone");
  });
  it("can be forced with ?tc_host=", () => {
    expect(detectKind(makeWindow({ rn: true, url: "http://game.test/?tc_host=standalone" }))).toBe("standalone");
  });
});

describe("React Native WebView transport", () => {
  it("sends JSON strings and accepts object or string MessageEvents", async () => {
    const win = makeWindow({ rn: true });
    const tc = createThumbcade(win);
    const ctxP = tc.init({ manifestId: "lane-rush" });
    await tick();
    const [hello] = rnSent(win);
    expect(hello).toMatchObject({ ch: "tc", v: 1, type: "hello", payload: { sdkVersion: "1.0.0", manifestId: "lane-rush" } });
    // Reply delivered as a JSON string (some shells stringify).
    rnDeliver(win, "reply", { ok: true, result: CONTEXT }, hello!.id, true);
    const ctx = await ctxP;
    expect(ctx.gameId).toBe("lane-rush");
    expect(tc.host).toBe("rn");
    // Object form.
    const onPause = vi.fn();
    tc.on("pause", onPause);
    rnDeliver(win, "pause", { reason: "offscreen" });
    expect(onPause).toHaveBeenCalledWith({ reason: "offscreen" });
  });

  it("also listens on document (legacy Android dispatch)", async () => {
    const win = makeWindow({ rn: true });
    const tc = createThumbcade(win);
    void tc.init();
    const onMute = vi.fn();
    tc.on("mute", onMute);
    win.document.dispatchEvent(new win.MessageEvent("message", { data: { ch: "tc", v: 1, id: "x", type: "mute" } }));
    expect(onMute).toHaveBeenCalledTimes(1);
  });
});

describe("iframe transport", () => {
  it("posts to the parent and only accepts messages whose source is the parent", async () => {
    const parent = { postMessage: vi.fn() };
    const win = makeWindow({ parent });
    const tc = createThumbcade(win);
    const ctxP = tc.init();
    await tick();
    const [env, target] = parent.postMessage.mock.calls[0]!;
    expect(env).toMatchObject({ ch: "tc", type: "hello" });
    expect(target).toBe("*");
    const reply = { ch: "tc", v: 1, id: "r1", type: "reply", replyTo: (env as { id: string }).id, payload: { ok: true, result: CONTEXT } };
    // A spoofed message from another window is ignored.
    const stranger = { postMessage: vi.fn() };
    win.dispatchEvent(new win.MessageEvent("message", { data: { ...reply, payload: { ok: true, result: { ...CONTEXT, gameId: "evil" } } }, source: stranger as unknown as Window }));
    win.dispatchEvent(new win.MessageEvent("message", { data: reply, source: parent as unknown as Window }));
    const ctx = await ctxP;
    expect(ctx.gameId).toBe("lane-rush");
    expect(tc.host).toBe("iframe");
  });

  it("re-sends hello until the host answers", async () => {
    const parent = { postMessage: vi.fn() };
    const win = makeWindow({ parent });
    const tc = createThumbcade(win);
    void tc.init();
    await tick(600);
    const hellos = parent.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === "hello");
    expect(hellos.length).toBeGreaterThanOrEqual(2);
    // Same id every time, so a late reply to any of them resolves init.
    expect(new Set(hellos.map((c) => (c[0] as { id: string }).id)).size).toBe(1);
  });
});

describe("standalone transport", () => {
  it("answers hello with a dev context and mounts the HUD", async () => {
    const win = makeWindow();
    const tc = createThumbcade(win);
    const ctx = await tc.init({ manifestId: "pairs" });
    expect(tc.host).toBe("standalone");
    expect(ctx).toMatchObject({ gameId: "pairs", launchReason: "dev", host: "standalone", best: null });
    expect(win.document.getElementById("tc-dev-hud")).not.toBeNull();
  });
});
