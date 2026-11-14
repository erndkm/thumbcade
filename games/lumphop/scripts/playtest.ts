import { percentile, playRun, SKILLS } from "../src/pilot.ts";
const runs = Number(process.argv[2] ?? 100);
const f = (n: number) => n.toFixed(0).padStart(3);
console.log("skill     run p10/p50/p90 s   levels p50  seals  streak  score   graces rewinds spares  lost<10  clock@10min ms/run");
for (const skill of SKILLS) {
  const t0 = performance.now();
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const ms = (performance.now() - t0) / runs;
  const secs = res.map((r) => r.seconds);
  console.log([skill.name.padEnd(9), `${f(percentile(secs, 0.1))}/${f(percentile(secs, 0.5))}/${f(percentile(secs, 0.9))}`.padEnd(18),
    String(percentile(res.map((r) => r.stats.levels), 0.5)).padStart(8),
    String(percentile(res.map((r) => r.stats.seals), 0.5)).padStart(6),
    String(percentile(res.map((r) => r.stats.bestStreak), 0.5)).padStart(6),
    String(percentile(res.map((r) => r.score), 0.5)).padStart(7),
    (res.reduce((a, r) => a + r.stats.graces, 0) / runs).toFixed(2).padStart(7),
    (res.reduce((a, r) => a + r.stats.rewinds, 0) / runs).toFixed(2).padStart(7),
    (res.reduce((a, r) => a + r.stats.sparesUsed, 0) / runs).toFixed(2).padStart(6),
    String(res.filter((r) => r.lostBy10).length).padStart(7),
    Math.min(...res.map((r) => r.clockAt10)).toFixed(1).padStart(11), ms.toFixed(1).padStart(6)].join(" "));
}
const idle = playRun(null, 1);
console.log(`idle: over after ${idle.seconds.toFixed(1)} s`);
