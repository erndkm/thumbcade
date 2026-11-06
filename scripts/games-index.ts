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

/**
 * Who "made" each game in the seeded world. Everything in the house style (games/_kit fonts and UI) belongs to the
 * studio; each other creator has a visual identity of their own that none of the others share.
 */
const CREATORS: Record<string, SeedCreatorHandle> = {
  // Thumbcade Studio: the house style.
  flapjack: "thumbcade",
  duskrail: "thumbcade",
  stackd: "thumbcade",
  heatfall: "thumbcade",
  kingsnare: "thumbcade",
  mines: "thumbcade",
  pairs: "thumbcade",
  shortwick: "thumbcade",
  "neon-chop": "thumbcade",
  voltbrick: "thumbcade",
  kneejerk: "thumbcade",
  snek: "thumbcade",
  clearcut: "thumbcade",
  spindart: "thumbcade",
  "six-seven": "thumbcade",
  laddersnap: "thumbcade",
  curlwall: "thumbcade",
  weavefire: "thumbcade",
  rimflare: "thumbcade",
  clatterlane: "thumbcade",
  // Hand-placed pixel art, bitmap type, cozy palette.
  stirabout: "pixelwitch",
  bobberlight: "pixelwitch",
  frostwhisk: "pixelwitch",
  // Voxel dioramas under an isometric camera.
  foxbend: "lowpolyfox",
  paddlefox: "lowpolyfox",
  clackwood: "lowpolyfox",
  // Paper, ink and a serif.
  "every-square": "quietmoves",
  unbroken: "quietmoves",
  "fair-copy": "quietmoves",
  overstamp: "quietmoves",
  // Loud cartoon: thick outlines, halftone, sticker type.
  thunkfest: "juicefactory",
  "wobble-up": "juicefactory",
  brinebop: "juicefactory",
  lintstorm: "juicefactory",
  // Layered silhouettes against a moving sky. Its own look, but published by the studio.
  lanternline: "thumbcade",
  // Claymation: sculpted clay, soft studio light, thumbprints, Fredoka on clay plaques.
  squishputt: "softbake",
  pinchbake: "softbake",
  // Ballpoint doodles on notebook paper.
  doodlebow: "marginalia",
  pagewing: "marginalia",
  tumbledoodle: "marginalia",
  // Risograph prints: a few spot inks overprinting on warm paper, halftone tints, slightly off register.
  leapwater: "bitbybit",
  longhop: "bitbybit",
  halftune: "bitbybit",
  spotfall: "bitbybit",
};

