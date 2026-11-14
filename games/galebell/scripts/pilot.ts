/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/galebell pilot [runs]`.
 * Plays whole runs at each skill (and idle) and prints the spread of run lengths, scores and what happened.
 */
import { playRun } from "../src/runs.ts";
import type { SkillName } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 200);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : String(Math.round(n)));
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

for (const skill of [null, "novice", "casual", "good", "expert"] as Array<SkillName | null>) {
  const n = skill ? runs : Math.min(runs, 60);
  const secs: number[] = [];
  const scores: number[] = [];
  const first: number[] = [];
  let early = 0;
  let corr = 0;
  const st = { tier: [] as number[], orbits: [] as number[], locks: [] as number[], mb: 0, jackpots: [] as number[], extra: 0, extraLit: 0, slips: 0, saves: [] as number[], cradles: [] as number[], combos: [] as number[], lamps: [] as number[], flags: [] as number[], nudges: 0 };
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const r = playRun(skill, 1000 + i * 7919);
    secs.push(r.seconds);
    scores.push(r.score);
    first.push(r.drains[0] ?? r.seconds);
    if (r.seconds < 10) early++;
    corr += r.corrections;
    st.tier.push(r.stats.tier);
    st.orbits.push(r.stats.orbits);
    st.locks.push(r.stats.locks);
    if (r.stats.multiballs > 0) st.mb++;
    st.jackpots.push(r.stats.jackpots);
    if (r.stats.extraBalls > 0) st.extra++;
    if (r.stats.extraLit) st.extraLit++;
    st.slips += r.stats.slips;
    st.saves.push(r.stats.saves);
    st.cradles.push(r.stats.cradles);
    st.combos.push(r.stats.maxCombo);
    st.lamps.push(r.stats.lamps);
    st.flags.push(r.stats.flagBanks);
    st.nudges += r.stats.nudges;
  }
  secs.sort((a, b) => a - b);
  scores.sort((a, b) => a - b);
  first.sort((a, b) => a - b);
  const tiers = [...st.tier].sort((a, b) => a - b);
  console.log(
    `${(skill ?? "idle").padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` | first ball lost p10 ${pct(first, 0.1).toFixed(0)} s · median ${pct(first, 0.5).toFixed(0)} s | runs under 10 s ${early}` +
      ` | score median ${fmt(pct(scores, 0.5))} | tier median ${pct(tiers, 0.5)} · p90 ${pct(tiers, 0.9)}` +
      ` | orbits ${avg(st.orbits).toFixed(1)} · lamps ${avg(st.lamps).toFixed(1)} · flag banks ${avg(st.flags).toFixed(1)} · locks ${avg(st.locks).toFixed(1)} · high tide ${((st.mb / n) * 100).toFixed(0)}% · jackpots ${avg(st.jackpots).toFixed(1)}` +
      ` | extra ball lit ${((st.extraLit / n) * 100).toFixed(0)}% · won ${((st.extra / n) * 100).toFixed(0)}% | saves ${avg(st.saves).toFixed(1)} · cradles ${avg(st.cradles).toFixed(1)} · slips ${(st.slips / n).toFixed(2)} · best combo ${avg(st.combos).toFixed(1)}` +
      ` | corrections ${corr} · nudges ${st.nudges} | ${((performance.now() - t0) / n).toFixed(0)} ms/run`,
  );
}
