/**
 * Third-party notices for the apps we distribute (mobile app, portal).
 *
 * Collects every package in a workspace project's production dependency closure: resolved by pnpm
 * (`pnpm licenses list --prod`, which reads the lockfile) and followed through our own workspace
 * packages. Workspace packages themselves, dev dependencies and platform-specific build binaries
 * (packages with `os`/`cpu` constraints, e.g. lightningcss-darwin-arm64) are left out. For each package
 * it reads the licence and notice files the package ships (LICENSE, LICENCE, COPYING, NOTICE and their
 * variants). A package that ships none gets the SPDX standard text of its declared licence with the
 * copyright line from its README, its source file headers or its package.json author, and is flagged.
 * Fonts, native libraries inside npm packages and code that packages vendor (Next.js) are added from
 * the tables below.
 *
 * Output is a TypeScript module, checked in, that the app renders. Each distinct text is stored once and
 * split into paragraphs that are shared between texts: every text (copyright lines included) stays
 * byte-exact while the module shrinks to under half of the plain deduplicated size.
 *
 *   node scripts/licenses/collect.ts <project dir> <output .ts> [--check]
 *   (wired up as `pnpm --filter <app> notices`; not "licenses", which is a pnpm built-in)
 *
 * --check regenerates in memory and exits 1 when the checked-in module is stale.
 */
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");

export type NoticeKind = "package" | "font" | "native" | "bundled";
/** Where the copyright line of a standard licence text came from, for packages without a licence file. */
export type Fallback = "readme" | "source" | "author" | "none";

export interface NoticeFile {
  name: string;
  text: string;
}

export interface Notice {
  name: string;
  /** Empty for code bundled inside another package without a version of its own (see `note`). */
  version: string;
  license: string;
  kind: NoticeKind;
  note?: string;
  homepage?: string;
  fallback?: Fallback;
  files: NoticeFile[];
}

interface PackageJson {
  name?: string;
  version?: string;
  license?: unknown;
  licenses?: unknown;
  author?: unknown;
  homepage?: unknown;
  repository?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  os?: unknown;
  cpu?: unknown;
  libc?: unknown;
  skia?: { version?: string };
}

/** Assets our workspace packages ship that are not npm packages: added when the workspace package is in the closure. */
const ASSETS: Record<string, { name: string; version: string; license: string; homepage: string; file: string }[]> = {
  "@thumbcade/design-tokens": [
    { name: "Mona Sans", version: "2.0.27", license: "OFL-1.1", homepage: "https://github.com/github/mona-sans", file: "packages/design-tokens/fonts/OFL-MonaSans.txt" },
    { name: "Departure Mono", version: "1.500", license: "OFL-1.1", homepage: "https://github.com/rektdeckard/departure-mono", file: "packages/design-tokens/fonts/OFL-DepartureMono.txt" },
  ],
};

/** Native libraries shipped prebuilt inside npm packages whose own metadata does not carry their notice. */
const NATIVE: { name: string; license: string; homepage: string; file: string; packages: RegExp; version: (pkg: PackageJson) => string; note: string }[] = [
  {
    name: "Skia",
    license: "BSD-3-Clause",
    homepage: "https://skia.org",
    file: "scripts/licenses/native/skia.txt",
    packages: /^react-native-skia-(android|apple-[a-z]+)$/,
    version: (pkg) => pkg.skia?.version ?? "",
    note: "prebuilt graphics library in react-native-skia-android and react-native-skia-apple-*",
  },
];

/** Packages that vendor other packages' code into a directory of their own. */
const BUNDLED: Record<string, string> = { next: "dist/compiled" };

/** Standard texts for packages that ship no licence file, and what to do with the copyright line. */
const TEMPLATES: Record<string, "replace" | "prepend" | "omit"> = {
  MIT: "replace",
  ISC: "replace",
  "BSD-2-Clause": "replace",
  "BSD-3-Clause": "replace",
  "0BSD": "replace",
  "Apache-2.0": "prepend",
  "BlueOak-1.0.0": "prepend",
  Unlicense: "omit",
  "CC0-1.0": "omit",
};

