import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { bedFor, bedKey, cueFor } from "../src/cues.ts";
import { Pilot, SKILLS } from "../src/pilot.ts";
import { HURRY, S, WALK } from "../src/sfx.ts";
import { HERO, INK_LOW, Sim, type SimEvent } from "../src/sim.ts";

/** One of every thing that can happen in a run. */
const EVENTS: SimEvent[] = [
  { k: "turn", late: false },
  { k: "turn", late: true },
  { k: "bonk", dir: 1 },
  { k: "out", id: HERO, cell: 5 },
  { k: "out", id: 2, cell: 5 },
  { k: "print", id: HERO, squares: 6, cells: [1], from: 1, stolen: 0, pts: 6, tier: 1, ink: 0.5, share: 0.1 },
  { k: "print", id: HERO, squares: 14, cells: [1], from: 1, stolen: 0, pts: 28, tier: 2, ink: 1, share: 0.1 },
  { k: "print", id: HERO, squares: 60, cells: [1], from: 1, stolen: 0, pts: 240, tier: 4, ink: 5, share: 0.3 },
  { k: "print", id: 2, squares: 6, cells: [1], from: 1, stolen: 0, pts: 0, tier: 1, ink: 0, share: 0.1 },
  { k: "shave", pts: 30, cell: 9 },
  { k: "smudge", id: 2, by: HERO, cell: 9, line: [9], land: [1], pts: 100 },
  { k: "smudged", by: 2, cell: 9, line: [9], home: 3 },
  { k: "smudged", by: 0, cell: 9, line: [9], home: 3 },
  { k: "crawl", id: 2, cell: 40 },
  { k: "low" },
  { k: "tick", left: 3 },
  { k: "sheet", sheet: 1, bonus: 150, share: 0.2, clean: true },
  { k: "sheet", sheet: 2, bonus: 300, share: 0.2, clean: false },
  { k: "fresh", sheet: 2 },
  { k: "over", cell: 3 },
];

describe("every action and every reward has its cue", () => {
  it("each thing that can happen is heard, with sounds that exist", () => {
    const kinds = new Set(EVENTS.map((e) => e.k));
    // The list above covers every kind of event the run can emit.
    expect([...kinds].sort()).toEqual(["bonk", "crawl", "fresh", "low", "out", "over", "print", "shave", "sheet", "smudge", "smudged", "tick", "turn"]);
    for (const e of EVENTS) {
      const cue = cueFor(e);
      for (const name of cue.sounds) expect(S[name], `${e.k}: ${name}`).toBeDefined();
      // Only a rival quietly leaving its print is silent.
      if (e.k === "out" && e.id !== HERO) expect(cue.sounds).toHaveLength(0);
      else expect(cue.sounds.length, e.k).toBeGreaterThanOrEqual(1);
    }
  });

  it("the player's actions are heard; rewards and losses are felt too", () => {
    const of = (e: SimEvent) => cueFor(e);
    expect(of(EVENTS[0]!).sounds).toEqual(["step"]);
    expect(of(EVENTS[2]!).sounds).toEqual(["bonk"]);
    expect(of(EVENTS[3]!).sounds).toEqual(["wet"]);
    // A plain print taps; a paying one is a success; the biggest brings the roller in.
    expect(of(EVENTS[5]!)).toMatchObject({ sounds: ["print"], haptic: "tap" });
    expect(of(EVENTS[6]!)).toMatchObject({ sounds: ["print", "pull"], haptic: "success" });
    expect(of(EVENTS[7]!)).toMatchObject({ sounds: ["print", "pull", "roll"], haptic: "success" });
    expect(of(EVENTS[8]!).haptic).toBeUndefined();
    expect(of(EVENTS[9]!).sounds).toEqual(["shave"]);
    expect(of(EVENTS[10]!)).toMatchObject({ sounds: ["smudge", "bell"], haptic: "impact" });
    expect(of(EVENTS[11]!)).toMatchObject({ sounds: ["smudge", "lost"], haptic: "fail" });
    expect(of(EVENTS[12]!)).toMatchObject({ sounds: ["boxed", "lost"], haptic: "fail" });
    expect(of(EVENTS[16]!)).toMatchObject({ sounds: ["sheet", "bell"], haptic: "success" });
    expect(of(EVENTS[17]!)).toMatchObject({ sounds: ["sheet"], haptic: "success" });
    expect(of(EVENTS[19]!).sounds).toEqual(["dry"]);
    // Things that are nobody's doing make no haptic.
    for (const i of [0, 2, 3, 13, 14, 15, 18, 19]) expect(of(EVENTS[i]!).haptic, EVENTS[i]!.k).toBeUndefined();
  });

  it("a print's note climbs with its size, and the last seconds tick higher and higher", () => {
    const note = (squares: number) => cueFor({ k: "print", id: HERO, squares, cells: [], from: 0, stolen: 0, pts: 0, tier: 1, ink: 0, share: 0 }).pitch!;
    expect(note(1)).toBe(0);
    for (const [a, b] of [[4, 12], [12, 30], [30, 60]]) expect(note(b!)).toBeGreaterThan(note(a!));
    expect(note(500)).toBe(24);
    const tick = (left: number) => cueFor({ k: "tick", left }).pitch!;
    for (let left = INK_LOW - 1; left > 1; left--) expect(tick(left - 1)).toBeGreaterThan(tick(left));
  });

  it("a whole run plays a cue for everything it emits, and uses most of the palette", () => {
    const heard = new Set<string>();
    for (const seed of [11, 222, 3333, 44444, 5]) {
      const sim = new Sim({ seed });
      const pilot = new Pilot(SKILLS[2]!, createRng(seed));
      while (!sim.over && sim.t < 300) {
        pilot.step(sim, 1 / 60);
        sim.step(1 / 60);
        for (const e of sim.events) {
          const cue = cueFor(e);
          if (!(e.k === "out" && e.id !== HERO)) expect(cue.sounds.length, e.k).toBeGreaterThan(0);
          for (const name of cue.sounds) heard.add(name);
        }
        sim.events.length = 0;
      }
    }
    for (const name of ["step", "wet", "print", "pull", "roll", "smudge", "bell", "lost", "crawl", "low", "tick", "sheet", "fresh", "dry", "rivalPrint"]) expect(heard, name).toContain(name);
  });

  it("the bed walks during play, hurries when the ink is nearly dry, and rests between sheets and outside a run", () => {
    expect(bedFor("play", 12, true)).toBe("walk");
    expect(bedFor("play", INK_LOW, true)).toBe("hurry");
    expect(bedFor("play", 2, true)).toBe("hurry");
    expect(bedFor("printed", 12, true)).toBe("off");
    expect(bedFor("over", 0, true)).toBe("off");
    expect(bedFor("play", 12, false)).toBe("off");
    // Up a tone a sheet, back down after six.
    expect([1, 2, 3, 6, 7].map(bedKey)).toEqual([0, 2, 4, 10, 0]);
    for (const pattern of [WALK, HURRY]) {
      expect(pattern).toHaveLength(16);
      expect(pattern[0]).not.toBeNull();
      for (const n of pattern) if (n !== null) expect(n + 10).toBeLessThan(84);
    }
    // The hurried bed has no rests: twice the pulse.
    expect(HURRY.filter((n) => n === null)).toHaveLength(0);
    expect(WALK.filter((n) => n === null).length).toBeGreaterThanOrEqual(6);
  });
});
