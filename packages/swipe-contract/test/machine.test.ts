import { describe, expect, it } from "vitest";
import { createCardState, run, shouldRun, transition, type CardState, type ContractEvent, type Effect } from "../src/index.ts";

const sends = (effects: Effect[]) =>
  effects.filter((e) => e.type === "send").map((e) => (e.type === "send" && e.message === "pause" ? `pause:${e.reason}` : e.type === "send" ? e.message : ""));
const violations = (effects: Effect[]) => effects.filter((e) => e.type === "violation").map((e) => (e.type === "violation" ? e.code : ""));

const activeReady = (): CardState => run([{ type: "ACTIVATE" }, { type: "READY" }]).state;
const playing = (): CardState => run([{ type: "GAMEPLAY_START", trigger: "tap" }], activeReady()).state;
const ended = (): CardState => run([{ type: "GAMEPLAY_END", score: 10 }], playing()).state;

describe("lifecycle", () => {
  it("starts offscreen and loads when activated", () => {
    const s0 = createCardState();
    expect(s0.phase).toBe("OFFSCREEN");
    const { state, effects } = transition(s0, { type: "ACTIVATE" });
    expect(state.phase).toBe("LOADING");
    expect(effects).toEqual([]);
  });

  it("LOADING -> PREVIEW on ready, without sending anything (game runs by default)", () => {
    const { state, effects } = run([{ type: "ACTIVATE" }, { type: "READY" }]);
    expect(state.phase).toBe("PREVIEW");
    expect(state.gameRunning).toBe(true);
    expect(sends(effects)).toEqual([]);
  });

  it("a preloaded card that becomes ready offscreen is paused, then resumed into PREVIEW on activate", () => {
    const pre = run([{ type: "READY" }]);
    expect(pre.state.phase).toBe("OFFSCREEN");
    expect(pre.state.resumeTo).toBe("PREVIEW");
    expect(sends(pre.effects)).toEqual(["pause:offscreen"]);
    const act = transition(pre.state, { type: "ACTIVATE" });
    expect(act.state.phase).toBe("PREVIEW");
    expect(sends(act.effects)).toEqual(["resume"]);
  });

  it("PREVIEW -> PLAYING -> ENDED -> PLAYING (replay)", () => {
    let r = transition(activeReady(), { type: "GAMEPLAY_START", trigger: "tap" });
    expect(r.state.phase).toBe("PLAYING");
    expect(r.effects).toContainEqual({ type: "track", event: "play_start" });
    r = transition(r.state, { type: "GAMEPLAY_END", score: 412 });
    expect(r.state.phase).toBe("ENDED");
    expect(r.state.lastScore).toBe(412);
    expect(r.effects).toContainEqual({ type: "track", event: "play_end", score: 412 });
    r = transition(r.state, { type: "REPLAY" });
    expect(r.state.replayRequested).toBe(true);
    expect(sends(r.effects)).toEqual(["replay"]);
    r = transition(r.state, { type: "GAMEPLAY_START", trigger: "tap" });
    expect(r.state.phase).toBe("PLAYING");
    expect(r.state.replayRequested).toBe(false);
    expect(r.state.runs).toBe(2);
  });

  it("ENDED -> PLAYING directly when the game restarts on its own tap", () => {
    const r = transition(ended(), { type: "GAMEPLAY_START", trigger: "tap" });
    expect(r.state.phase).toBe("PLAYING");
  });
});

describe("leaving and returning", () => {
  it("deactivating a PLAYING card pauses it and it returns PAUSED", () => {
    const off = transition(playing(), { type: "DEACTIVATE" });
    expect(off.state.phase).toBe("OFFSCREEN");
    expect(off.state.resumeTo).toBe("PAUSED");
    expect(sends(off.effects)).toEqual(["pause:offscreen"]);
    const back = transition(off.state, { type: "ACTIVATE" });
    expect(back.state.phase).toBe("PAUSED");
    expect(sends(back.effects)).toEqual([]);
    const resumed = transition(back.state, { type: "RESUME_PLAY" });
    expect(resumed.state.phase).toBe("PLAYING");
    expect(sends(resumed.effects)).toEqual(["resume"]);
  });

  it.each([
    ["PREVIEW", activeReady, "PREVIEW"],
    ["ENDED", ended, "ENDED"],
  ] as const)("a %s card returns to %s and resumes", (_n, make, expected) => {
    const off = transition(make(), { type: "DEACTIVATE" });
    expect(sends(off.effects)).toEqual(["pause:offscreen"]);
    const back = transition(off.state, { type: "ACTIVATE" });
    expect(back.state.phase).toBe(expected);
    expect(sends(back.effects)).toEqual(["resume"]);
  });

  it("a card that was still loading returns to LOADING", () => {
    const s = run([{ type: "ACTIVATE" }, { type: "DEACTIVATE" }, { type: "ACTIVATE" }]).state;
    expect(s.phase).toBe("LOADING");
  });

  it("game over while offscreen (late message) lands in ENDED on return", () => {
    const off = transition(playing(), { type: "DEACTIVATE" }).state;
    const r = transition(off, { type: "GAMEPLAY_END", score: 5 });
    expect(r.state.resumeTo).toBe("ENDED");
    expect(transition(r.state, { type: "ACTIVATE" }).state.phase).toBe("ENDED");
  });
});