const NOTICE_FILE = /^(licen[cs]e|copying|notice)([-._][\w.-]*)?$/i;
const NOT_TEXT = /\.(html?|js|cjs|mjs|json|ts|png|svg)$/i;
const MAX_TEXT = 512 * 1024;
const SOURCE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".flow", ".kt", ".java", ".swift", ".m", ".mm", ".h", ".hpp", ".c", ".cc", ".cpp", ".css"]);

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

/** Strips a BOM, unifies line endings, drops trailing whitespace and surrounding blank lines. The wording is untouched. */
export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/^\n+/, "")
    .trimEnd();
}

/** The copyright notice on a line (comment markers and markdown stripped), or null. */
export function copyrightLine(raw: string): string | null {
  const line = raw
    .replace(/^[\s/*#>!;-]+/, "")
    .replace(/\s*\*\/\s*$/, "")
    .replace(/^(\*\*|__)|(\*\*|__)$/g, "")
    .trim();
  if (!/^(copyright\b|\(c\)\s|©)/i.test(line) || line.length > 200) return null;
  if (/copyright (notice|holder|owner|law|and related|statement|licen[cs]e)|<year>|<owner>|\[yyyy\]/i.test(line)) return null;
  if (!/[A-Za-z]{2,}/.test(line.replace(/^(copyright|\(c\)|©)/i, ""))) return null;
  return line;
}

/** First bytes of a file (license headers sit at the top; some bundles are megabytes). */
function head(path: string, bytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function sortedEntries(dir: string) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The most common copyright lines in the headers of a package's source files. */
function sourceCopyright(dir: string): string[] {
  const counts = new Map<string, number>();
  let files = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 5) return;
    for (const e of sortedEntries(d)) {
      if (files >= 400) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && SOURCE_EXT.has(extname(e.name)) && !e.name.endsWith(".d.ts")) {
        files++;
        for (const l of head(p, 2048).split("\n")) {
          const c = copyrightLine(l);
          if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      }
    }
  };
  walk(dir, 0);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([l]) => l);
}

function authorName(author: unknown): string | null {
  const raw = typeof author === "string" ? author : typeof author === "object" && author && "name" in author ? String((author as { name: unknown }).name) : null;
  const name = raw?.replace(/<[^>]*>|\([^)]*\)/g, "").trim();
  return name || null;
}

/** Copyright lines for a package without a licence file, and where they came from. */
function findCopyright(dir: string, pkg: PackageJson): { lines: string[]; from: Fallback } {
  const readme = readdirSync(dir).find((f) => /^readme(\.|$)/i.test(f));
  if (readme) {
    const lines = [...new Set(normalizeText(readFileSync(join(dir, readme), "utf8")).split("\n").map(copyrightLine).filter((l): l is string => !!l))].slice(0, 3);
    if (lines.length) return { lines, from: "readme" };
  }
  const source = sourceCopyright(dir);
  if (source.length) return { lines: source, from: "source" };
  const author = authorName(pkg.author);
  if (author) return { lines: [`Copyright (c) ${author}`], from: "author" };
  return { lines: [], from: "none" };
}

function template(id: string): string | null {
  const path = join(HERE, "spdx", `${id}.txt`);
  return TEMPLATES[id] && existsSync(path) ? normalizeText(readFileSync(path, "utf8")) : null;
}

/** The SPDX ids whose texts apply: every part of an AND, the first option of an OR that has a template. */
export function licenseIds(expression: string): string[] {
  const clean = expression.replace(/[()]/g, " ").trim();
  if (/\sAND\s/i.test(clean)) return clean.split(/\s+AND\s+/i).map((s) => s.trim());
  const options = clean.split(/\s+OR\s+/i).map((s) => s.trim());
  return [options.find((id) => TEMPLATES[id]) ?? options[0] ?? clean];
}

