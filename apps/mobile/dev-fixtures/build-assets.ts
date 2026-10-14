/**
 * Builds the dev fixtures: copies the shared bridge/kit scripts into each game, renders the icon
 * (1024²) and poster (1080×1920) from SVG, validates the manifests and writes games-index.json in the
 * GamesIndex format so `pnpm seed` can consume the fixtures exactly like real launch games.
 *
 *   npx tsx apps/mobile/dev-fixtures/build-assets.ts      (from the repo root)
 */
import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { GamesIndexSchema, validateManifest, type GamesIndex } from "../../../packages/protocol/src/index.ts";

const root = dirname(fileURLToPath(import.meta.url));
const INK = "#0D0D10";
const PAPER = "#F3F0E8";
const DIM = "#A7A3AE";

interface Fixture {
  dir: string;
  creatorHandle: string;
  notes: string;
  art: (w: number, h: number, accent: string) => string;
}

function grid(w: number, h: number, step: number): string {
  let dots = "";
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) dots += `<rect x="${x}" y="${y}" width="3" height="3" fill="#24242B"/>`;
  return dots;
}

function ringArt(w: number, h: number, accent: string, cx: number, cy: number, r: number): string {
  let ticks = "";
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const r1 = r + r * 0.07;
    const r2 = r + r * (k % 6 === 0 ? 0.17 : 0.12);
    ticks += `<line x1="${cx + Math.cos(a) * r1}" y1="${cy + Math.sin(a) * r1}" x2="${cx + Math.cos(a) * r2}" y2="${cy + Math.sin(a) * r2}" stroke="${accent}" stroke-width="${r * 0.025}"/>`;
  }
  return `
    <circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="${accent}" fill-opacity="0.14"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="none" stroke="${PAPER}" stroke-width="${r * 0.035}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="${r * 0.06}"/>
    ${ticks}
    <rect x="${cx - r * 0.05}" y="${cy - r * 0.05}" width="${r * 0.1}" height="${r * 0.1}" fill="${accent}"/>`;
}

function laneArt(w: number, h: number, accent: string, mid: number, gap: number, scale: number): string {
  let s = "";
  for (let l = 0; l < 3; l++) {
    const y = mid + (l - 1) * gap;
    s += `<rect x="0" y="${y + gap / 2 - 2 * scale}" width="${w}" height="${4 * scale}" fill="#24242B"/>`;
    for (let x = 10; x < w; x += 96 * scale) s += `<rect x="${x}" y="${y - 2 * scale}" width="${44 * scale}" height="${4 * scale}" fill="#17171C"/>`;
  }
  const px = w * 0.24;
  const py = mid - gap;
  s += `<rect x="${w * 0.66}" y="${mid - gap * 0.36}" width="${48 * scale}" height="${gap * 0.72}" fill="${PAPER}"/>`;
  s += `<rect x="${w * 0.82}" y="${mid + gap - gap * 0.36}" width="${48 * scale}" height="${gap * 0.72}" fill="${PAPER}"/>`;
  s += `<rect x="${w * 0.5}" y="${mid + gap - 14 * scale}" width="${28 * scale}" height="${28 * scale}" fill="${accent}" transform="rotate(45 ${w * 0.5 + 14 * scale} ${mid + gap})"/>`;
  for (let t = 4; t >= 1; t--) s += `<rect x="${px - t * 28 * scale}" y="${py - (20 - t * 4) * scale}" width="${(20 - t * 2) * scale}" height="${(40 - t * 8) * scale}" fill="${accent}" fill-opacity="0.25"/>`;
  s += `<rect x="${px - 32 * scale}" y="${py - 32 * scale}" width="${64 * scale}" height="${64 * scale}" fill="${accent}"/>`;
  s += `<rect x="${px + 8 * scale}" y="${py - 16 * scale}" width="${12 * scale}" height="${12 * scale}" fill="${INK}"/>`;
  return s;
}

