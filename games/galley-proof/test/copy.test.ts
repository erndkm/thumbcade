import { describe, expect, it } from "vitest";
import { dailyLine, hintFor, pointsLine, statsLine } from "../src/copy.ts";
import { keyboard, playFrame, SUMMARY_PX, summaryPlate } from "../src/layout.ts";
import { roman, words } from "../src/qm/type.ts";
import { Run, type RunStats, SOLVE_NAMES, TIER_NAMES, TUNE } from "../src/run.ts";
import { measure } from "../scripts/fonts.ts";
import { loadLists } from "../scripts/lists.ts";

/**
 * Every line we can show must fit its plate in Instrument Serif (measured with the font's own advance widths and
 * kerning, the way the canvas sets it), on the narrowest phone we lay out for (360 pt), at no less than a legible size.
 */
const W = 360;
const H = 724;
const PREVIEW = { top: 72, right: 72, bottom: 148, left: 0 };
const lists = loadLists();

const stats = (o: Partial<RunStats>): RunStats => ({
  words: 0, misses: 0, solvedLines: 0, linesWritten: 0, fewest: 0, bestStreak: 0, unknown: 0, shortWrites: 0, pencilsEarned: 0, pencilsUsed: 0,
  pencilIdleLines: 0, struckReuse: 0, samePlace: 0, bellSolves: 0, seconds: 60, dailyLines: null, dailyMarks: [], ...o,
});

function everyRun(): RunStats[] {
  const out: RunStats[] = [];
  for (const words of [0, 1, 2, 4, 12, 37]) {
    for (const extra of [
      {},
      { unknown: 5 },
      { struckReuse: 6 },
      { samePlace: 3 },
      { shortWrites: 4 },
      { pencilIdleLines: 6 },
      { misses: 2 },
      { bestStreak: 1 },
      { bestStreak: 9 },
      { solvedLines: words * 5 },
      { pencilsEarned: 1 },
    ]) {
      out.push(stats({ words, solvedLines: words * 3, linesWritten: words * 3 + 7, fewest: words ? 2 : 0, bestStreak: Math.min(words, 3), pencilsEarned: 0, ...extra }));
    }
  }
  return out;
}

async function fits(text: string, px: number, minPx: number, room: number): Promise<void> {
  const w = await measure(text, px);
  const scaled = w <= room ? px : (px * room) / w;
  expect(scaled, `"${text}" (${w.toFixed(0)} px at ${px}, room ${room.toFixed(0)})`).toBeGreaterThanOrEqual(minPx);
}

describe("the summary slip", () => {
  const slip = new Run({ seed: 1, answers: lists.answers, daily: null, isWord: lists.isWord }).slip;
  for (const daily of [false, true]) {
    it(`every line fits its row at a legible size${daily ? " beside today's marks" : ""}`, async () => {
      const p = summaryPlate(W, H, PREVIEW, false, daily);
      for (const s of everyRun()) {
        for (const lines of [0, 1, 5]) {
          slip.lines.length = 0;
          for (let i = 0; i < lines; i++) slip.lines.push({ word: "proof", marks: [0, 0, 0, 0, 0] });
          await fits(hintFor(s, slip), SUMMARY_PX[1], 14, p.room[1]!);
        }
        await fits(statsLine(s), SUMMARY_PX[2], 13, p.room[2]!);
      }
      for (const [score, best, isBest] of [
        [0, null, false],
        [480, null, true],
        [99_999, 1, true],
        [5_000, 123_456, false],
        [10_000, 10_000, false],
        [123_456, 99_999, true],
      ] as Array<[number, number | null, boolean]>) {
        await fits(pointsLine(score, best, isBest), SUMMARY_PX[0], 16, isBest ? p.roomBest : p.room[0]!);
      }
      if (daily) {
        for (const l of [0, 1, 2, 3, 4, 5, 6]) {
          for (const sh of ["no", "asking", "yes"] as const) {
            const [label, send] = dailyLine(l, sh);
            await fits(label + send, SUMMARY_PX[3], 13, p.room[3]!);
          }
        }
      }
    });
  }
});

describe("messages, notes and the HUD", () => {
  const f = playFrame(W, H, { top: 28, right: 0, bottom: 0, left: 0 });

  it("every message fits the lane under the clock at 14 px or more", async () => {
    const room = f.msg.w - 20;
    const longest = lists.answers.reduce((a, w) => (w.length >= a.length ? w : a));
    const msgs = [
      ...SOLVE_NAMES.slice(1).map((n) => `${n} · +${(TUNE.solvePoints[1]! * 5 + TUNE.dailyPoints).toLocaleString("en-US")}`),
      ...TIER_NAMES.slice(2).map((n, i) => `${n} · ×${i + 2}`),
      "ringed: right place · underlined: elsewhere · struck: not in it",
      "type any five-letter word",
      "write it when the line is full",
      "filed · every solve buys time back",
      "today's word first · the same for everyone",
      ...[0, 1, 6].map((l) => `today's word is filed (${l ? `${words(l)} lines` : "missed"}) · a fresh slip`),
      "today's word, filed",
      `it was ${longest} · −${TUNE.missTime} seconds`,
      "a pencil for the margin · it writes in one letter",
      `a solve in ${words(TUNE.pencilAt)} lines or fewer earns a pencil`,
      "pencilled in: W",
      "written at the bell",
      "past your best",
      "W is in it · try it in another place",
      "stuck? the pencil writes in one letter",
      "any word will do · each line tells you more",
      "time",
    ];
    for (const m of msgs) await fits(m, 18, 14, room);
  });

  it("every note fits the foot of the slip at 15 px", async () => {
    const room = f.slip.card.w - 24;
    for (const n of ["not in our dictionary · it costs nothing", "checking the dictionary.", "the line is full · write it", "five letters to a line · four so far", "type a five-letter word"]) {
      await fits(n, 15, 15, room);
    }
  });

  it("the slip's header and the HUD's three lanes never touch", async () => {
    const head = (await measure("today's word · no. 366", 15)) + (await measure("line iii of vi", 15)) + 28 + 16;
    expect(head).toBeLessThanOrEqual(f.slip.card.w);
    const left = Math.max(await measure("points · best 999,999", 14), await measure("9,999,999", 34, "regular"));
    const right = Math.max(await measure("seconds", 14), await measure("75", 34, "regular") + 50 + (await measure("+19.5", 19)));
    let centre = await measure("today's word", 18);
    for (let m = 2; m <= 5; m++) centre = Math.max(centre, await measure(`×${m} · ${TIER_NAMES[m]}`, 14));
    centre = Math.max(centre, await measure(`slip ${roman(38)}`, 18), await measure("×2 at the next", 14), await measure("clean solves climb", 14));
    expect(f.L + left + 6, "left meets centre").toBeLessThanOrEqual(W / 2 - centre / 2);
    expect(W / 2 + centre / 2 + 6, "centre meets right").toBeLessThanOrEqual(f.R - Math.min(right, 70));
  });

  it("the bottom row's labels fit their keys", async () => {
    const kb = keyboard(W, H - 8, H);
    const k = (key: string) => kb.keys.find((b) => b.key === key)!;
    expect(32 + (await measure("erase", 19))).toBeLessThanOrEqual(k("erase").w);
    expect(36 + (await measure(`pencil ×${TUNE.pencilsMax}`, 19))).toBeLessThanOrEqual(k("pencil").w);
    expect(34 + (await measure("write", 19))).toBeLessThanOrEqual(k("write").w);
  });
});
