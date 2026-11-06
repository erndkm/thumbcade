#!/usr/bin/env -S npx tsx
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { runReview } from "./review.ts";
import { shoot, type Action } from "./shoot.ts";
import { runWorker } from "./worker.ts";

const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<void> {
  if (command === "shoot") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { out: { type: "string" }, slug: { type: "string" }, actions: { type: "string" }, insets: { type: "boolean" }, device: { type: "string" }, "reduced-motion": { type: "boolean" } },
    });
    const dir = resolve(positionals[0] ?? "dist");
    const manifest = JSON.parse(await readFile(join(dir, "thumbcade.json"), "utf8")) as { id: string };
    const actions = values.actions ? (JSON.parse(await readFile(values.actions, "utf8")) as Action[]) : undefined;
    const r = await shoot({
      dir,
      slug: values.slug ?? manifest.id,
      outDir: resolve(values.out ?? "screenshots"),
      actions,
      insetsOverlay: values.insets,
      reducedMotion: values["reduced-motion"],
      device: values.device as "iphone" | undefined,
    });
    for (const f of r.files) console.log(f);
    for (const e of r.errors) console.error(`error: ${e}`);
    for (const c of r.console) console.log(`console ${c}`);
    return;
  }
  if (command === "review") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { out: { type: "string" }, json: { type: "boolean" } } });
    const dir = resolve(positionals[0] ?? "dist");
    const { report, screenshots, poster } = await runReview({ dir, log: (l) => !values.json && console.error(`… ${l}`) });
    if (values.out) {
      const out = resolve(values.out);
      await mkdir(out, { recursive: true });
      await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      for (const shot of screenshots) await writeFile(join(out, `${shot.name}.png`), shot.png);
      if (poster) await writeFile(join(out, "poster.jpg"), poster);
    }
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  if (command === "worker") {
    const { values } = parseArgs({ args: rest, options: { once: { type: "boolean" } } });
    await runWorker({ once: !!values.once });
    return;
  }
  console.error("usage: thumbcade-reviewer review <bundleDir> [--out dir] [--json]\n       thumbcade-reviewer worker [--once]\n       thumbcade-reviewer shoot <bundleDir> [--out dir] [--actions file.json] [--insets] [--reduced-motion]");
  process.exitCode = 2;
}

function printReport(report: Awaited<ReturnType<typeof runReview>>["report"]): void {
  const mark = { pass: "✓", fail: "✗", warn: "!", skip: "-" } as const;
  for (const c of report.checks) {
    console.log(`${mark[c.status]} ${c.label}`);
    if (c.detail && c.status !== "pass") for (const line of c.detail.split("\n")) console.log(`    ${line}`);
  }
  const m = report.metrics;
  console.log(`\nready ${m.readyMs ?? "—"} ms · fps ${m.fps ?? "—"} · longest task ${m.longestTaskMs ?? "—"} ms · heap ${m.heapBytes ? (m.heapBytes / 1048576).toFixed(1) : "—"} MB · first load ${m.initialPayloadGzipBytes ? Math.round(m.initialPayloadGzipBytes / 1024) : "—"} KB gz`);
  console.log(report.passed ? "PASSED" : "FAILED");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
