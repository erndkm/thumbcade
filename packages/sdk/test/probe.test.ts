import { describe, expect, it } from "vitest";
import { PROBE_SOURCE, readProbe } from "../src/probe/index.ts";
import { makeWindow, tick } from "./helpers.ts";

describe("probe", () => {
  it("counts rAF callbacks and tracks audio sources per context state", async () => {
    const win = makeWindow();
    const w = win as unknown as Record<string, unknown>;
    // Minimal Web Audio stand-ins (happy-dom has none).
    class FakeSource extends EventTarget {
      constructor(public context: { state: string }) {
        super();
      }
      start() {}
      stop() {
        this.dispatchEvent(new Event("ended"));
      }
    }
    class FakeContext {
      state = "running";
      createOscillator() {
        return new FakeSource(this);
      }
      suspend() {
        this.state = "suspended";
      }
    }
    w.AudioScheduledSourceNode = FakeSource;
    w.AudioContext = FakeContext;
    win.eval(PROBE_SOURCE);
    const probe = readProbe(win)!;
    expect(probe).not.toBeNull();

    const before = probe.snapshot().now;
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
    expect(probe.callbacksSince(before)).toBe(1);
    expect(probe.snapshot().frames).toBe(1);

    const Ctx = w.AudioContext as new () => FakeContext;
    const ctx = new Ctx();
    expect(ctx).toBeInstanceOf(FakeContext);
    const osc = ctx.createOscillator();
    osc.start();
    expect(probe.audio()).toMatchObject({ contexts: 1, runningContexts: 1, activeSources: 1, audible: true });
    ctx.suspend();
    expect(probe.audio().audible).toBe(false);
    ctx.state = "running";
    osc.stop();
    await tick();
    expect(probe.audio()).toMatchObject({ activeSources: 0, audible: false });
  });

  it("records errors and reports the SDK's insets marker", () => {
    const win = makeWindow();
    win.eval(PROBE_SOURCE);
    win.dispatchEvent(new win.ErrorEvent("error", { message: "boom" }));
    win.document.documentElement.setAttribute("data-tc-insets-read", "");
    const snap = readProbe(win)!.snapshot();
    expect(snap.errors).toContain("boom");
    expect(snap.insetsRead).toBe(true);
  });

  it("is idempotent", () => {
    const win = makeWindow();
    win.eval(PROBE_SOURCE);
    const first = readProbe(win);
    win.eval(PROBE_SOURCE);
    expect(readProbe(win)).toBe(first);
  });
});

describe("probe input feed", () => {
  it("sees input before the SDK can swallow it", async () => {
    const { createThumbcade } = await import("../src/sdk.ts");
    const { rnDeliver } = await import("./helpers.ts");
    const win = makeWindow({ rn: true });
    win.eval(PROBE_SOURCE); // the probe runs first, like `thumbcade dev` and the reviewer inject it
    createThumbcade(win);
    const seen: string[] = [];
    // (happy-dom leaves isTrusted undefined, so `synthetic` can't be asserted here; real browsers set it.)
    readProbe(win)!.onInput((e) => seen.push(`${e.kind}:${e.y}`));
    const body = win.document.body;
    const P = (type: string, y: number) => new win.PointerEvent(type, { pointerId: 1, clientX: 10, clientY: y, bubbles: true });
    body.dispatchEvent(P("pointerdown", 500));
    body.dispatchEvent(P("pointermove", 480));
    rnDeliver(win, "input.cancel");
    body.dispatchEvent(P("pointermove", 300)); // swallowed by the SDK, still seen by the probe
    body.dispatchEvent(P("pointerup", 200));
    expect(seen).toEqual(["down:500", "move:480", "cancel:480", "move:300", "up:200"]);
  });
});
