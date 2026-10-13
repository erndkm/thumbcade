import { describe, expect, it, vi } from "vitest";
import { createThumbcade } from "../src/sdk.ts";
import { makeWindow, rnDeliver } from "./helpers.ts";

function setup() {
  const win = makeWindow({ rn: true });
  const tc = createThumbcade(win);
  const canvas = win.document.createElement("canvas");
  win.document.body.appendChild(canvas);
  const seen: string[] = [];
  for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel", "mouseup", "click"]) {
    canvas.addEventListener(t, (e) => seen.push(`${t}${(e as PointerEvent).isTrusted === false ? "*" : ""}`));
  }
  return { win, tc, canvas, seen };
}

const P = (win: Window & typeof globalThis, type: string, id: number, x: number, y: number) =>
  new win.PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true });

describe("input.cancel", () => {
  it("dispatches a synthetic pointercancel to the active target and swallows the rest of the gesture", () => {
    const { win, tc, canvas, seen } = setup();
    const onCancel = vi.fn();
    tc.on("inputCancel", onCancel);
    canvas.dispatchEvent(P(win, "pointerdown", 7, 100, 400));
    canvas.dispatchEvent(P(win, "pointermove", 7, 100, 390));
    rnDeliver(win, "input.cancel");
    // The feed keeps dragging: these must never reach the game.
    canvas.dispatchEvent(P(win, "pointermove", 7, 100, 300));
    canvas.dispatchEvent(P(win, "pointerup", 7, 100, 200));
    canvas.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
    canvas.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(seen.filter((s) => s.startsWith("pointer"))).toEqual(["pointerdown", "pointermove", "pointercancel"]);
    expect(seen).not.toContain("click");
    expect(seen).not.toContain("mouseup");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("carries the pointer's id, type and last position", () => {
    const { win, canvas } = setup();
    const cancel = vi.fn();
    canvas.addEventListener("pointercancel", cancel);
    canvas.dispatchEvent(P(win, "pointerdown", 3, 50, 60));
    canvas.dispatchEvent(P(win, "pointermove", 3, 55, 70));
    rnDeliver(win, "input.cancel");
    const ev = cancel.mock.calls[0]![0] as PointerEvent;
    expect(ev.pointerId).toBe(3);
    expect(ev.pointerType).toBe("touch");
    expect(ev.clientX).toBe(55);
    expect(ev.clientY).toBe(70);
  });

  it("targets the element holding pointer capture", () => {
    const { win, canvas } = setup();
    const knob = win.document.createElement("div");
    win.document.body.appendChild(knob);
    const onKnob = vi.fn();
    knob.addEventListener("pointercancel", onKnob);
    canvas.dispatchEvent(P(win, "pointerdown", 4, 10, 10));
    knob.dispatchEvent(new win.PointerEvent("gotpointercapture", { pointerId: 4, bubbles: true }));
    rnDeliver(win, "input.cancel");
    expect(onKnob).toHaveBeenCalledTimes(1);
  });

  it("dispatches touchcancel with the active touches", () => {
    const { win, canvas, seen } = setup();
    const onTouchCancel = vi.fn();
    canvas.addEventListener("touchcancel", onTouchCancel);
    const touch = new win.Touch({ identifier: 11, target: canvas, clientX: 20, clientY: 30 });
    canvas.dispatchEvent(new win.TouchEvent("touchstart", { changedTouches: [touch], touches: [touch], bubbles: true }));
    rnDeliver(win, "input.cancel");
    expect(onTouchCancel).toHaveBeenCalledTimes(1);
    const ev = onTouchCancel.mock.calls[0]![0] as TouchEvent;
    expect(ev.changedTouches.length).toBe(1);
    expect(ev.changedTouches[0]!.identifier).toBe(11);
    // Later moves of that gesture are swallowed.
    canvas.dispatchEvent(new win.TouchEvent("touchmove", { changedTouches: [touch], touches: [touch], bubbles: true }));
    expect(seen.filter((s) => s.startsWith("touchmove"))).toHaveLength(0);
  });

  it("lets the next gesture through untouched", () => {
    const { win, canvas, seen } = setup();
    canvas.dispatchEvent(P(win, "pointerdown", 1, 0, 0));
    rnDeliver(win, "input.cancel");
    seen.length = 0;
    canvas.dispatchEvent(P(win, "pointerdown", 1, 5, 5));
    canvas.dispatchEvent(P(win, "pointermove", 1, 6, 6));
    canvas.dispatchEvent(P(win, "pointerup", 1, 6, 6));
    canvas.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual(["pointerdown", "pointermove", "pointerup", "click"]);
  });

  it("emits inputCancel even when nothing was active", () => {
    const { win, tc } = setup();
    const onCancel = vi.fn();
    tc.on("inputCancel", onCancel);
    rnDeliver(win, "input.cancel");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