describe("suspension and pause", () => {
  it("backgrounding during PLAYING pauses the run; foregrounding keeps it paused until Resume", () => {
    let r = transition(playing(), { type: "SUSPEND", reason: "background" });
    expect(r.state.phase).toBe("PAUSED");
    expect(sends(r.effects)).toEqual(["pause:background"]);
    r = transition(r.state, { type: "UNSUSPEND", reason: "background" });
    expect(r.state.phase).toBe("PAUSED");
    expect(sends(r.effects)).toEqual([]);
    r = transition(r.state, { type: "RESUME_PLAY" });
    expect(r.state.phase).toBe("PLAYING");
    expect(sends(r.effects)).toEqual(["resume"]);
  });

  it("a sheet over PREVIEW pauses and resumes the attract loop without changing phase", () => {
    let r = transition(activeReady(), { type: "SUSPEND", reason: "sheet" });
    expect(r.state.phase).toBe("PREVIEW");
    expect(sends(r.effects)).toEqual(["pause:sheet"]);
    r = transition(r.state, { type: "UNSUSPEND", reason: "sheet" });
    expect(sends(r.effects)).toEqual(["resume"]);
  });

  it("overlapping suspensions resume only when all clear", () => {
    let s = run([{ type: "SUSPEND", reason: "sheet" }, { type: "SUSPEND", reason: "background" }], activeReady()).state;
    let r = transition(s, { type: "UNSUSPEND", reason: "background" });
    expect(sends(r.effects)).toEqual([]);
    s = r.state;
    r = transition(s, { type: "UNSUSPEND", reason: "sheet" });
    expect(sends(r.effects)).toEqual(["resume"]);
  });

  it.each(["idle", "back", "user"] as const)("PAUSE(%s) only applies while PLAYING", (reason) => {
    const r = transition(playing(), { type: "PAUSE", reason });
    expect(r.state.phase).toBe("PAUSED");
    expect(sends(r.effects)).toEqual([`pause:${reason}`]);
    expect(transition(activeReady(), { type: "PAUSE", reason }).state.phase).toBe("PREVIEW");
  });

  it("RESUME_PLAY is ignored while suspended", () => {
    const s = run([{ type: "SUSPEND", reason: "sheet" }], playing()).state;
    expect(transition(s, { type: "RESUME_PLAY" }).state.phase).toBe("PAUSED");
  });
});

describe("feed gestures", () => {
  it("claiming cancels input and pauses; springing back resumes", () => {
    let r = transition(playing(), { type: "FEED_GESTURE_BEGIN" });
    expect(sends(r.effects)).toEqual(["input.cancel", "pause:feedGesture"]);
    expect(r.state.phase).toBe("PLAYING");
    r = transition(r.state, { type: "FEED_GESTURE_END", committed: false });
    expect(sends(r.effects)).toEqual(["resume"]);
  });

  it("committing does not resume for a frame before deactivation", () => {
    let r = transition(activeReady(), { type: "FEED_GESTURE_BEGIN" });
    r = transition(r.state, { type: "FEED_GESTURE_END", committed: true });
    expect(sends(r.effects)).toEqual([]);
    r = transition(r.state, { type: "DEACTIVATE" });
    expect(sends(r.effects)).toEqual([]);
    expect(r.state.gameRunning).toBe(false);
    expect(r.state.feedGesture).toBe(false);
  });

  it("a gesture on a loading card sends nothing to the game", () => {
    const r = run([{ type: "ACTIVATE" }, { type: "FEED_GESTURE_BEGIN" }]);
    expect(sends(r.effects)).toEqual([]);
  });

  it("an offscreen card ignores feed gestures", () => {
    const r = transition(createCardState(), { type: "FEED_GESTURE_BEGIN" });
    expect(r.state.feedGesture).toBe(false);
  });
});

