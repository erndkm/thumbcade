import { describe, expect, it } from "vitest";
import { RING, RULE, STRUCK } from "../src/marks.ts";
import { multiplier, Run, type RunEvent, TUNE } from "../src/run.ts";
import { loadLists } from "../scripts/lists.ts";

const lists = loadLists();
const ANSWER = "proof";
/** A run whose every slip hides `answer` (a one-word list), with the real dictionary. */
const runOf = (answer = ANSWER, daily: string | null = null) => new Run({ seed: 7, answers: [answer], daily, isWord: lists.isWord });
const type = (r: Run, w: string) => [...w].flatMap((c) => r.press(c));
const line = (r: Run, w: string) => [...type(r, w), ...r.press("write")];
const find = <T extends RunEvent["type"]>(evs: RunEvent[], t: T) => evs.find((e) => e.type === t) as Extract<RunEvent, { type: T }> | undefined;
/** Steps the clock without letting it run out. */
const wait = (r: Run, s: number) => {
  for (let t = 0; t < s; t += 1 / 60) r.step(1 / 60);
};

describe("typing a line", () => {
  it("fills the places in order and erase takes back the last key", () => {
    const r = runOf();
    type(r, "flo");
    expect(r.current.join("")).toBe("flo");
    expect(r.press("erase")).toEqual([{ type: "erase", at: 2 }]);
    expect(r.current).toEqual(["f", "l", null, null, null]);
    expect(r.press("write")[0]).toEqual({ type: "short", have: 2 });
    type(r, "oorx");
    expect(r.press("q")).toEqual([{ type: "full" }]);
  });

  it("an unknown word shakes and costs nothing; the letters stay to fix", () => {
    const r = runOf();
    const clock = r.clock;
    const evs = line(r, "proxf");
    expect(evs.at(-1)).toEqual({ type: "unknown", word: "proxf" });
    expect(r.slip.lines.length).toBe(0);
    expect(r.clock).toBe(clock);
    expect(r.score).toBe(0);
    r.press("erase");
    r.press("erase");
    expect(line(r, "of").some((e) => e.type === "solve")).toBe(true);
  });

  it("waits on the dictionary instead of refusing a word it can't judge yet", () => {
    let ready = false;
    const r = new Run({ seed: 1, answers: [ANSWER], daily: null, isWord: (w) => (ready ? lists.isWord(w) : null) });
    expect(line(r, "floor").at(-1)).toEqual({ type: "checking", word: "floor" });
    ready = true;
    expect(find(r.write(), "line")?.word).toBe("floor");
  });

  it("ringed places set themselves in the next line; typing the whole word or just the gaps both work", () => {
    const r = runOf();
    line(r, "floor");
    expect(r.slip.known).toEqual([null, null, "o", "o", null]);
    // The whole word, ringed letters included: they are confirmed as the caret passes.
    type(r, "spoof");
    expect(r.current.join("")).toBe("spoof");
    r.press("erase");
    r.press("erase");
    r.press("erase");
    expect(r.current.join("")).toBe("spoo");
    expect(r.caret).toBe(2);
    // Just the gaps.
    const s = runOf();
    line(s, "floor");
    type(s, "prf");
    expect(s.current.join("")).toBe("proof");
  });

  it("keys that don't fit round the known places are read as a whole word typed over them", () => {
    const r = runOf("quota");
    line(r, "humid");
    expect(r.slip.known).toEqual([null, "u", null, null, null]);
    // w, i, t, c fill the four open places around the U...
    type(r, "witc");
    expect(r.current.join("")).toBe("wuitc");
    expect(r.view.whole).toBe(false);
    // ...and the fifth key shows the player meant "witch".
    expect(r.press("h")[0]).toMatchObject({ type: "type", whole: true });
    expect(r.current.join("")).toBe("witch");
    expect(r.view.whole).toBe(true);
    expect(r.press("s")).toEqual([{ type: "full" }]);
    expect(find(r.press("write"), "line")?.word).toBe("witch");
    // Erasing back below five keys reads the gaps again.
    type(r, "squat");
    expect(r.current.join("")).toBe("squat");
    r.press("erase");
    expect(r.current.join("")).toBe("suqua");
  });
});