/** A standard licence text with the copyright lines filled in. */
export function fillTemplate(text: string, mode: "replace" | "prepend" | "omit", copyright: string[]): string {
  if (mode === "omit") return text;
  if (mode === "prepend") return copyright.length ? `${copyright.join("\n")}\n\n${text}` : text;
  const lines = text.split("\n");
  const at = lines.findIndex((l, i) => i < 6 && /^copyright\b/i.test(l) && /<year>|<owner>|<copyright holders>|YEAR by AUTHOR/.test(l));
  if (at < 0) return copyright.length ? `${copyright.join("\n")}\n\n${text}` : text;
  if (copyright.length) lines.splice(at, 1, ...copyright);
  else lines.splice(at, lines[at + 1] === "" ? 2 : 1);
  return lines.join("\n");
}

function fallbackFiles(dir: string, pkg: PackageJson, license: string): { files: NoticeFile[]; fallback: Fallback } {
  const { lines, from } = findCopyright(dir, pkg);
  const files: NoticeFile[] = [];
  for (const id of licenseIds(license)) {
    const text = template(id);
    if (!text) throw new Error(`${pkg.name}@${pkg.version} ships no licence file and there is no standard text for "${id}". Add scripts/licenses/spdx/${id}.txt (from github.com/spdx/license-list-data) and a TEMPLATES entry.`);
    files.push({ name: `${id} (standard text)`, text: fillTemplate(text, TEMPLATES[id]!, lines) });
  }
  const usesCopyright = licenseIds(license).some((id) => TEMPLATES[id] !== "omit");
  return { files, fallback: usesCopyright ? from : "none" };
}

function noticeFiles(dir: string): NoticeFile[] {
  const names = readdirSync(dir)
    .filter((f) => NOTICE_FILE.test(f) && !NOT_TEXT.test(f))
    .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) || (a < b ? -1 : 1));
  const out: NoticeFile[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_TEXT) continue;
    const buf = readFileSync(path);
    if (buf.includes(0)) continue;
    const text = normalizeText(buf.toString("utf8"));
    if (text) out.push({ name, text });
  }
  return out;
}

const phrase = (s: string) => new RegExp(s.split(" ").join("\\s+"), "i");
/** Licence id from a text, for packages whose metadata does not declare one. */
export function detectLicense(text: string): string | null {
  if (phrase("Permission is hereby granted, free of charge").test(text)) return "MIT";
  if (phrase("Apache License,? Version 2\\.0").test(text)) return "Apache-2.0";
  if (phrase("Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided").test(text)) return "ISC";
  if (phrase("Redistribution and use in source and binary forms").test(text)) return phrase("Neither the name").test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  return null;
}

function declaredLicense(pkg: PackageJson): string | null {
  if (typeof pkg.license === "string" && pkg.license.trim()) return pkg.license.trim();
  if (pkg.license && typeof pkg.license === "object" && "type" in pkg.license) return String((pkg.license as { type: unknown }).type);
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l: unknown) => (typeof l === "object" && l && "type" in l ? String((l as { type: unknown }).type) : String(l)));
    if (types.length) return types.length > 1 ? `(${types.join(" OR ")})` : types[0]!;
  }
  return null;
}

