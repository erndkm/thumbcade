import { describe, expect, it, vi } from "vitest";
import { hsl, mix, rgba, shade } from "../src/color.ts";
import { clamp, damp, easeOutBack, easeOutCubic, lerp, remap, Spring, Tween } from "../src/ease.ts";
import { onDrag, onSwipe, onTap, onTapOrHold, type Dir } from "../src/input.ts";
import { Particles, Popups } from "../src/particles.ts";
import { createRng } from "../src/rng.ts";
import { HitStop, Shake } from "../src/shake.ts";
import { Counter, safeRect } from "../src/ui.ts";

const P = (type: string, x: number, y: number, id = 1) => new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, button: 0, pointerType: "touch" });

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(xs[0]);
  });

  it("int/pick/shuffle stay in range and keep elements", () => {
    const r = createRng(7);
    for (let i = 0; i < 200; i++) {
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(["a", "b"]).toContain(r.pick(["a", "b"]));
    expect(r.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("easing", () => {
  it("interpolates and clamps", () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(clamp(2)).toBe(1);
    expect(remap(5, 0, 10, 100, 200)).toBe(150);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(0.6)).toBeGreaterThan(1); // overshoots
  });

  it("damp is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 5, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = damp(b, 1, 5, 1 / 30);
    expect(a).toBeCloseTo(b, 6);
  });

  it("springs settle on the target, even at low frame rates", () => {
    const s = new Spring(0, 260, 22);
    s.target = 100;
    for (let i = 0; i < 120; i++) s.update(1 / 15);
    expect(s.value).toBeCloseTo(100, 2);
    expect(s.settled).toBe(true);
  });

  it("tweens run once", () => {
    const t = new Tween(0.5);
    t.update(0.25);
    expect(t.done).toBe(false);
    t.update(1);
    expect(t.value).toBe(1);
    expect(t.done).toBe(true);
  });
});

describe("juice", () => {
  it("particles live and die without allocations past capacity", () => {
    const p = new Particles(10);
    p.emit(0, 0, { count: 25, speed: [10, 20], life: [0.1, 0.1], size: [2, 2], colors: ["#fff"] });
    expect(p.count).toBe(10);
    p.update(0.05);
    expect(p.count).toBe(10);
    p.update(0.06);
    expect(p.count).toBe(0);
  });

  it("popups expire", () => {
    const p = new Popups();
    p.add("+1", 0, 0, "#fff", 12, 0.5);
    p.update(0.6);
    expect(p.items).toHaveLength(0);
  });

  it("shake decays and is muted by reduced motion", () => {
    const s = new Shake(10, 0.1, 2);
    s.add(1);
    s.update(0.01);
    expect(Math.abs(s.offset.x) + Math.abs(s.offset.y)).toBeGreaterThan(0);
    s.update(1);
    expect(s.offset).toEqual({ x: 0, y: 0, angle: 0 });
    const r = new Shake(10, 0.1, 2, true);
    r.add(1);
    r.update(0.013);
    s.add(1);
    s.update(0.013);
    expect(Math.abs(r.offset.x)).toBeLessThan(Math.abs(s.offset.x) + 1e-9);
  });

  it("hit-stop freezes time then hands back the remainder", () => {
    const h = new HitStop();
    h.freeze(0.05);
    expect(h.scale(0.03)).toBe(0);
    expect(h.active).toBe(true);
    expect(h.scale(0.03)).toBeCloseTo(0.01);
    expect(h.scale(0.016)).toBe(0.016);
  });

  it("the counter rolls toward its target", () => {
    const c = new Counter(0, 20);
    c.set(100);
    c.update(0.05);
    expect(c.shown).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) c.update(0.05);
    expect(c.shown).toBe(100);
  });
});

describe("colors and layout", () => {
  it("mixes and shades hex colors", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(shade("#ff0000", -1)).toBe("#000000");
    expect(rgba("#FF6A1A", 0.5)).toBe("rgba(255,106,26,0.5)");
    expect(hsl(0, 1, 0.5)).toBe("#ff0000");
  });

  it("safeRect keeps clear of the feed overlay", () => {
    expect(safeRect({ top: 91, right: 72, bottom: 148, left: 0 }, 390, 754, 16)).toEqual({ x: 16, y: 107, w: 286, h: 483 });
  });
});

describe("input recognizers", () => {
  it("a tap fires on release; a swipe or a cancelled gesture never does", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const tap = vi.fn();
    const off = onTap(el, tap);
    el.dispatchEvent(P("pointerdown", 10, 10));
    expect(tap).not.toHaveBeenCalled();
    window.dispatchEvent(P("pointerup", 12, 11));
    expect(tap).toHaveBeenCalledWith(12, 11);
    el.dispatchEvent(P("pointerdown", 10, 10));
    window.dispatchEvent(P("pointerup", 10, 80));
    el.dispatchEvent(P("pointerdown", 10, 10));
    window.dispatchEvent(P("pointercancel", 10, 10));
    window.dispatchEvent(P("pointerup", 10, 10));
    expect(tap).toHaveBeenCalledTimes(1);
    off();
  });

  it("swipes fire once per gesture as soon as they pass the threshold", () => {
    const el = document.createElement("div");
    const dirs: Dir[] = [];
    onSwipe(el, (d) => dirs.push(d), { threshold: 20 });
    el.dispatchEvent(P("pointerdown", 100, 100));
    window.dispatchEvent(P("pointermove", 100, 90));
    window.dispatchEvent(P("pointermove", 100, 70));
    window.dispatchEvent(P("pointermove", 100, 40));
    window.dispatchEvent(P("pointerup", 100, 40));
    el.dispatchEvent(P("pointerdown", 100, 100));
    window.dispatchEvent(P("pointermove", 140, 105));
    window.dispatchEvent(P("pointerup", 140, 105));
    expect(dirs).toEqual(["up", "right"]);
  });

  it("drags report deltas and a cancel", () => {
    const el = document.createElement("div");
    const ends: boolean[] = [];
    const moves: number[] = [];
    onDrag(el, { move: (_x, _y, dx) => moves.push(dx), end: (_x, _y, cancelled) => ends.push(cancelled) });
    el.dispatchEvent(P("pointerdown", 0, 0));
    window.dispatchEvent(P("pointermove", 15, 0));
    window.dispatchEvent(P("pointercancel", 15, 0));
    expect(moves).toEqual([15]);
    expect(ends).toEqual([true]);
  });

  it("tap vs hold", async () => {
    vi.useFakeTimers();
    const el = document.createElement("div");
    const tap = vi.fn();
    const hold = vi.fn();
    onTapOrHold(el, { tap, hold }, { holdMs: 300 });
    el.dispatchEvent(P("pointerdown", 5, 5));
    vi.advanceTimersByTime(350);
    window.dispatchEvent(P("pointerup", 5, 5));
    el.dispatchEvent(P("pointerdown", 5, 5));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(P("pointerup", 5, 5));
    expect(hold).toHaveBeenCalledTimes(1);
    expect(tap).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