describe("marks and rewards on a line", () => {
  it("pays for places ringed and letters found for the first time on the slip, only once", () => {
    const r = runOf();
    const l1 = find(line(r, "floor"), "line")!;
    expect(l1.marks).toEqual([RULE, STRUCK, RING, RING, RULE]);
    expect(l1.rings).toEqual([2, 3]);
    expect(l1.rules).toEqual([0, 4]);
    expect(l1.points).toBe(2 * TUNE.ringPoints + 2 * TUNE.rulePoints);
    expect(l1.time).toBeCloseTo(2 * TUNE.ringTime + 2 * TUNE.ruleTime);
    // "spoof": the f is ringed now (a new place), the p found (a new letter); the o's pay nothing twice.
    const l2 = find(line(r, "spoof"), "line")!;
    expect(l2.rings).toEqual([4]);
    expect(l2.rules).toEqual([1]);
  });

  it("the keyboard shows each letter's best mark", () => {
    const r = runOf();
    line(r, "floor");
    const k = r.keyBest();
    expect(k.get("o")).toBe(RING);
    expect(k.get("f")).toBe(RULE);
    expect(k.get("l")).toBe(STRUCK);
  });
});

describe("solving and missing", () => {
  it("a solve pays more and gives more time back for fewer lines", () => {
    const fast = runOf();
    const f = find(line(fast, "proof"), "solve")!;
    const slow = runOf();
    for (const w of ["blimp", "dusty", "chalk", "floor"]) line(slow, w);
    const s = find(line(slow, "proof"), "solve")!;
    expect(f.lines).toBe(1);
    expect(s.lines).toBe(5);
    expect(f.points).toBeGreaterThan(s.points);
    expect(f.time).toBeGreaterThan(s.time);
    expect(fast.slip.n).toBe(2);
    expect(fast.slip.lines.length).toBe(0);
  });

  it("each slip filed gives back a little less, never below the floor", () => {
    const r = runOf();
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      times.push(find(line(r, "proof"), "solve")!.time);
      r.clock = 30;
    }
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeLessThanOrEqual(times[i - 1]!);
    expect(times.at(-1)!).toBeCloseTo(TUNE.solveTime[1]! * TUNE.refundFloor, 0);
  });

  it("six lines without the word reveal it and cost time; the streak breaks", () => {
    const r = runOf();
    line(r, "proof");
    line(r, "proof");
    expect(r.streak).toBe(2);
    r.clock = 40;
    for (const w of ["blimp", "dusty", "chalk", "floor", "spoon"]) line(r, w);
    const c0 = r.clock;
    // (The ringed o's set themselves, so the last line must fit them.)
    const evs = line(r, "stool");
    const miss = find(evs, "miss")!;
    expect(miss.answer).toBe("proof");
    expect(r.clock).toBeCloseTo(c0 + find(evs, "line")!.time - TUNE.missTime, 5);
    expect(r.streak).toBe(0);
    expect(r.stats.misses).toBe(1);
    expect(r.slip.n).toBe(4);
  });

  it("clean solves in a row climb ×2 ×3 ×4 ×5 at the named tiers; a slow solve resets it", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(multiplier)).toEqual([1, 2, 3, 3, 4, 4, 5, 5]);
    const r = runOf();
    const ups: number[] = [];
    for (let i = 0; i < 8; i++) {
      const s = find(line(r, "proof"), "solve")!;
      if (s.tierUp) ups.push(s.mult);
      r.clock = 40;
    }
    expect(ups).toEqual([2, 3, 4, 5]);
    for (const w of ["blimp", "dusty", "chalk", "floor"]) line(r, w);
    const slow = find(line(r, "proof"), "solve")!;
    expect(slow.clean).toBe(false);
    expect(slow.mult).toBe(1);
    expect(r.streak).toBe(0);
  });
});

