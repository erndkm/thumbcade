import { describe, expect, it } from "vitest";
import { pct, playRun, type Skill } from "../src/sim.ts";

/**
 * Run lengths at four skill bands (the pilot plays through the same press, release and swipe calls as a thumb), the
 * idle run, and the reviewer's scripted taps. `pnpm --filter @thumbcade-games/pittermoon pilot 200` prints the full
 * spread; these use fewer runs to stay quick.
 */
const N = 80;
const runs = (skill: Skill) => Array.from({ length: N }, (_, i) => playRun(skill, 1000 + i * 7919));

describe("run lengths", () => {
  const bands: Record<string, ReturnType<typeof runs>> = {};
  for (const s of ["novice", "casual", "good", "expert"] as const) bands[s] = runs(s);
  const med = (s: string) => pct(bands[s]!.map((r) => r.seconds), 0.5);

  it("lands each skill band near its target length", () => {
    expect(med("novice")).toBeGreaterThan(30);
    expect(med("novice")).toBeLessThan(46);
    expect(med("casual")).toBeGreaterThan(44);
    expect(med("casual")).toBeLessThan(62);
    expect(med("good")).toBeGreaterThan(60);
    expect(med("good")).toBeLessThan(82);
    expect(med("expert")).toBeGreaterThan(76);
    expect(med("expert")).toBeLessThan(102);
  });

  it("rewards skill: each band climbs further and scores more than the one below", () => {
    const rows = (s: string) => pct(bands[s]!.map((r) => r.rows), 0.5);
    const score = (s: string) => pct(bands[s]!.map((r) => r.score), 0.5);
    expect(rows("casual")).toBeGreaterThan(rows("novice"));
    expect(rows("good")).toBeGreaterThan(rows("casual"));
    expect(rows("expert")).toBeGreaterThan(rows("good"));
    expect(score("expert")).toBeGreaterThan(score("good"));
    expect(med("expert")).toBeGreaterThan(med("casual"));
  });

  it("nobody loses in the first ten seconds", () => {
    for (const s of Object.keys(bands)) for (const r of bands[s]!) expect(r.seconds, s).toBeGreaterThan(10);
  });

  it("good players meet the zoomies, fish and a new stretch; experts see the broom ride", () => {
    const share = (s: string, f: (r: ReturnType<typeof runs>[number]) => boolean) => bands[s]!.filter(f).length / N;
    expect(share("casual", (r) => r.stats.maxTier >= 1)).toBeGreaterThan(0.8);
    expect(share("good", (r) => r.stats.stretches >= 2)).toBeGreaterThan(0.7);
    expect(share("good", (r) => r.stats.fish >= 2)).toBeGreaterThan(0.7);
    expect(share("expert", (r) => r.stats.lifts >= 1)).toBeGreaterThan(0.5);
  });

  it("an idle run ends on its own in about 20 s, and the reviewer's scripted taps end well inside 95 s", () => {
    for (const r of runs("idle").slice(0, 10)) {
      expect(r.seconds).toBeGreaterThan(17);
      expect(r.seconds).toBeLessThan(24);
    }
    const scripted = runs("scripted");
    for (const r of scripted) expect(r.seconds).toBeLessThan(90);
  });
});
