/**
 * Headless playtests: plays runs at every skill level and prints run length and score.
 *   pnpm --filter @thumbcade-games/halftune playtest [runs]
 */
import { Chart, setList } from "../src/chart.ts";
import { SONGS } from "../src/songs.ts";
import { median, percentile, simulate, SKILLS } from "../src/sim.ts";

const runs = Number(process.argv[2] ?? 60);

console.log("tunes (tiles, seconds, peak taps/s)");
for (const id of Object.keys(SONGS)) {
  const c = new Chart([id], 1);
  const ts = c.tiles.map((t) => t.t);
  let peak = 0;
  for (let i = 0; i < ts.length; i++) peak = Math.max(peak, ts.filter((t) => Math.abs(t - ts[i]!) <= 0.5).length);
  const holds = c.tiles.filter((t) => t.hold).length;
  console.log(`  ${id.padEnd(13)} ${String(c.tiles.length).padStart(4)} tiles ${holds} holds ${(c.end - c.plays[0]!.start).toFixed(1).padStart(5)} s  peak ${peak}/s`);
}
const full = new Chart(setList(7), 7);
console.log(`a full set: ${full.tiles.length} tiles, ${full.end.toFixed(1)} s\n`);

console.log(`${runs} runs per skill level (real seconds from the first tap to the end)`);
console.log("skill      p10 s  median s  p90 s  finished  median score  songs  combo  perfect%");
for (const skill of SKILLS) {
  const res = Array.from({ length: runs }, (_, i) => simulate(1000 + i * 7919, skill));
  const secs = res.map((r) => r.seconds);
  const perf = res.map((r) => {
    const s = r.stats;
    const hits = s.perfect + s.great + s.early + s.late;
    return hits ? (100 * s.perfect) / hits : 0;
  });
  console.log(
    [
      skill.name.padEnd(9),
      percentile(secs, 0.1).toFixed(0).padStart(6),
      median(secs).toFixed(1).padStart(9),
      percentile(secs, 0.9).toFixed(0).padStart(6),
      `${Math.round((100 * res.filter((r) => r.won).length) / runs)}%`.padStart(9),
      median(res.map((r) => r.score)).toFixed(0).padStart(13),
      median(res.map((r) => r.stats.cleared)).toFixed(0).padStart(6),
      median(res.map((r) => r.stats.bestCombo)).toFixed(0).padStart(6),
      median(perf).toFixed(0).padStart(9),
    ].join(" "),
  );
}
