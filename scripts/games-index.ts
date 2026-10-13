/**
 * `pnpm games:build` (after turbo builds every games/* package):
 *   dist/games/<slug>/bundle/...   the built game, thumbcade.json at the root, poster included
 *   dist/games/<slug>/icon.png     1024×1024 (rendered from games/<slug>/art/icon.svg at build time)
 *   dist/games/<slug>/poster.jpg   1080×1920, captured from attract mode in headless Chromium
 *   dist/games/games-index.json    GamesIndex (packages/protocol), consumed by `pnpm seed`
 *
 * Flags: --review   also run the full automated reviewer on every game and fail on any failed check
 *        --only a,b only these slugs
 * Owner: Creator & Games (B).
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { GamesIndexSchema, SEED_CREATORS, validateManifest, type GamesIndex, type GamesIndexEntry, type SeedCreatorHandle } from "@thumbcade/protocol";
import { capturePoster, launchBrowser, runReview } from "@thumbcade/reviewer";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GAMES = join(ROOT, "games");
const OUT = join(ROOT, "dist", "games");

/** Who "made" each launch game in the seeded world (spread across SEED_CREATORS; the studio owns a few). */
const CREATORS: Record<string, SeedCreatorHandle> = {
  flapjack: "thumbcade",
  "lane-rush": "thumbcade",
  stackd: "lowpolyfox",
  "helix-fall": "lowpolyfox",
  gambit: "quietmoves",
  mines: "quietmoves",
  pairs: "pixelwitch",
  merge: "pixelwitch",
  slice: "juicefactory",
  "breakout-neo": "juicefactory",
  reflex: "bitbybit",
  snek: "bitbybit",
};

const NOTES: Record<string, string> = {
  flapjack: "Opening night at the diner. The forks are polished and the syrup is warm.",
  stackd: "First tower. Perfect drops grow the slab back, so stay sharp.",
  "lane-rush": "The viaduct is open. Rovers show up once you get fast.",
  gambit: "64 hand-checked mates, plus a new opener every day.",
  pairs: "Five board sizes and a lot of very similar shapes.",
  merge: "The fuse is lit. Merges buy you time, dead swipes burn it.",
  snek: "Golden bonus every fifth bite. Rocks after the sixth.",
  slice: "The Glow Market is open. Mind the static.",
  "breakout-neo": "Seven layouts, five power-ups, one very angry chain multiplier.",
  "helix-fall": "Ring colours change every ten. The heat front doesn't wait.",
  reflex: "Four tests, one thumb, three lives.",
  mines: "8×12, fifteen mines, first tap always safe.",
};

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  }
  await walk(dir);
  return out.sort();
}

function pngSize(buf: Buffer): [number, number] | null {
  return buf.readUInt32BE(0) === 0x89504e47 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const review = args.includes("--review");
  const onlyArg = args.find((a) => a.startsWith("--only"));
  const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1]! : args[args.indexOf(onlyArg) + 1]!).split(",") : null;
  const known = new Set<string>(SEED_CREATORS.map((c) => c.handle));

  const slugs = (await readdir(GAMES, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name)
    .filter((s) => !only || only.includes(s))
    .sort();

  await mkdir(OUT, { recursive: true });
  const browser = await launchBrowser();
  const entries: GamesIndexEntry[] = [];
  const failures: string[] = [];
  try {
    for (const slug of slugs) {
      const built = join(GAMES, slug, "dist");
      if (!existsSync(join(built, "thumbcade.json"))) throw new Error(`${slug}: no build at games/${slug}/dist (run turbo build first)`);
      const raw = JSON.parse(await readFile(join(built, "thumbcade.json"), "utf8")) as Record<string, unknown>;
      const v = validateManifest(raw);
      if (!v.ok) throw new Error(`${slug}: invalid thumbcade.json\n  ${v.issues.join("\n  ")}`);
      if (v.manifest.id !== slug) throw new Error(`${slug}: manifest id "${v.manifest.id}" must match the folder name`);
      const creatorHandle = CREATORS[slug];
      if (!creatorHandle || !known.has(creatorHandle)) throw new Error(`${slug}: no seed creator assigned in scripts/games-index.ts`);

      const target = join(OUT, slug);
      const bundle = join(target, "bundle");
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      await cp(built, bundle, { recursive: true });

      const icon = await readFile(join(bundle, v.manifest.icon));
      const size = pngSize(icon);
      if (!size || size[0] !== 1024 || size[1] !== 1024) throw new Error(`${slug}: icon must be a 1024×1024 PNG`);
      await writeFile(join(target, "icon.png"), icon);

      process.stdout.write(`${slug.padEnd(14)} poster`);
      const poster = await capturePoster(bundle, browser);
      await writeFile(join(target, "poster.jpg"), poster);
      // Ship the poster inside the bundle too, and declare it, so the bundle is self-describing.
      await mkdir(join(bundle, "assets"), { recursive: true });
      await writeFile(join(bundle, "assets", "poster.jpg"), poster);
      const manifestRaw = { ...raw, poster: "assets/poster.jpg" };
      await writeFile(join(bundle, "thumbcade.json"), `${JSON.stringify(manifestRaw, null, 2)}\n`);
      const manifest = validateManifest(manifestRaw);
      if (!manifest.ok) throw new Error(`${slug}: manifest with poster failed validation`);

      if (review) {
        process.stdout.write(" · review");
        const { report } = await runReview({ dir: bundle, browser });
        await writeFile(join(target, "review.json"), `${JSON.stringify(report, null, 2)}\n`);
        const bad = report.checks.filter((c) => c.status === "fail");
        if (bad.length) failures.push(`${slug}: ${bad.map((c) => c.label).join(", ")}`);
        process.stdout.write(report.passed ? " ✓" : " ✗");
      }

      const files = await listFiles(bundle);
      let sizeBytes = 0;
      let gzipBytes = 0;
      for (const f of files) {
        const data = await readFile(join(bundle, f));
        sizeBytes += (await stat(join(bundle, f))).size;
        gzipBytes += gzipSync(data, { level: 9 }).length;
      }
      entries.push({
        manifest: manifest.manifest,
        bundleDir: `${slug}/bundle`,
        files,
        icon: `${slug}/icon.png`,
        poster: `${slug}/poster.jpg`,
        sizeBytes,
        gzipBytes,
        creatorHandle,
        notes: NOTES[slug] ?? "First release.",
      });
      process.stdout.write(` · ${files.length} files, ${(gzipBytes / 1024).toFixed(0)} KB gz\n`);
    }
  } finally {
    await browser.close();
  }

  const index: GamesIndex = GamesIndexSchema.parse({ generatedAt: new Date().toISOString(), games: entries });
  await writeFile(join(OUT, "games-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`\n${entries.length} games -> ${relative(ROOT, join(OUT, "games-index.json"))}`);
  if (failures.length) {
    console.error(`\nReview failures:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
