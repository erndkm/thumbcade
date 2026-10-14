// Summarises a soak run: memory samples (CSV from soak.sh) and, from Maestro's command log, how long the
// landed card took to reach PREVIEW after each feed swipe.
//   node maestro/perf/analyze.mjs <samples.csv> <maestro run dir>
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [csvPath, runDir] = process.argv.slice(2);
const mb = (kb) => `${Math.round(kb / 1024)} MB`;
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

const WARMUP_S = 60;
const rows = readFileSync(csvPath, "utf8").trim().split("\n").slice(1).map((l) => l.split(",").map(Number));
// Steady state: after the first card and its neighbours have loaded.
const steady = rows.filter((r) => r[0] >= WARMUP_S && r[2] > 0);
const quarter = Math.max(3, Math.floor(steady.length / 4));
const avg = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
// Least-squares slope of memory over time, in MB per 10 minutes.
const slope = (k) => {
  const n = steady.length;
  const mt = avg(steady, 0);
  const mv = avg(steady, k);
  let num = 0;
  let den = 0;
  for (const r of steady) {
    num += (r[0] - mt) * (r[k] - mv);
    den += (r[0] - mt) ** 2;
  }
  return n > 2 && den > 0 ? ((num / den) * 600) / 1024 : 0;
};
console.log(`Memory: ${rows.length} samples over ${rows.at(-1)?.[0] ?? 0} s (first ${WARMUP_S} s excluded as warm-up)`);
console.log(`  WebContent processes: max ${Math.max(...rows.map((r) => r[2]))}, median ${pct(rows.map((r) => r[2]).sort((a, b) => a - b), 0.5)}`);
for (const [k, name] of [[1, "Expo Go"], [3, "WebContent (all)"], [4, "WebKit GPU"]]) {
  const sl = slope(k);
  console.log(
    `  ${name.padEnd(17)} first quarter ${mb(avg(steady.slice(0, quarter), k))} → last quarter ${mb(avg(steady.slice(-quarter), k))} · peak ${mb(Math.max(...rows.map((r) => r[k])))} · trend ${sl >= 0 ? "+" : ""}${sl.toFixed(0)} MB/10 min`,
  );
}

if (runDir) {
  const flowDir = readdirSync(runDir, { withFileTypes: true }).find((d) => d.isDirectory());
  const cmds = JSON.parse(readFileSync(join(runDir, flowDir.name, "commands.json"), "utf8"));
  let swipes = 0;
  let dock = 0;
  const toPreview = [];
  let afterSwipe = false;
  for (const c of cmds) {
    const kind = Object.keys(c.command ?? {})[0];
    const ok = c.metadata?.status === "COMPLETED";
    if (kind === "swipeCommand" && ok) {
      swipes++;
      if (JSON.stringify(c.command).includes('"dock"')) dock++;
      afterSwipe = true;
    } else if (kind === "assertConditionCommand" && afterSwipe && JSON.stringify(c.command).includes('".*, preview"')) {
      // Wall time until the landed card reported PREVIEW (includes Maestro's ~0.2 s hierarchy poll).
      if (ok) toPreview.push(c.metadata.duration);
      afterSwipe = false;
    }
  }
  const sorted = [...toPreview].sort((a, b) => a - b);
  const failed = cmds.some((c) => c.metadata?.status === "FAILED");
  console.log(`Swipes: ${swipes} (${dock} from the Dock, ${swipes - dock} on the surface)${failed ? " · run FAILED before the end" : ""}`);
  if (sorted.length) {
    const instant = sorted.filter((ms) => ms < 400).length;
    console.log(`  Landed card → PREVIEW: median ${pct(sorted, 0.5)} ms, p90 ${pct(sorted, 0.9)} ms, max ${sorted.at(-1)} ms; already live on landing (< 400 ms) ${instant}/${sorted.length}`);
  }
}