const NOTES: Record<string, string> = {
  flapjack: "Opening night at the diner. The forks are polished and the syrup is warm.",
  stackd: "First tower. Perfect drops grow the slab back, so stay sharp.",
  duskrail: "The viaduct is open. Rovers show up once you get fast.",
  kingsnare: "64 hand-checked mates, plus a new opener every day.",
  pairs: "Five board sizes and a lot of very similar shapes.",
  shortwick: "The fuse is lit. Merges buy you time, dead swipes burn it.",
  snek: "Golden bonus every fifth bite. Rocks after the sixth.",
  "neon-chop": "The Glow Market is open. Surge cells arc into the produce around them. Mind the static.",
  voltbrick: "Seven layouts, five power-ups, one very angry chain multiplier.",
  heatfall: "New alloy every ten grates. Melting through one vents the heat front.",
  kneejerk: "Four tests, one thumb, three lives.",
  mines: "8×12, fifteen mines, first tap always safe.",
  clearcut: "First board. Cut on back-to-back drops and the streak multiplies, so don't let the fuse catch you thinking.",
  spindart: "First disc. Lit cells pay three, bosses pay five, steel pays nothing.",
  "six-seven": "First bell. Left hand six, right hand seven, hands still when the teacher looks. Sixty-seven gets a party.",
  laddersnap: "First deal. Kings go on aces, every hand can be cleared, and the next card is always face up. Chain without drawing.",
  curlwall: "Floodlights on. Two free kicks to find your flick, three balls after that, and the rings in the top corners hand one back.",
  weavefire: "First thread. Five gun levels to fly into, pink to skim for sparks, a Loom with six arms to break, and an overdrive that never cools.",
  rimflare: "Lights on over the rooftop court. Swishes buy back the most time, three in a row sets the ball alight, and the city wakes up one window per bucket.",
  clatterlane: "Lane lights on. Strikes buy time, a turkey turns the lights pink, every fifth rack glows, and the bumpers stay up for your first two racks.",
  lanternline: "first light. one line, one thumb, one long day. the lanterns are waiting.",
  leapwater: "first print: one koi, a long stream, and falls that climb on into the night. dive deep, let go, leap.",
  longhop: "first print run. one kangaroo, one joey, and a horizon that keeps going. hold as you land, let go at the bottom.",
  halftune: "first pressing: four old tunes, one strike line, and an encore if you make it through the mountain king. every tile you tap is a note.",
  spotfall: "first sheet off the drum: six inks from three, a squid who supplies them, and a press that never waits. pop three, and whatever hung from them falls.",
  doodlebow:
    "Version 1.0: I drew a tiny archer in the margin of my math homework, gave him ten arrows, and he has not stopped asking for more targets since.",
  pagewing:
    "Version 1.0: I folded last week's homework into a plane, drew it some warm air to ride, and it has been doing loops in the margins ever since. Please don't tell my teacher.",
  tumbledoodle:
    "Version 1.0: a hole tore open in the middle of my homework and started eating the margins. Thirty-one doodles, three erasers and, once, the moon. I keep drawing more.",
  "every-square": "first edition: one knight, sixty-four squares, and a clock that burns quietly along the edge of the board.",
  unbroken: "first printing: grids from four by four to six by eight, a pen that never lifts, and a seal for every puzzle you finish.",
  "fair-copy": "first proof: sixteen letters, seventy seconds on the clock, a dictionary that forgives, and a seal for every fourth word you write.",
  overstamp: "first filing: twelve marks of my own, a tray of seven, and a heap that only ever deals what can be cleared. three alike get the seal.",
  foxbend: "First release: the pond is fully voxelized, the stones place themselves, and the fox now treads water instead of quietly vanishing.",
  paddlefox: "First release: procedurally meandering river, beaver dams with exactly one gap, and a canoe that capsizes with as much dignity as I could model.",
  clackwood:
    "First release: a pool table built from logs in a clearing, knot-hole pockets, a clock that every pot winds back, and a beaver who has opinions about bank shots.",
  stirabout: "first brew is out ~ seven ingredients, one very unhelpful cat, and a little waltz i hummed while drawing the cauldron.",
  bobberlight: "a quiet night on the pond ~ four kinds of fish (one of them golden), fireflies, and the same cat, now holding a rod.",
  frostwhisk:
    "the pond froze over ~ so the cat got a copper lid, the moon lent us a stone, and five critters lined up to play. pip is a pushover. rascal is not.",
  thunkfest:
    "HARD HATS ON, GOPHERS: VERSION ONE SWINGS IN WITH A GIANT MALLET, GOLDEN GOPHERS WORTH A FORTUNE AND BUNNIES YOU ABSOLUTELY SHOULD NOT THUNK!",
  "wobble-up":
    "FRESH OUT OF THE MOLD: one pink jelly, a pocket full of springs and a sky full of grumpy clouds, so DRAG, BOING AND GO GET THOSE CHERRIES!",
  brinebop:
    "LOW TIDE, HIGH SCORES: SIX GOOGLY CRITTERS, ONE VERY LOUD CONCH AND SIXTY SECONDS ON THE CLOCK. EVERY SPECIAL YOU SAVE GOES KA-BLAM AT THE BUZZER!",
  lintstorm:
    "THE DRYER BURST AND THE SOCKS WANT REVENGE: VERSION ONE IRONS IN WITH ONE BRAVE STEAM IRON, A POCKET FULL OF LOOSE CHANGE AND THREE BOSSES WHO REALLY NEED A PRESS!",
  squishputt: "Our first batch is out of the oven: twelve hand-squished holes, one very nosy frog, and a windmill we only had to rebuild four times.",
  pinchbake: "Second batch is out: nine clay bakes, one sourdough starter that will not stop rising, and a party cake we have only made twice. Squish twins, keep it down.",
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
