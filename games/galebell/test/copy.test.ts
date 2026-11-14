import { describe, expect, it } from "vitest";
import { BANNER_MAX, BANNERS, COMBOS, hintFor, HINT_MAX, HINTS, JACKPOTS, SUB_MAX, TIERS } from "../src/copy.ts";
import { HARBOUR_LABEL } from "../src/hud.ts";
import { playRun } from "../src/runs.ts";

/** Departure Mono's advance is 0.6 em, and the labels add 0.08 em of tracking. */
const monoWidth = (text: string, px: number) => text.length * px * 0.68;

describe("copy", () => {
  it("every banner title and line fits its plate", () => {
    for (const [title, sub] of Object.values(BANNERS)) {
      expect(title.length, title).toBeLessThanOrEqual(BANNER_MAX);
      expect(sub.length, sub).toBeLessThanOrEqual(SUB_MAX);
    }
    for (const t of TIERS) {
      expect(t.name.length).toBeLessThanOrEqual(BANNER_MAX);
      // The tier banner's line is "×5 · " plus the tier's line.
      expect(`×5 · ${t.line}`.length, t.line).toBeLessThanOrEqual(SUB_MAX + 2);
    }
    for (const c of COMBOS) expect(`${c} ×9 · +99,999`.length).toBeLessThanOrEqual(30);
    for (const j of JACKPOTS) expect(j.length).toBeLessThanOrEqual(BANNER_MAX);
  });

  it("the HUD's tier name and the harbour's label fit their places on a 360 px screen", () => {
    for (const t of TIERS) expect(monoWidth(t.name, 9)).toBeLessThan(70);
    for (const l of Object.values(HARBOUR_LABEL)) expect(monoWidth(l, 9) + 14).toBeLessThan(120);
  });

  it("every hint wraps to at most three lines in the game-over strip on the narrowest screen", () => {
    // 360 px Android: the strip is 360 - 72 (rail) - 20 wide, less 28 of padding.
    const width = 360 - 72 - 20 - 28;
    for (const h of Object.values(HINTS)) {
      expect(h.length, h).toBeLessThanOrEqual(HINT_MAX);
      const words = `NEXT TIME: ${h}`.split(" ");
      let lines = 1;
      let line = "";
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (monoWidth(next, 11) > width && line) {
          lines++;
          line = w;
        } else line = next;
      }
      expect(lines, h).toBeLessThanOrEqual(3);
    }
  });

  it("the hint comes from what happened in the run", () => {
    const idle = playRun(null, 1);
    expect(hintFor(idle.stats)).toBe("noFlips");
    const picked = new Set<string>();
    for (let i = 0; i < 30; i++) picked.add(hintFor(playRun(i % 2 ? "casual" : "expert", 50 + i).stats));
    expect(picked.size).toBeGreaterThan(2);
    for (const k of picked) expect(Object.keys(HINTS)).toContain(k);
  });
});
