import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dailyOrder, dailyWord, dayOf, seedForDay } from "../src/daily.ts";
import { PackedWords } from "../src/lexicon.ts";
import { EXCLUDE } from "../scripts/answers.ts";
import { FORMS, HARD, HARD_STEMS, SOFT } from "../scripts/blocklist.ts";
import { loadLists } from "../scripts/lists.ts";
import { inflected } from "../scripts/words.ts";

const { answers, accept } = loadLists();

describe("the word lists", () => {
  it("are five letters a-z, sorted, and every answer is accepted", () => {
    expect(answers.length).toBeGreaterThan(1500);
    expect(accept.size).toBeGreaterThan(8000);
    for (const w of answers) {
      expect(w).toMatch(/^[a-z]{5}$/);
      expect(accept.has(w), w).toBe(true);
    }
    expect([...answers].sort()).toEqual(answers);
    for (let i = 1; i < accept.size; i++) expect(accept.at(i - 1) < accept.at(i)).toBe(true);
    expect(readFileSync(new URL("../src/data/accept.txt", import.meta.url), "utf8")).toMatch(/^[a-z]+$/);
  });

  it("the packed search finds every word and nothing else", () => {
    const p = new PackedWords("abacibackscrane");
    expect(p.has("aback")).toBe(false);
    for (let i = 0; i < 600; i++) {
      const w = accept.at(Math.floor((i / 600) * accept.size));
      expect(accept.has(w), w).toBe(true);
    }
    for (const w of ["zzzzz", "aaaaa", "crane1", "cran", "", "qqqqq"]) expect(accept.has(w), w).toBe(false);
    expect(accept.has("proof")).toBe(true);
    // A generous dictionary: uncommon but real words are fine as guesses.
    for (const w of ["aahed", "xylem", "fjord", "quoth", "zesty"]) expect(accept.has(w), w).toBe(true);
  });

  it("no answer is a slur, profanity, an adult or sad topic, or one of the hand-picked exclusions", () => {
    const blocked = new Set<string>();
    for (const h of [...HARD, ...SOFT]) for (const f of FORMS) blocked.add(h + f);
    for (const w of answers) {
      expect(blocked.has(w), w).toBe(false);
      expect(HARD_STEMS.some((s) => w.includes(s)), w).toBe(false);
    }
    const ex = new Set(EXCLUDE);
    for (const w of answers) expect(ex.has(w), w).toBe(false);
    for (const w of ["spade", "fairy", "death", "bible", "gonna", "kiwis"]) expect(answers.includes(w), w).toBe(false);
    // Hard words are not even accepted as guesses.
    for (const w of ["bitch", "whore", "dildo"]) expect(accept.has(w), w).toBe(false);
  });

  it("answers are not plain plurals or other inflected forms", () => {
    const set = new Set(answers);
    for (const w of answers) {
      if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) expect(set.has(w.slice(0, -1)), w).toBe(false);
    }
    const base = new Set(["cat", "box", "fly", "act", "bake", "try", "do", "owe", "tie", "safe"]);
    for (const w of ["cats", "boxes", "flies", "acted", "baked", "tried", "doing", "owing", "tying", "safer"]) expect(inflected(w, base), w).toBe(true);
    // Look-alikes the rules leave alone (thing and tweed need the hand-kept list: "th" and "twee" are words).
    for (const w of ["glass", "bonus", "basis", "water", "bring"]) expect(inflected(w, new Set(["glas", "bonu", "basi", "wate", "brin"])), w).toBe(false);
    for (const w of ["glass", "bonus", "thing", "geese", "tweed"]) expect(set.has(w), w).toBe(true);
  });
});

describe("today's word", () => {
  const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

  it("is the same for everyone on a day, whatever the hour or the run's own seed", () => {
    const seed = seedForDay(day("2026-11-06"));
    const a = dailyWord(answers, seed, Date.parse("2026-11-06T00:00:01Z"));
    const b = dailyWord(answers, seed, Date.parse("2026-11-06T23:59:59Z"));
    expect(a.word).toBe(b.word);
    expect(a.day).toBe(309);
    // A device clock a day off still finds the day.
    expect(dailyWord(answers, seed, day("2026-11-07")).word).toBe(a.word);
    expect(dailyWord(answers, seed, day("2026-11-05")).word).toBe(a.word);
  });

  it("matches the shell's daily seed (FNV-1a over the UTC date)", () => {
    // The value @thumbcade/protocol's dailySeedFor gives for 2026-11-06.
    let h = 0x811c9dc5;
    for (const c of "2026-11-06") h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    expect(seedForDay(day("2026-11-06"))).toBe(h >>> 0);
    expect(dayOf(h >>> 0, day("2026-11-06"))).toBe(309);
  });

  it("walks every answer before any comes back", () => {
    const order = dailyOrder(answers.length);
    expect(new Set(order).size).toBe(answers.length);
    const seen = new Set<string>();
    const start = day("2026-01-01");
    for (let d = 0; d < 900; d++) {
      const t = start + d * 86_400_000;
      const w = dailyWord(answers, seedForDay(t), t).word;
      expect(seen.has(w), `day ${d}: ${w}`).toBe(false);
      seen.add(w);
    }
  });

  it("a seed from no nearby day still gives everyone holding it the same word", () => {
    const a = dailyWord(answers, 12345, day("2026-11-06"));
    const b = dailyWord(answers, 12345, day("2027-03-01"));
    expect(a.day).toBeNull();
    expect(a.word).toBe(b.word);
  });
});