describe("loading failures", () => {
  it("LOADING -> FAILED -> LOADING on retry, with reload", () => {
    let r = run([{ type: "ACTIVATE" }, { type: "LOAD_FAILED" }]);
    expect(r.state.phase).toBe("FAILED");
    expect(r.effects).toContainEqual({ type: "track", event: "load_failed" });
    r = transition(r.state, { type: "RETRY" });
    expect(r.state.phase).toBe("LOADING");
    expect(r.effects).toContainEqual({ type: "reload" });
    r = transition(r.state, { type: "READY" });
    expect(r.state.phase).toBe("PREVIEW");
  });

  it("a preloading card that fails comes back FAILED", () => {
    const s = run([{ type: "LOAD_FAILED" }, { type: "ACTIVATE" }]).state;
    expect(s.phase).toBe("FAILED");
  });

  it("LOAD_FAILED after ready is ignored", () => {
    expect(transition(activeReady(), { type: "LOAD_FAILED" }).state.phase).toBe("PREVIEW");
  });
});

describe("violations", () => {
  it("flags a run started by a swipe (but still starts it)", () => {
    const r = transition(activeReady(), { type: "GAMEPLAY_START", trigger: "swipe" });
    expect(violations(r.effects)).toEqual(["start_by_swipe"]);
    expect(r.state.phase).toBe("PLAYING");
  });
  it("flags start before ready", () => {
    const r = run([{ type: "ACTIVATE" }, { type: "GAMEPLAY_START" }]);
    expect(violations(r.effects)).toEqual(["start_without_ready"]);
    expect(r.state.phase).toBe("LOADING");
  });
  it("flags start while paused", () => {
    const s = run([{ type: "PAUSE", reason: "idle" }], playing()).state;
    expect(violations(transition(s, { type: "GAMEPLAY_START" }).effects)).toEqual(["start_while_paused"]);
    const sheet = run([{ type: "SUSPEND", reason: "sheet" }], activeReady()).state;
    expect(violations(transition(sheet, { type: "GAMEPLAY_START" }).effects)).toEqual(["start_while_paused"]);
  });
  it("flags end without start", () => {
    expect(violations(transition(activeReady(), { type: "GAMEPLAY_END", score: 1 }).effects)).toEqual(["end_without_start"]);
  });
});

describe("invariants", () => {
  const events: ContractEvent[] = [
    { type: "ACTIVATE" },
    { type: "DEACTIVATE" },
    { type: "READY" },
    { type: "LOAD_FAILED" },
    { type: "RETRY" },
    { type: "GAMEPLAY_START", trigger: "tap" },
    { type: "GAMEPLAY_END", score: 3 },
    { type: "SUSPEND", reason: "background" },
    { type: "UNSUSPEND", reason: "background" },
    { type: "SUSPEND", reason: "sheet" },
    { type: "UNSUSPEND", reason: "sheet" },
    { type: "PAUSE", reason: "idle" },
    { type: "RESUME_PLAY" },
    { type: "REPLAY" },
    { type: "FEED_GESTURE_BEGIN" },
    { type: "FEED_GESTURE_END", committed: false },
  ];

  it("never sends two pauses or two resumes in a row, and gameRunning always matches shouldRun (fuzz)", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 300; trial++) {
      let state = createCardState();
      let last: string | null = null;
      for (let i = 0; i < 60; i++) {
        const e = events[Math.floor(rand() * events.length)]!;
        const r = transition(state, e);
        // A reload starts a fresh game instance that runs by default.
        if (r.effects.some((x) => x.type === "reload")) last = null;
        for (const msg of sends(r.effects)) {
          const kind = msg.startsWith("pause") ? "pause" : msg === "resume" ? "resume" : null;
          if (kind) {
            expect(kind).not.toBe(last);
            last = kind;
          }
        }
        state = r.state;
        if (state.ready && state.gameRunning !== null) expect(state.gameRunning).toBe(shouldRun(state));
        if (!state.active) expect(state.phase).toBe("OFFSCREEN");
        if (state.phase === "OFFSCREEN") expect(state.active).toBe(false);
      }
    }
  });
});
