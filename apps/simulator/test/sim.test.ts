import { validateManifest, type Manifest } from "@thumbcade/protocol";
import type { ProbeInputEvent } from "@thumbcade/sdk/probe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_INDEX, Simulator } from "../src/lib/sim.ts";
import type { LoadedGame } from "../src/lib/source.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function manifest(vertical: boolean): Manifest {
  const v = validateManifest({
    id: "test-game",
    name: "Test Game",
    version: "1.0.0",
    sdk: "^1.0.0",
    description: "A test.",
    tags: ["test"],
    accentColor: "#FF6A1A",
    icon: "assets/icon.png",
    controls: { vertical, inputs: [vertical ? "swipe" : "tap"] },
    score: { max: 1000 },
  });
  if (!v.ok) throw new Error(v.issues.join());
  return v.manifest;
}

function setup(opts: { vertical?: boolean } = {}) {
  let input: ((e: ProbeInputEvent) => void) | null = null;
  const probeState = { framesAfterPause: 0, audible: false };
  const probe = {
    onInput(cb: (e: ProbeInputEvent) => void) {
      input = cb;
      return () => (input = null);
    },
    snapshot: () => ({ now: 1000, frames: 10, fps: 60, longTasks: [], heapBytes: 8e6, audio: { contexts: 1, runningContexts: 1, activeSources: 0, mediaPlaying: 0, audible: probeState.audible }, errors: [], foreignRequests: [], insetsRead: true }),
    callbacksSince: () => probeState.framesAfterPause,
    longTasksSince: () => [],
    audio: () => ({ contexts: 1, runningContexts: probeState.audible ? 1 : 0, activeSources: probeState.audible ? 2 : 0, mediaPlaying: 0, audible: probeState.audible }),
  };
  const gameWin = { postMessage: vi.fn(), document: {}, __tcProbe: probe };
  const listeners = new Map<string, () => void>();
  const iframe = {
    contentWindow: gameWin,
    src: "",
    ownerDocument: { defaultView: window },
    addEventListener: (t: string, l: () => void) => listeners.set(t, l),
    removeEventListener: (t: string) => listeners.delete(t),
  } as unknown as HTMLIFrameElement;
  const screen = document.createElement("div");
  screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844, x: 0, y: 0, toJSON: () => ({}) });
  const track = document.createElement("div");
  const game: LoadedGame = {
    source: { slug: "test-game", name: "Test Game", entryUrl: `${location.origin}/__games/test-game/index.html`, manifestUrl: `${location.origin}/__games/test-game/thumbcade.json`, posterUrl: null, iconUrl: null },
    manifest: manifest(!!opts.vertical),
    manifestIssues: [],
    sameOrigin: true,
  };
  localStorage.clear();
  const sim = new Simulator(game);
  sim.mount({ iframe, screen, track });
  let n = 0;
  const fromGame = (type: string, payload?: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { data: { ch: "tc", v: 1, id: `g${++n}`, type, payload }, origin: location.origin, source: gameWin as unknown as Window }));
  const sent = () => gameWin.postMessage.mock.calls.map((c) => c[0] as { type: string; payload?: { reason?: string; current?: string }; replyTo?: string });
  const touch = (kind: ProbeInputEvent["kind"], y: number, x = 200) =>
    input?.({ kind, pointerId: 1, pointerType: "touch", isPrimary: true, x, y, dx: 0, dy: 0, altKey: false, shiftKey: false, synthetic: false });
  return { sim, fromGame, sent, touch, probeState, iframe };
}

let current: Simulator | null = null;
afterEach(() => current?.unmount());

async function ready(s: ReturnType<typeof setup>) {
  current = s.sim;
  s.fromGame("hello", { sdkVersion: "1.0.0" });
  await sleep(0);
  s.fromGame("ready", {});
  await sleep(0);
}

