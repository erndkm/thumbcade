/**
 * Builds Galley Proof's word lists from the same pinned public sources as Fair Copy:
 *
 *   pnpm --filter @thumbcade-games/galley-proof words
 *
 * Sources (downloaded once into node_modules/.cache/fair-copy-words, checked against their sha256; the cache is
 * shared with Fair Copy's build because the files are identical):
 * - ENABLE2K (Enhanced North American Benchmark LExicon, 2000 edition, WORD.LST): public domain. The original host is
 *   gone; the author's own archive is kept by the Internet Archive.
 * - SCOWL 2020.12.07 (Spell Checker Oriented Word Lists, Kevin Atkinson): MIT-like license, see its Copyright file.
 *
 * Writes:
 * - src/data/answers.txt  the words a slip can hide: SCOWL's english list (the words every dialect shares) up to size
 *                         35, five letters, minus inflected forms (plain plurals and third persons, past forms,
 *                         -ing forms, comparatives), minus the hard and soft words and minus the hand-picked
 *                         exclusions in scripts/answers.ts (obscure, awkward, sad or slur-adjacent). One per line.
 * - src/data/accept.txt   every five-letter word a guess may be: ENABLE2K ∪ SCOWL english/american/british/
 *                         british_z/canadian up to size 70, minus the hard words. Packed five letters per word with
 *                         no separators, sorted, so the game searches it in place.
 * - public/licenses/words.txt credits and license texts (copied into every bundle).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXCLUDE, KEEP } from "./answers.ts";
import { FORMS, HARD, HARD_STEMS, SOFT } from "./blocklist.ts";

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
const words = (text: string) => text.split(/\r?\n/).map((w) => w.trim());
const five = (w: string) => w.length === 5 && PURE.test(w);

/**
 * Is `w` an inflected form of a word in `base`? Plain plurals and third persons (cats, boxes, flies), past forms
 * (acted, baked, tried, ebbed), -ing forms (doing, owing, lying) and -er comparatives of -e adjectives (safer,
 * wider). Words that only look like one (glass, bonus, creed, thing, water) stay.
 */
export function inflected(w: string, base: ReadonlySet<string>): boolean {
  const has = (s: string) => s.length >= 2 && base.has(s);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
    if (has(w.slice(0, -1))) return true;
    if (w.endsWith("es") && has(w.slice(0, -2))) return true;
    if (w.endsWith("ies") && has(`${w.slice(0, -3)}y`)) return true;
  }
  if (w.endsWith("ed")) {
    if (has(w.slice(0, -2)) || has(w.slice(0, -1))) return true;
    if (w.endsWith("ied") && has(`${w.slice(0, -3)}y`)) return true;
    if (w[1] === w[2] && has(w.slice(0, 2))) return true;
  }
  if (w.endsWith("ing")) {
    const stem = w.slice(0, -3);
    if (has(stem) || has(`${stem}e`)) return true;
    if (w.endsWith("ying") && has(`${w.slice(0, -4)}ie`)) return true;
  }
  if (COMPARATIVE.has(w)) return true;
  return false;
}

/** -er comparatives that the stem rule can't tell apart from agent nouns (baker, diner, rider stay). */
const COMPARATIVE = new Set(["safer", "wider", "finer", "rarer", "riper", "surer", "truer", "nicer", "purer", "tamer", "lamer", "freer", "paler", "abler", "rifer", "ruder", "wiser", "cuter", "sorer", "direr", "older", "drier", "shyer", "icier", "dryer", "slyer", "wryer", "fewer", "nearer"]);

async function main() {
  const enableZip = await fetchPinned(SOURCES.enable);
  const scowlTar = await fetchPinned(SOURCES.scowl);

  const enable = words(member(enableZip, "WORD.LST", "latin1"));
  const scowl = (dialects: string[], sizes: number[]) => {
    const out: string[] = [];
    for (const d of dialects) for (const n of sizes) for (const w of words(member(scowlTar, `scowl-2020.12.07/final/${d}-words.${n}`, "latin1"))) out.push(w);
    return out;
  };
  const shared = scowl(["english"], [10, 20, 35]).filter(five);
  const broad = scowl(["english", "american", "british", "british_z", "canadian"], [10, 20, 35, 40, 50, 55, 60, 70]);
  // Stems for the inflection test: any common word of any length.
  const stems = new Set(scowl(["english", "american", "british"], [10, 20, 35, 40, 50]).filter((w) => PURE.test(w)));
  const everything = new Set([...enable, ...broad, ...scowl(["english", "american", "british"], [80, 95])].filter((w) => PURE.test(w)));

  const hard = new Set<string>();
  for (const h of HARD) for (const f of FORMS) hard.add(h + f);
  for (const w of everything) if (HARD_STEMS.some((s) => w.includes(s))) hard.add(w);
  const soft = new Set<string>();
  for (const w of SOFT) for (const f of FORMS) soft.add(w + f);

  const accept = [...new Set([...enable, ...broad].filter(five))].filter((w) => !hard.has(w)).sort();
  const acceptSet = new Set(accept);
  const exclude = new Set(EXCLUDE);
  const keep = new Set(KEEP);
  for (const w of [...exclude, ...keep]) if (!five(w)) throw new Error(`scripts/answers.ts: "${w}" is not five letters a-z`);
  const answers = [...new Set(shared)]
    .filter((w) => acceptSet.has(w) && !hard.has(w) && !soft.has(w) && !exclude.has(w) && (keep.has(w) || !inflected(w, stems)))
    .sort();
  const stale = [...exclude].filter((w) => !shared.includes(w));
  if (stale.length) console.log(`note: ${stale.length} exclusions are not candidates anyway: ${stale.slice(0, 20).join(" ")}`);

  const data = join(ROOT, "src", "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "answers.txt"), `${answers.join("\n")}\n`);
  writeFileSync(join(data, "accept.txt"), accept.join(""));

  // Credits travel with the bundle.
  const enableReadme = member(enableZip, "README", "latin1").replace(/\r\n/g, "\n");
  const scowlCopyright = member(scowlTar, "scowl-2020.12.07/Copyright", "latin1");
  const licenses = join(ROOT, "public", "licenses");
  mkdirSync(licenses, { recursive: true });
  writeFileSync(
    join(licenses, "words.txt"),
    [
      "Galley Proof word lists",
      "=======================",
      "",
      "The words Galley Proof accepts and the words it hides are built from two word lists (scripts/words.ts in the",
      "game's source): the ENABLE2K word list and SCOWL. Words were filtered (five letters a-z), a blocklist of slurs",
      "and profanity was removed, and the hidden words were picked by hand from SCOWL's most common words. The",
      "blocklist was checked against SCOWL's own offensive and profane flags and against the \"List of Dirty, Naughty,",
      'Obscene, and Otherwise Bad Words" © 2012-2020 Shutterstock, Inc.',
      "(https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words), licensed under CC BY 4.0",
      "(https://creativecommons.org/licenses/by/4.0/); none of its text ships here.",
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
  console.log(`accept  ${accept.length} words, ${(gz("accept.txt") / 1024).toFixed(1)} KB gz`);
  console.log(`answers ${answers.length} words, ${(gz("answers.txt") / 1024).toFixed(1)} KB gz`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
