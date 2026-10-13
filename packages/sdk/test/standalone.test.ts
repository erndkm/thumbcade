import { describe, expect, it, vi } from "vitest";
import { createThumbcade } from "../src/sdk.ts";
import { makeWindow, tick } from "./helpers.ts";

function hudButton(win: Window, action: string): HTMLElement {
  const hud = win.document.getElementById("tc-dev-hud")!;
  return hud.shadowRoot!.querySelector(`[data-a=${action}]`) as HTMLElement;
}

describe("standalone mock host", () => {
  it("persists storage in localStorage and tracks the best score", async () => {
    const win = makeWindow();
    const tc = createThumbcade(win);
    await tc.init({ manifestId: "merge" });
    await tc.storage.set("settings", { haptics: false });
    await expect(tc.storage.get("settings")).resolves.toEqual({ haptics: false });
    expect(win.localStorage.getItem("tc:merge:settings")).toBe('{"haptics":false}');
    await expect(tc.leaderboard.top()).resolves.toEqual([]);
    tc.gameplay.start();
    tc.gameplay.end({ score: 512 });
    await expect(tc.leaderboard.me()).resolves.toEqual({ best: 512, rank: 1, percentile: null });
    tc.gameplay.end({ score: 100 });
    await expect(tc.leaderboard.top()).resolves.toEqual([{ rank: 1, name: "You", avatarUrl: null, score: 512, isMe: true }]);
    await expect(tc.share.challenge({ score: 1 })).resolves.toEqual({ shared: false });
  });

  it("switches insets to play during a run and back after", async () => {
    const win = makeWindow();
    const tc = createThumbcade(win);
    await tc.init();
    const onInsets = vi.fn();
    tc.on("insets", onInsets);
    tc.gameplay.start();
    await tick();
    expect(onInsets.mock.calls.at(-1)![0].current).toBe("play");
    tc.gameplay.end({ score: 1 });
    await tick();
    expect(onInsets.mock.calls.at(-1)![0].current).toBe("preview");
  });

  it("the HUD pauses, mutes and replays without the game seeing the taps", async () => {
    const win = makeWindow();
    const tc = createThumbcade(win);
    await tc.init();
    const gameTaps = vi.fn();
    win.addEventListener("pointerdown", gameTaps);
    win.addEventListener("pointerup", gameTaps);
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onMute = vi.fn();
    const onReplay = vi.fn();
    tc.on("pause", onPause);
    tc.on("resume", onResume);
    tc.on("mute", onMute);
    tc.on("replay", onReplay);
    const tap = (el: HTMLElement) => {
      el.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true, composed: true }));
      el.dispatchEvent(new win.PointerEvent("pointerup", { bubbles: true, composed: true }));
    };
    tap(hudButton(win, "pause"));
    await tick();
    expect(onPause).toHaveBeenCalledWith({ reason: "user" });
    expect(tc.paused).toBe(true);
    tap(hudButton(win, "pause"));
    await tick();
    expect(onResume).toHaveBeenCalledTimes(1);
    tap(hudButton(win, "mute"));
    await tick();
    expect(onMute).toHaveBeenCalledTimes(1);
    tc.gameplay.start();
    tc.gameplay.end({ score: 3 });
    tap(hudButton(win, "replay"));
    await tick();
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(gameTaps).not.toHaveBeenCalled();
  });

  it("pauses when the tab is hidden", async () => {
    const win = makeWindow();
    const tc = createThumbcade(win);
    await tc.init();
    const onPause = vi.fn();
    tc.on("pause", onPause);
    Object.defineProperty(win.document, "hidden", { value: true, configurable: true });
    win.document.dispatchEvent(new win.Event("visibilitychange"));
    await tick();
    expect(onPause).toHaveBeenCalledWith({ reason: "background" });
  });
});
