/**
 * Builds Fair Copy's word lists from pinned public sources:
 *
 *   pnpm --filter @thumbcade-games/fair-copy words
 *
 * Sources (downloaded once into node_modules/.cache/fair-copy-words, checked against their sha256):
 * - ENABLE2K (Enhanced North American Benchmark LExicon, 2000 edition, WORD.LST): public domain. The original host is
 *   gone; the author's own archive is kept by the Internet Archive.
 * - SCOWL 2020.12.07 (Spell Checker Oriented Word Lists, Kevin Atkinson): MIT-like license, see its Copyright file.
 *
 * Writes:
 * - src/data/accept.txt  every word we accept: ENABLE2K ∪ SCOWL english/american/british words up to size 70, 3-16
 *                        letters, a-z only, every q followed by u (a board can't spell anything else).
 * - src/data/common.txt  what boards are seeded from and what "words you missed" reveals: SCOWL english + american
 *                        words up to size 35. Words up to size 20 (everyday words) end in "." in this file.
 * - src/data/blocked.json FNV-1a hashes of the hard words (and their prefixes) no board may spell along any path,
 *                        and of the mild ones no board may show along a straight line.
 * - public/licenses/words.txt credits and license texts (copied into every bundle).
 * Hard words are removed from both lists; soft words only from the common list (scripts/blocklist.ts).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fnv } from "../src/hash.ts";
import { FORMS, HARD, HARD_STEMS, MILD, SOFT } from "./blocklist.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "..", "..", "node_modules", ".cache", "fair-copy-words");

const SOURCES = {
  enable: {
    url: "https://web.archive.org/web/20051109231624id_/http://personal.riverusers.com:80/~thegrendel/enable2k.zip",
    file: "enable2k.zip",
    sha256: "44e2dd5c16c14336e8d4075a2f625af55a47cbb8b9f9ebcb7fcc3b5b1e1f0e5e",
  },
  scowl: {
    url: "https://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz",
    file: "scowl-2020.12.07.tar.gz",
    sha256: "5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc",
  },
} as const;

async function fetchPinned(s: { url: string; file: string; sha256: string }): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, s.file);
  if (!existsSync(path)) {
    console.log(`downloading ${s.url}`);
    const res = await fetch(s.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${s.url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const sum = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (sum !== s.sha256) throw new Error(`${s.file}: sha256 ${sum}, expected ${s.sha256}`);
  return path;
}

/** Text of one archive member (unzip / tar print to stdout; nothing from the archive is ever executed). */
function member(archive: string, name: string, encoding: BufferEncoding): string {
  const out = archive.endsWith(".zip")
    ? execFileSync("unzip", ["-p", archive, name], { maxBuffer: 64 << 20 })
    : execFileSync("tar", ["-xzOf", archive, name], { maxBuffer: 64 << 20 });
  return out.toString(encoding);
}

const PURE = /^[a-z]+$/;
/** Words a board can actually spell: 3-16 letters, and every q rides with its u (the Qu tile). */
const spellable = (w: string) => PURE.test(w) && w.length >= 3 && w.length <= 16 && !/q(?!u)/.test(w);
const words = (text: string) => text.split(/\r?\n/).map((w) => w.trim());