const FIXTURES: Fixture[] = [
  {
    dir: "tap-game",
    creatorHandle: "pixelwitch",
    notes: "First pulse. Perfect-hit combos, three lives, procedural blips.",
    art: (w, h, accent) => {
      const icon = w === h;
      const r = icon ? w * 0.3 : w * 0.3;
      const cy = icon ? h / 2 : h * 0.47;
      return `${grid(w, h, icon ? 64 : 60)}${ringArt(w, h, accent, w / 2, cy, r)}`;
    },
  },
  {
    dir: "swipe-game",
    creatorHandle: "juicefactory",
    notes: "Three lanes, sparks, walls, and a speed curve that keeps climbing.",
    art: (w, h, accent) => {
      const icon = w === h;
      return icon ? laneArt(w, h, accent, h / 2, h * 0.24, 2.2) : `${grid(w, h, 60)}${laneArt(w, h, accent, h * 0.5, h * 0.11, 2)}`;
    },
  },
];

function posterText(w: number, h: number, name: string, accent: string): string {
  return `
    <text x="${w / 2}" y="${h * 0.16}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-weight="900" font-size="${w * 0.1}" fill="${PAPER}" letter-spacing="-2">${name.toUpperCase()}</text>
    <text x="${w / 2}" y="${h * 0.16 + w * 0.06}" text-anchor="middle" font-family="Menlo, monospace" font-size="${w * 0.028}" fill="${DIM}" letter-spacing="3">THUMBCADE DEV FIXTURE</text>
    <text x="${w / 2}" y="${h * 0.86}" text-anchor="middle" font-family="Menlo, monospace" font-weight="700" font-size="${w * 0.038}" fill="${accent}" letter-spacing="4">TAP TO PLAY</text>`;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const entries: GamesIndex["games"] = [];
  for (const f of FIXTURES) {
    const dir = join(root, f.dir);
    copyFileSync(join(root, "_shared/bridge.js"), join(dir, "bridge.js"));
    copyFileSync(join(root, "_shared/kit.js"), join(dir, "kit.js"));
    const parsed = validateManifest(JSON.parse(readFileSync(join(dir, "thumbcade.json"), "utf8")));
    if (!parsed.ok) throw new Error(`${f.dir}: ${parsed.issues.join("; ")}`);
    const m = parsed.manifest;

    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${INK}"/>${f.art(1024, 1024, m.accentColor)}</svg>`;
    const posterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="${INK}"/>${f.art(1080, 1920, m.accentColor)}${posterText(1080, 1920, m.name, m.accentColor)}</svg>`;
    await sharp(Buffer.from(iconSvg)).png({ compressionLevel: 9 }).toFile(join(dir, m.icon));
    await sharp(Buffer.from(posterSvg)).jpeg({ quality: 86, mozjpeg: true }).toFile(join(dir, m.poster ?? "assets/poster.jpg"));

    const files = listFiles(dir)
      .map((p) => relative(dir, p))
      .filter((p) => !p.startsWith("."))
      .sort();
    let sizeBytes = 0;
    let gzipBytes = 0;
    for (const file of files) {
      const buf = readFileSync(join(dir, file));
      sizeBytes += buf.byteLength;
      gzipBytes += gzipSync(buf).byteLength;
    }
    entries.push({
      manifest: m,
      bundleDir: f.dir,
      files,
      icon: `${f.dir}/${m.icon}`,
      poster: `${f.dir}/${m.poster ?? "assets/poster.jpg"}`,
      sizeBytes,
      gzipBytes,
      creatorHandle: f.creatorHandle,
      notes: f.notes,
    });
    console.log(`built ${m.id}: ${files.length} files, ${(sizeBytes / 1024).toFixed(1)} KB (${(gzipBytes / 1024).toFixed(1)} KB gz)`);
  }
  const index = GamesIndexSchema.parse({ generatedAt: new Date().toISOString(), games: entries });
  writeFileSync(join(root, "games-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${join(root, "games-index.json")}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
