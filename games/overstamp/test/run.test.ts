import { describe, expect, it } from "vitest";
import { planFor } from "../src/board.ts";
import { TRAY } from "../src/deal.ts";
import { multiplier, Run, TUNE } from "../src/run.ts";

/** Lifts slips in the deal's own clearing order until the sheet is done (or `n` lifts). */
function playWitness(r: Run, n = Infinity) {
  const order = r.witness.slice();
  const out = [];
  for (const id of order) {
    if (n-- <= 0) break;
    out.push(...r.tap(id));
  }
  return out;
}

describe("a run", () => {
  it("lifts only free slips; a covered one shrugs and costs nothing", () => {
    const r = new Run(1);
    const covered = r.slips.find((s) => !r.isFree(s.id))!;
    const before = r.clock;
    const ev = r.tap(covered.id);
    expect(ev).toEqual([{ type: "covered", id: covered.id }]);
    expect(r.tray.length).toBe(0);
    expect(r.clock).toBe(before);
    const free = r.freeIds()[0]!;
    const ev2 = r.tap(free);
    expect(ev2[0]).toMatchObject({ type: "lift", id: free });
    expect(r.tray.map((t) => t.id)).toEqual([free]);
    expect(r.tap(free)).toEqual([]);
  });

  it("three alike are sealed: points, a second back, a run of seals", () => {
    const r = new Run(2);
    r.clock = 10;
    const evs = playWitness(r, 30);
    const seals = evs.filter((e) => e.type === "seal");
    expect(seals.length).toBeGreaterThan(0);
    expect(r.stats.triples).toBe(seals.length);
    // Done instantly, so every seal belongs to one run of seals.
    seals.forEach((s, i) => s.type === "seal" && expect(s.combo).toBe(i + 1));
    expect(r.score).toBeGreaterThan(0);
  });

  it("the multiplier climbs at two, four, seven and eleven seals in a row", () => {
    expect([1, 2, 3, 4, 6, 7, 10, 11, 20].map(multiplier)).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("a run of seals breaks when the next comes too late", () => {
    const r = new Run(3);
    for (const id of r.witness) {
      r.tap(id);
      if (r.combo >= 1) break;
    }
    expect(r.combo).toBeGreaterThanOrEqual(1);
    r.step(TUNE.comboWindow + 0.1);
    expect(r.combo).toBe(0);
  });

  it("a slip goes into the tray beside its own kind", () => {
    const r = new Run(4);
    for (let i = 0; i < 40 && r.tray.length < 4; i++) {
      const id = r.freeIds().find((x) => r.inTray(r.slips[x]!.type) < 2);
      if (id === undefined) break;
      r.tap(id);
    }
    const kinds = r.tray.map((t) => t.kind);
    // Grouped: a kind never reappears after another kind started.
    const seen = new Set<number>();
    for (let i = 0; i < kinds.length; i++) {
      if (i > 0 && kinds[i] !== kinds[i - 1]) expect(seen.has(kinds[i]!)).toBe(false);
      seen.add(kinds[i]!);
    }
  });

  it("clearing a sheet pays, winds the clock, earns a paper clip and deals a bigger sheet while the clock waits", () => {
    const r = new Run(5);
    r.clock = 20;
    const evs = playWitness(r);
    const sheet = evs.find((e) => e.type === "sheet");
    expect(sheet).toBeTruthy();
    expect(r.sheet).toBe(2);
    expect(r.slips.length).toBe(planFor(2).tiles);
    expect(r.clips).toBe(1);
    expect(r.pause).toBeGreaterThan(0);
    const c = r.clock;
    r.step(0.5);
    expect(r.clock).toBe(c);
    expect(r.tap(r.freeIds()[0]!)).toEqual([]);
    r.step(TUNE.dealPause);
    r.step(0.5);
    expect(r.clock).toBeLessThan(c);
  });

  it("a full tray sends the last three back once per sheet, then a paper clip, then ends the run", () => {
    const r = new Run(6);
    r.t = TUNE.safeStart + 1;
    // Fill the tray with kinds that never make three.
    const fill = () => {
      for (let i = 0; i < 60 && r.live; i++) {
        const fresh = r.freeIds().filter((x) => r.inTray(r.slips[x]!.type) < 2);
        if (!fresh.length) return null;
        const pick = fresh.sort((a, b) => r.inTray(r.slips[a]!.type) - r.inTray(r.slips[b]!.type))[0]!;
        const ev = r.tap(pick);
        const back = ev.find((e) => e.type === "back" || e.type === "over");
        if (back) return back;
      }
      return null;
    };
    // Sheet 1 is small; move on to a sheet with enough kinds to fill the tray.
    playWitness(r);
    r.step(TUNE.dealPause + 0.01);
    playWitness(r);
    r.step(TUNE.dealPause + 0.01);
    expect(r.sheet).toBe(3);
    r.clock = 40;
    expect(r.clips).toBe(2);
    const first = fill();
    expect(first).toMatchObject({ type: "back", why: "grace" });
    expect(r.tray.length).toBe(TRAY - 3);
    if (first?.type === "back") for (const id of first.ids) expect(r.slips[id]!.gone).toBe(false);
    const second = fill();
    expect(second).toMatchObject({ type: "back", why: "clip" });
    expect(r.clips).toBe(1);
    r.clips = 0;
    const third = fill();
    expect(third).toMatchObject({ type: "over", why: "full" });
    expect(r.live).toBe(false);
  });

  it("in the first seconds a full tray is always forgiven, however often", () => {
    const r = new Run(7);
    // Two quick sheets (no time passes), then fill the tray twice on the third.
    playWitness(r);
    r.pause = 0;
    playWitness(r);
    r.pause = 0;
    expect(r.t).toBeLessThan(TUNE.safeStart);
    const whys: string[] = [];
    for (let i = 0; i < 200 && whys.length < 2 && r.live; i++) {
      const id = r.freeIds().find((x) => r.inTray(r.slips[x]!.type) < 2);
      if (id === undefined) break;
      for (const e of r.tap(id)) if (e.type === "back") whys.push(e.why);
    }
    expect(whys).toEqual(["grace", "grace"]);
    expect(r.live).toBe(true);
  });

  it("the clock burns faster the longer the run lasts, and a run with no input ends on time", () => {
    const r = new Run(8);
    expect(r.burn).toBe(1);
    let t = 0;
    while (r.live && t < 60) {
      r.step(1 / 60);
      t += 1 / 60;
    }
    expect(r.over).toBe("time");
    expect(t).toBeLessThan(25);
    expect(t).toBeGreaterThan(15);
    const late = new Run(8);
    late.t = 60;
    expect(late.burn).toBeGreaterThan(1.5);
  });

  it("the last slip of an upper layer is announced", () => {
    const r = new Run(9);
    r.clock = 30;
    const evs = playWitness(r);
    const top = Math.max(...evs.filter((e) => e.type === "layer").map((e) => (e.type === "layer" ? e.z : 0)));
    expect(top).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic for a seed", () => {
    const a = new Run(42);
    const b = new Run(42);
    expect(a.slips.map((s) => s.type)).toEqual(b.slips.map((s) => s.type));
    playWitness(a);
    playWitness(b);
    expect(a.score).toBe(b.score);
    expect(a.slips.map((s) => s.type)).toEqual(b.slips.map((s) => s.type));
  });

  it("the paper clip and the riffle work by hand", () => {
    const r = new Run(10);
    r.clock = 40;
    playWitness(r);
    r.step(TUNE.dealPause + 0.01);
    expect(r.clips).toBe(1);
    const id = r.freeIds()[0]!;
    r.tap(id);
    const ev = r.clip();
    expect(ev[0]).toMatchObject({ type: "back", why: "clip", ids: [id] });
    expect(r.slips[id]!.gone).toBe(false);
    expect(r.clips).toBe(0);
    expect(r.clip()).toEqual([]);
    r.riffles = 1;
    const kinds = r.slips.map((s) => s.type).sort();
    const rf = r.riffle();
    expect(rf[0]).toMatchObject({ type: "riffle", ok: true });
    expect(r.slips.map((s) => s.type).sort()).toEqual(kinds);
    expect(r.riffles).toBe(0);
  });
});