async function main() {
  const enableZip = await fetchPinned(SOURCES.enable);
  const scowlTar = await fetchPinned(SOURCES.scowl);

  const enable = words(member(enableZip, "WORD.LST", "latin1"));
  const scowl = (dialects: string[], sizes: number[]) => {
    const out: string[] = [];
    for (const d of dialects) for (const n of sizes) for (const w of words(member(scowlTar, `scowl-2020.12.07/final/${d}-words.${n}`, "latin1"))) out.push(w);
    return out;
  };
  const everyday = new Set(scowl(["english", "american"], [10, 20]).filter(spellable));
  const common35 = new Set(scowl(["english", "american"], [10, 20, 35]).filter(spellable));
  const broad = scowl(["english", "american", "british", "british_z", "canadian"], [10, 20, 35, 40, 50, 55, 60, 70]);
  // Everything any source knows, for finding blocked stems inside longer words.
  const everything = new Set([...enable, ...broad, ...scowl(["english", "american", "british"], [80, 95])].filter((w) => PURE.test(w)));

  const hard = new Set<string>();
  for (const h of HARD) for (const f of FORMS) hard.add(h + f);
  for (const w of everything) if (HARD_STEMS.some((s) => w.includes(s))) hard.add(w);
  for (const s of HARD_STEMS) hard.add(s);
  const soft = new Set<string>();
  for (const w of SOFT) for (const f of FORMS) soft.add(w + f);

  const accept = [...new Set([...enable, ...broad, ...common35].filter(spellable))].filter((w) => !hard.has(w)).sort();
  const common = [...common35].filter((w) => !hard.has(w) && !soft.has(w)).sort();

  const data = join(ROOT, "src", "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "accept.txt"), `${accept.join("\n")}\n`);
  writeFileSync(join(data, "common.txt"), `${common.map((w) => (everyday.has(w) ? `${w}.` : w)).join("\n")}\n`);

  // The board check: a board must not spell a hard word along any path. Ship hashes, not the words.
  const blockedWords = [...hard].filter((w) => w.length >= 3 && PURE.test(w) && !/q(?!u)/.test(w) && (everything.has(w) || HARD.includes(w) || HARD_STEMS.includes(w)));
  const mild = new Set(MILD);
  const prefixes = new Set<number>();
  const full = new Set<number>();
  const lines = new Set<number>();
  for (const w of blockedWords) {
    if (mild.has(w)) {
      lines.add(fnv(w));
      continue;
    }
    full.add(fnv(w));
    for (let i = 1; i <= w.length; i++) prefixes.add(fnv(w.slice(0, i)));
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  writeFileSync(join(data, "blocked.json"), `${JSON.stringify({ prefixes: sorted(prefixes), words: sorted(full), lines: sorted(lines) })}\n`);

  // Credits travel with the bundle.
  const enableReadme = member(enableZip, "README", "latin1").replace(/\r\n/g, "\n");
  const scowlCopyright = member(scowlTar, "scowl-2020.12.07/Copyright", "latin1");
  const licenses = join(ROOT, "public", "licenses");
  mkdirSync(licenses, { recursive: true });
  writeFileSync(
    join(licenses, "words.txt"),
    [
      "Fair Copy word lists",
      "====================",
      "",
      "The words Fair Copy accepts and the boards it deals are built from two word lists (scripts/words.ts in the",
      "game's source): the ENABLE2K word list and SCOWL. Words were filtered (letters a-z, 3-16 letters) and a",
      "blocklist of slurs and profanity was removed. The blocklist was checked against SCOWL's own offensive and",
      'profane flags and against the "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" © 2012-2020',
      "Shutterstock, Inc. (https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words),",
      "licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); none of its text ships here.",
      "",
      "",
      "1. ENABLE2K (Enhanced North American Benchmark LExicon), WORD.LST, 2000 edition",
      "-------------------------------------------------------------------------------",
      "",
      "Compiled by Alan Beale and M. Cooper. Public domain. The README that ships with it:",
      "",
      enableReadme.trim(),
      "",
      "",
      "2. SCOWL (Spell Checker Oriented Word Lists) 2020.12.07, by Kevin Atkinson",
      "--------------------------------------------------------------------------",
      "",
      "Sizes 10-70 of the english, american, british, british_z and canadian word lists. Its Copyright file:",
      "",
      scowlCopyright.trim(),
      "",
    ].join("\n"),
  );

  const gz = (f: string) => execFileSync("gzip", ["-9c", join(data, f)]).length;
  console.log(`accept  ${accept.length} words, ${(readFileSync(join(data, "accept.txt")).length / 1024).toFixed(0)} KB, ${(gz("accept.txt") / 1024).toFixed(0)} KB gz`);
  console.log(`common  ${common.length} words (${common.filter((w) => everyday.has(w)).length} everyday), ${(gz("common.txt") / 1024).toFixed(0)} KB gz`);
  console.log(`blocked ${blockedWords.length} words, ${prefixes.size} prefix hashes`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