describe("Simulator", () => {
  it("answers hello with a dev LaunchContext and enters PREVIEW on ready", async () => {
    const s = setup();
    await ready(s);
    const reply = s.sent().find((m) => m.type === "reply");
    expect(reply?.payload).toMatchObject({ ok: true, result: { launchReason: "dev", host: "simulator", insets: { current: "preview" } } });
    expect(s.sim.getSnapshot().card.phase).toBe("PREVIEW");
    expect(s.sim.getSnapshot().connected).toBe(true);
  });

  it("claims a vertical pan on the surface retroactively: input.cancel + pause, then commits to the next card", async () => {
    const s = setup();
    await ready(s);
    s.touch("down", 600);
    s.touch("move", 595); // under the 10 pt threshold: still the game's
    expect(s.sent().some((m) => m.type === "input.cancel")).toBe(false);
    s.touch("move", 570);
    const types = s.sent().map((m) => m.type);
    expect(types).toContain("input.cancel");
    expect(s.sent().find((m) => m.type === "pause")?.payload).toEqual({ reason: "feedGesture" });
    expect(s.sim.getSnapshot().gestureOwner).toBe("feed");
    s.touch("move", 300);
    s.touch("up", 250);
    expect(s.sim.getSnapshot().index).toBe(DEV_INDEX + 1);
    expect(s.sim.getSnapshot().card.phase).toBe("OFFSCREEN");
  });

  it("springs back and resumes the game when the drag is too short", async () => {
    const s = setup();
    await ready(s);
    s.touch("down", 600);
    await sleep(120);
    s.touch("move", 580);
    await sleep(120);
    s.touch("up", 575);
    expect(s.sim.getSnapshot().index).toBe(DEV_INDEX);
    expect(s.sent().map((m) => m.type)).toContain("resume");
    expect(s.sim.getSnapshot().card.phase).toBe("PREVIEW");
  });

  it("lets a vertical:true game own the surface while PLAYING; the Dock still drives the feed", async () => {
    const s = setup({ vertical: true });
    await ready(s);
    s.fromGame("gameplay.start", { trigger: "tap" });
    expect(s.sim.getSnapshot().card.phase).toBe("PLAYING");
    expect(s.sent().find((m) => m.type === "insets")?.payload?.current).toBe("play");
    s.touch("down", 600);
    s.touch("move", 400);
    s.touch("up", 300);
    expect(s.sent().some((m) => m.type === "input.cancel")).toBe(false);
    expect(s.sim.getSnapshot().index).toBe(DEV_INDEX);
    // A pan that starts on the Dock (parent document) claims at 6 pt.
    s.sim.onChromePointerDown({ button: 0, pointerId: 7, clientX: 195, clientY: 800, altKey: false, currentTarget: null }, "dock");
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 195, clientY: 790 }));
    expect(s.sent().some((m) => m.type === "input.cancel")).toBe(true);
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 195, clientY: 500 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, clientX: 195, clientY: 450 }));
    expect(s.sim.getSnapshot().index).toBe(DEV_INDEX + 1);
  });

  it("flags a run started by a swipe", async () => {
    const s = setup();
    await ready(s);
    s.fromGame("gameplay.start", { trigger: "swipe" });
    expect(s.sim.getSnapshot().violations.map((v) => v.code)).toContain("start_by_swipe");
  });

  it("checks that the loop and audio stop after pause", async () => {
    const s = setup();
    await ready(s);
    s.fromGame("gameplay.start", { trigger: "tap" });
    s.probeState.framesAfterPause = 40;
    s.probeState.audible = true;
    s.sim.simulate("back");
    expect(s.sim.getSnapshot().card.phase).toBe("PAUSED");
    await sleep(1000);
    const codes = s.sim.getSnapshot().violations.map((v) => v.code);
    expect(codes).toContain("loop_after_pause");
    expect(codes).toContain("audio_after_pause");
  });

  it("shows the result card data on gameplay.end and replays", async () => {
    const s = setup();
    await ready(s);
    s.fromGame("gameplay.start", { trigger: "tap" });
    s.fromGame("gameplay.end", { score: 42 });
    const snap = s.sim.getSnapshot();
    expect(snap.card.phase).toBe("ENDED");
    expect(snap.result).toMatchObject({ score: 42, best: 42, isNewBest: true });
    s.sim.replay();
    expect(s.sent().at(-1)?.type).toBe("replay");
  });

  it("pauses for a sheet and resumes when it closes", async () => {
    const s = setup();
    await ready(s);
    s.sim.openSheet("comments");
    expect(s.sent().find((m) => m.type === "pause")?.payload).toEqual({ reason: "sheet" });
    s.sim.closeSheet();
    expect(s.sent().at(-1)?.type).toBe("resume");
  });
});