describe("the pencil", () => {
  it("is earned by a quick solve (never sold), held up to two, and writes one right letter in", () => {
    const r = runOf();
    expect(r.press("pencil")).toEqual([{ type: "nopencil" }]);
    for (let i = 0; i < 3; i++) {
      line(r, "proof");
      r.clock = 40;
    }
    expect(r.pencils).toBe(TUNE.pencilsMax);
    type(r, "f");
    const p = find(r.press("pencil"), "pencil")!;
    // The first unknown place that is still empty: place 0 holds the typed f, so it pencils place 1.
    expect(p).toEqual({ type: "pencil", at: 1, letter: "r" });
    expect(r.current).toEqual(["f", "r", null, null, null]);
    expect(r.pencils).toBe(1);
    expect(r.keyBest().get("r")).toBe(RING);
  });

  it("is earned only by a solve in three lines or fewer", () => {
    const r = runOf();
    for (const w of ["blimp", "dusty", "chalk"]) line(r, w);
    line(r, "proof");
    expect(r.pencils).toBe(0);
  });
});

describe("the clock", () => {
  it("starts at the set seconds, burns faster with time and with every slip filed, and stands still while marking", () => {
    const r = runOf();
    expect(r.clock).toBe(TUNE.clock);
    r.press("a");
    wait(r, 10);
    expect(r.clock).toBeGreaterThan(TUNE.clock - 10.5);
    const b0 = r.burn;
    wait(r, 20);
    expect(r.burn).toBeGreaterThan(b0);
    r.press("erase");
    type(r, "floor");
    r.press("write");
    const c = r.clock;
    r.step(TUNE.markPause * 0.9);
    expect(r.clock).toBe(c);
    const before = r.burn;
    r.stats.words = 3;
    expect(r.burn).toBeCloseTo(before * (1 + 3 * TUNE.wordBurn), 5);
  });

  it("an idle run ends on its own inside 35 seconds; a busy one is never lost in the first ten", () => {
    const idle = runOf();
    let t = 0;
    while (idle.live && t < 120) {
      idle.step(1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(18);
    expect(t).toBeLessThan(35);
    const busy = runOf();
    busy.press("a");
    wait(busy, 10);
    expect(busy.live).toBe(true);
    expect(busy.clock).toBeGreaterThan(30);
  });

  it("a full line waiting when the clock runs out is written at the bell, and a solve there keeps the run going", () => {
    const r = runOf();
    type(r, "proof");
    r.clock = 0.01;
    const evs = r.step(1 / 30);
    expect(find(evs, "line")?.bell).toBe(true);
    expect(find(evs, "solve")).toBeDefined();
    expect(r.live).toBe(true);
    const s = runOf();
    type(s, "floor");
    s.clock = 0.01;
    const e2 = s.step(1 / 30);
    // Not solved, but its new rings bought half a second each.
    expect(find(e2, "line")?.bell).toBe(true);
    expect(s.live).toBe(true);
    for (let i = 0; i < 300 && s.live; i++) s.step(1 / 30);
    expect(s.live).toBe(false);
    expect(s.stats.bellSolves).toBe(0);
  });
});

describe("today's word and determinism", () => {
  it("the first slip is today's word when given, marked as daily, and recorded", () => {
    const r = new Run({ seed: 3, answers: lists.answers, daily: "proof", isWord: lists.isWord });
    expect(r.slip.daily).toBe(true);
    expect(r.slip.answer).toBe("proof");
    line(r, "floor");
    const s = find(line(r, "proof"), "solve")!;
    expect(s.daily).toBe(true);
    expect(s.points).toBe(TUNE.solvePoints[2]! + TUNE.dailyPoints);
    expect(r.stats.dailyLines).toBe(2);
    expect(r.stats.dailyMarks).toEqual([
      [RULE, STRUCK, RING, RING, RULE],
      [RING, RING, RING, RING, RING],
    ]);
    // Today's word never comes back later in the run.
    for (let i = 0; i < 40; i++) {
      expect(r.slip.answer).not.toBe("proof");
      expect(r.slip.daily).toBe(false);
      r.slip.lines.length = 0;
      line(r, r.slip.answer);
      r.clock = 40;
    }
  });

  it("the same seed hides the same words in the same order", () => {
    const words = (seed: number) => {
      const r = new Run({ seed, answers: lists.answers, daily: null, isWord: lists.isWord });
      const out: string[] = [];
      for (let i = 0; i < 10; i++) {
        out.push(r.slip.answer);
        line(r, r.slip.answer);
        r.clock = 40;
      }
      return out;
    };
    expect(words(42)).toEqual(words(42));
    expect(words(42)).not.toEqual(words(43));
    expect(new Set(words(42)).size).toBe(10);
  });
});
