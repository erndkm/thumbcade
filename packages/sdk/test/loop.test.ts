import { describe, expect, it, vi } from "vitest";
import { createLoops } from "../src/loop.ts";

function fakeWindow() {
  let id = 0;
  const queue = new Map<number, FrameRequestCallback>();
  const win = {
    requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
      queue.set(++id, cb);
      return id;
    }),
    cancelAnimationFrame: vi.fn((h: number) => queue.delete(h)),
  };
  const frame = (t: number) => {
    const cbs = [...queue.values()];
    queue.clear();
    cbs.forEach((cb) => cb(t));
  };
  return { win: win as unknown as Window, frame, pending: () => queue.size };
}

describe("tc.loop", () => {
  it("passes dt in seconds (0 on the first frame) and total time", () => {
    const { win, frame } = fakeWindow();
    const loops = createLoops(win);
    const cb = vi.fn();
    loops.loop(cb);
    frame(1000);
    frame(1016);
    frame(1050);
    expect(cb.mock.calls.map((c) => c[0])).toEqual([0, 0.016, 0.034]);
    expect(cb.mock.calls.at(-1)![1]).toBeCloseTo(0.05);
  });

  it("clamps dt to maxDt", () => {
    const { win, frame } = fakeWindow();
    const cb = vi.fn();
    createLoops(win).loop(cb, { maxDt: 0.05 });
    frame(0);
    frame(500);
    expect(cb.mock.calls[1]![0]).toBe(0.05);
  });

  it("stops on pause and never reports paused time as dt", () => {
    const { win, frame, pending } = fakeWindow();
    const loops = createLoops(win);
    const cb = vi.fn();
    const h = loops.loop(cb);
    frame(0);
    frame(16);
    loops.pause();
    expect(pending()).toBe(0);
    expect(h.running).toBe(false);
    frame(32);
    expect(cb).toHaveBeenCalledTimes(2);
    loops.resume();
    expect(h.running).toBe(true);
    frame(5000);
    frame(5016);
    expect(cb.mock.calls.slice(2).map((c) => c[0])).toEqual([0, 0.016]);
  });

  it("stop() and start() control a single loop; stopped loops stay stopped across resume", () => {
    const { win, frame } = fakeWindow();
    const loops = createLoops(win);
    const a = vi.fn();
    const b = vi.fn();
    const ha = loops.loop(a);
    loops.loop(b);
    ha.stop();
    loops.pause();
    loops.resume();
    frame(0);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    ha.start();
    frame(16);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("a callback may stop its own loop", () => {
    const { win, frame, pending } = fakeWindow();
    const loops = createLoops(win);
    const h = loops.loop(() => h.stop());
    frame(0);
    expect(pending()).toBe(0);
  });

  it("keeps running when a frame throws", () => {
    const { win, frame } = fakeWindow();
    let n = 0;
    createLoops(win).loop(() => {
      n++;
      if (n === 1) throw new Error("frame bug");
    });
    expect(() => frame(0)).toThrow("frame bug");
    frame(16);
    expect(n).toBe(2);
  });
});