/** An https link to the package's homepage or repository. */
export function homepageOf(pkg: PackageJson): string | undefined {
  const repo = typeof pkg.repository === "string" ? pkg.repository : typeof pkg.repository === "object" && pkg.repository && "url" in pkg.repository ? String((pkg.repository as { url: unknown }).url) : undefined;
  const raw = typeof pkg.homepage === "string" && pkg.homepage ? pkg.homepage : repo;
  if (!raw) return undefined;
  let url = raw
    .trim()
    .replace(/^git\+/, "")
    .replace(/^(git|ssh):\/\/(git@)?github\.com[/:]/, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^github:/, "https://github.com/")
    .replace(/^http:\/\//, "https://")
    .replace(/\.git(#.*)?$/, "")
    .replace(/#readme$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return /^https:\/\/[^\s"]+$/.test(url) ? url : undefined;
}

function packageNotice(dir: string, pkg: PackageJson, fallbackLicense: string | null, kind: NoticeKind, note?: string): Notice {
  let files = noticeFiles(dir);
  const license = declaredLicense(pkg) ?? files.map((f) => detectLicense(f.text)).find(Boolean) ?? fallbackLicense ?? "Unknown";
  let fallback: Fallback | undefined;
  if (!files.length) ({ files, fallback } = fallbackFiles(dir, pkg, license));
  const homepage = homepageOf(pkg);
  return { name: pkg.name!, version: pkg.version ?? "", license, kind, ...(note ? { note } : {}), ...(homepage ? { homepage } : {}), ...(fallback ? { fallback } : {}), files };
}

/** Resolves an installed dependency the way Node does: node_modules of `from` and its ancestors. */
function resolveInstalled(name: string, from: string): string {
  for (let d = from; ; d = dirname(d)) {
    const candidate = join(d, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(d) === d) throw new Error(`${name} is not installed (looked from ${relative(ROOT, from)}). Run bash scripts/safe-install.sh.`);
  }
}

/** Our workspace packages the project depends on at runtime, the project included. */
function workspaceClosure(projectDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const queue = [projectDir];
  while (queue.length) {
    const dir = queue.shift()!;
    const pkg = readJson(join(dir, "package.json"));
    if (!pkg.name || out.has(pkg.name)) continue;
    out.set(pkg.name, dir);
    for (const [dep, spec] of Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      if (spec.startsWith("workspace:")) queue.push(resolveInstalled(dep, dir));
    }
  }
  return out;
}

/** Directories of the installed third-party packages in the production closure, with pnpm's licence for each. */
function pnpmClosure(projects: string[]): Map<string, string> {
  const raw = execFileSync("pnpm", [...projects.flatMap((p) => ["--filter", p]), "licenses", "list", "--prod", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const parsed = JSON.parse(raw.trim() || "{}") as Record<string, { license?: string; paths: string[] }[]>;
  const dirs = new Map<string, string>();
  for (const [license, group] of Object.entries(parsed)) for (const p of group) for (const path of p.paths) dirs.set(path, p.license ?? license);
  return dirs;
}

function bundledNotices(hostDir: string, host: PackageJson, sub: string, skipped: string[]): Notice[] {
  const base = join(hostDir, sub);
  if (!existsSync(base)) return [];
  const dirs: string[] = [];
  for (const e of sortedEntries(base)) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith("@")) dirs.push(join(base, e.name));
    else for (const s of sortedEntries(join(base, e.name))) if (s.isDirectory()) dirs.push(join(base, e.name, s.name));
  }
  const out: Notice[] = [];
  for (const dir of dirs) {
    const pkgPath = join(dir, "package.json");
    const pkg: PackageJson = existsSync(pkgPath) ? readJson(pkgPath) : {};
    const name = (pkg.name ?? relative(base, dir)).replace(/-builtin$/, "");
    if (name === host.name || name.startsWith(`@${host.name}/`) || name.startsWith(`${host.name}-`)) continue;
    if (!noticeFiles(dir).length && !declaredLicense(pkg)) {
      skipped.push(`${host.name}/${relative(hostDir, dir)}`);
      continue;
    }
    out.push(packageNotice(dir, { ...pkg, name, version: pkg.version ?? "" }, null, "bundled", `bundled in ${host.name} ${host.version}`));
  }
  return out;
}

export interface Collected {
  project: string;
  notices: Notice[];
  /** Vendored directories with neither a licence file nor a declared licence (not listed). */
  skipped: string[];
}

/** Every third-party notice for a workspace project. */
export function collect(projectDir: string): Collected {
  const project = realpathSync(projectDir);
  const workspace = workspaceClosure(project);
  const closure = pnpmClosure([...workspace.keys()]);
  const notices: Notice[] = [];
  const seen = new Set<string>();
  const skipped: string[] = [];
  const add = (n: Notice) => {
    const key = `${n.kind}\0${n.name}\0${n.version}\0${n.note ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    notices.push(n);
  };
  for (const name of workspace.keys()) {
    for (const a of ASSETS[name] ?? []) add({ name: a.name, version: a.version, license: a.license, kind: "font", homepage: a.homepage, files: [{ name: a.file.split("/").pop()!, text: normalizeText(readFileSync(join(ROOT, a.file), "utf8")) }] });
  }
  const native = new Map<(typeof NATIVE)[number], PackageJson[]>();
  for (const [dir, pnpmLicense] of closure) {
    if (!existsSync(join(dir, "package.json"))) continue;
    const real = realpathSync(dir);
    if (!relative(ROOT, real).split("/").includes("node_modules")) continue; // a workspace package
    const pkg = readJson(join(real, "package.json"));
    if (pkg.os || pkg.cpu || pkg.libc) continue; // a platform-specific build binary
    add(packageNotice(real, pkg, pnpmLicense, "package"));
    for (const n of NATIVE) if (n.packages.test(pkg.name ?? "")) native.set(n, [...(native.get(n) ?? []), pkg]);
    const sub = BUNDLED[pkg.name ?? ""];
    if (sub) for (const b of bundledNotices(real, pkg, sub, skipped)) add(b);
  }
  for (const [n, pkgs] of native) {
    add({ name: n.name, version: pkgs.map(n.version).find(Boolean) ?? "", license: n.license, kind: "native", note: n.note, homepage: n.homepage, files: [{ name: "LICENSE", text: normalizeText(readFileSync(join(ROOT, n.file), "utf8")) }] });
  }
  const order: Record<NoticeKind, number> = { font: 0, package: 1, native: 1, bundled: 1 };
  notices.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.version.localeCompare(b.version, "en", { numeric: true }) || (a.note ?? "").localeCompare(b.note ?? ""));
  return { project: relative(ROOT, project), notices, skipped };
}

export interface Encoded {
  rows: (Omit<Notice, "files"> & { files: { name: string; text: number }[] })[];
  paragraphs: string[];
  texts: number[][];
}

/** Stores each distinct text once, as ids into a table of paragraphs shared between texts. Lossless. */
export function encode(notices: Notice[]): Encoded {
  const paragraphs: string[] = [];
  const pIds = new Map<string, number>();
  const texts: number[][] = [];
  const tIds = new Map<string, number>();
  const textId = (text: string) => {
    let id = tIds.get(text);
    if (id === undefined) {
      id = texts.length;
      tIds.set(text, id);
      texts.push(
        text.split("\n\n").map((p) => {
          let pid = pIds.get(p);
          if (pid === undefined) pIds.set(p, (pid = paragraphs.push(p) - 1));
          return pid;
        }),
      );
    }
    return id;
  };
  const rows = notices.map((n) => ({ ...n, files: n.files.map((f) => ({ name: f.name, text: textId(f.text) })) }));
  for (const [text, id] of tIds) if (decode(paragraphs, texts, id) !== text) throw new Error(`text ${id} does not round-trip`);
  return { rows, paragraphs, texts };
}

export function decode(paragraphs: readonly string[], texts: readonly (readonly number[])[], id: number): string {
  return (texts[id] ?? []).map((p) => paragraphs[p] ?? "").join("\n\n");
}

const str = JSON.stringify;

/** The generated module. Self-contained: the app imports `notices` and `noticeText` from it. */
export function render(collected: Collected, packageName: string): string {
  const { rows, paragraphs, texts } = encode(collected.notices);
  const row = (r: Encoded["rows"][number]) =>
    `{ name: ${str(r.name)}, version: ${str(r.version)}, license: ${str(r.license)}, kind: ${str(r.kind)}` +
    (r.note ? `, note: ${str(r.note)}` : "") +
    (r.homepage ? `, homepage: ${str(r.homepage)}` : "") +
    (r.fallback ? `, fallback: ${str(r.fallback)}` : "") +
    `, files: [${r.files.map((f) => `{ name: ${str(f.name)}, text: ${f.text} }`).join(", ")}] }`;
  return [
    `// Generated by scripts/licenses/collect.ts from the pnpm lockfile and the installed packages. Do not edit.`,
    `// Regenerate with \`pnpm --filter ${packageName} notices\`; a test fails while this file is stale.`,
    `// ${collected.project}: ${rows.length} entries, ${texts.length} distinct texts.`,
    "",
    "/** A third-party component of this app and the licence and notice texts that come with it. */",
    "export interface ThirdPartyNotice {",
    "  name: string;",
    "  /** Empty for code bundled inside another package without a version of its own (see `note`). */",
    "  version: string;",
    "  /** SPDX licence expression as the package declares it. */",
    "  license: string;",
    `  kind: "package" | "font" | "native" | "bundled";`,
    "  /** Where it ships when it is not a package of its own. */",
    "  note?: string;",
    "  homepage?: string;",
    "  /**",
    "   * Set when the package ships no licence file: its text is the SPDX standard text of its licence with the",
    "   * copyright line from its README, its source file headers or its package.json author (\"none\": no copyright",
    "   * line found).",
    "   */",
    `  fallback?: "readme" | "source" | "author" | "none";`,
    "  /** Licence and notice files: file name and text id (see `noticeText`). */",
    "  files: readonly { name: string; text: number }[];",
    "}",
    "",
    "export const notices: readonly ThirdPartyNotice[] = [",
    ...rows.map((r) => `  ${row(r)},`),
    "];",
    "",
    "/** Paragraphs shared between the texts. */",
    "const P: readonly string[] = [",
    ...paragraphs.map((p) => `  ${str(p)},`),
    "];",
    "",
    "/** Each distinct text as paragraph ids. */",
    "const T: readonly (readonly number[])[] = [",
    ...texts.map((t) => `  [${t.join(", ")}],`),
    "];",
    "",
    "/** The full, unaltered text of a notice file (`notices[i].files[j].text`). */",
    "export function noticeText(text: number): string {",
    `  return (T[text] ?? []).map((p) => P[p] ?? "").join("\\n\\n");`,
    "}",
    "",
  ].join("\n");
}

function entriesOf(source: string): Set<string> {
  return new Set([...source.matchAll(/^ {2}\{ name: ("(?:[^"\\]|\\.)*"), version: ("(?:[^"\\]|\\.)*")/gm)].map((m) => `${JSON.parse(m[1]!)}@${JSON.parse(m[2]!)}`));
}

function main(argv: string[]) {
  const check = argv.includes("--check");
  const [projectArg, outArg] = argv.filter((a) => !a.startsWith("--"));
  if (!projectArg || !outArg) {
    console.error("usage: node scripts/licenses/collect.ts <project dir> <output .ts> [--check]");
    process.exit(2);
  }
  const projectDir = resolve(projectArg);
  const out = resolve(outArg);
  const packageName = readJson(join(projectDir, "package.json")).name ?? projectArg;
  const collected = collect(projectDir);
  const source = render(collected, packageName);
  const rel = relative(process.cwd(), out);
  if (check) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current === source) {
      console.log(`${rel} is up to date (${collected.notices.length} entries)`);
      return;
    }
    const was = entriesOf(current);
    const now = entriesOf(source);
    const added = [...now].filter((k) => !was.has(k));
    const removed = [...was].filter((k) => !now.has(k));
    console.error(`${rel} is stale.` + (added.length ? `\n  missing: ${added.join(", ")}` : "") + (removed.length ? `\n  no longer used: ${removed.join(", ")}` : "") + (!added.length && !removed.length ? "\n  (licence texts or metadata changed)" : ""));
    console.error(`Regenerate with: pnpm --filter ${packageName} notices`);
    process.exit(1);
  }
  writeFileSync(out, source);
  const fallbacks = collected.notices.filter((n) => n.fallback);
  console.log(`wrote ${rel}: ${collected.notices.length} entries, ${Math.round(Buffer.byteLength(source) / 1024)} KB`);
  if (fallbacks.length) console.log(`  ${fallbacks.length} ship no licence file; standard text used, copyright line from:`);
  for (const from of ["readme", "source", "author", "none"] as const) {
    const names = [...new Set(fallbacks.filter((n) => n.fallback === from).map((n) => n.name))];
    if (names.length) console.log(`    ${from === "none" ? "nowhere (none found or not needed)" : from}: ${names.join(", ")}`);
  }
  if (collected.skipped.length) console.log(`  vendored without a licence file or declared licence (not listed): ${collected.skipped.join(", ")}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
