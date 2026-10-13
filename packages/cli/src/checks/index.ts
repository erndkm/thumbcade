/**
 * Static bundle checks shared by `thumbcade validate` and the automated reviewer: manifest,
 * files, size budgets and a static scan for things the game CSP will block anyway.
 * Every finding carries a human-readable fix.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { BUDGETS, MANIFEST_FILENAME, validateManifest, type Manifest } from "@thumbcade/protocol";

export type CheckStatus = "pass" | "fail" | "warn";

export interface Finding {
  status: CheckStatus;
  message: string;
  file?: string;
  fix?: string;
}

export interface BundleCheck {
  id: "manifest" | "size" | "static_scan";
  label: string;
  status: CheckStatus;
  findings: Finding[];
  value?: number;
  budget?: number;
}

export interface BundleFile {
  path: string;
  size: number;
  gzip: number;
  data: Buffer;
}

export interface BundleReport {
  manifest: Manifest | null;
  checks: BundleCheck[];
  passed: boolean;
  totals: { files: number; totalBytes: number; gzipBytes: number; initialGzipBytes: number; initialFiles: string[] };
}

const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".map"]);

export async function readBundle(dir: string): Promise<BundleFile[]> {
  const out: BundleFile[] = [];
  async function walk(d: string) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const data = await readFile(full);
        out.push({ path: relative(dir, full).split(sep).join("/"), size: data.length, gzip: gzipSync(data, { level: 9 }).length, data });
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Width/height of a PNG or JPEG, or null. */
export function imageSize(buf: Buffer): { width: number; height: number; type: "png" | "jpeg" } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: "png" };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), type: "jpeg" };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Hosts whose URLs show up in libraries as identifiers or docs links, never as requests. */
const BENIGN_HOSTS = /^(www\.)?(w3\.org|thumbcade\.com|schema\.org|purl\.org|ns\.adobe\.com|xmlns\.com|developer\.mozilla\.org|github\.com|reactjs\.org|react\.dev|threejs\.org|pixijs\.com|phaser\.io|tc39\.es|json-schema\.org|feross\.org|jquery\.(com|org)|opensource\.org|spdx\.org|mths\.be|fb\.me|creativecommons\.org|jcgt\.org|khronos\.org)$/;

const NETWORK_CALL = /(fetch|XMLHttpRequest|\.open|import|importScripts|WebSocket|EventSource|sendBeacon|loadScript|src\s*=)\s*\(?\s*["'`]?$/;

/**
 * Scans HTML, JS and CSS for code that loads remote resources, uses eval, or relies on inline scripts.
 * The game origin's CSP blocks all of these at runtime; this catches them before upload.
 */
export function staticScan(files: BundleFile[]): Finding[] {
  const findings: Finding[] = [];
  const remoteHosts = new Map<string, string>();
  for (const f of files) {
    const ext = extname(f.path).toLowerCase();
    if (!TEXT.has(ext) || ext === ".map" || ext === ".json") continue;
    const text = f.data.toString("utf8");

    if (ext === ".html") {
      for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = m[1] ?? "";
        const body = (m[2] ?? "").trim();
        if (!/\bsrc\s*=/.test(attrs) && body.length > 0 && !/data-thumbcade-probe/.test(attrs)) {
          findings.push({
            status: "fail",
            file: f.path,
            message: "Inline <script> in HTML",
            fix: "The game CSP is script-src 'self': inline scripts never run. Move the code into a .js/.ts file and load it with <script type=\"module\" src>.",
          });
        }
      }
      for (const m of text.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const url = m[2] ?? "";
        if (/^https?:\/\//i.test(url) || url.startsWith("//")) {
          findings.push({ status: "fail", file: f.path, message: `Loads ${url} from another origin`, fix: "Games can only load files from their own origin. Download the file into your project and reference it relatively." });
        } else if (url.startsWith("/") && !url.startsWith("//")) {
          findings.push({
            status: "fail",
            file: f.path,
            message: `Root-relative path ${url}`,
            fix: "Bundles are served under /<versionId>/, so absolute paths break. Set base: \"./\" in vite.config.ts (the template does) or use relative paths.",
          });
        }
      }
      if (!/<meta[^>]+name=["']viewport["']/i.test(text)) {
        findings.push({ status: "warn", file: f.path, message: "No viewport meta tag", fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"> or the game renders zoomed out on phones.' });
      }
    }

    if (ext === ".css") {
      for (const m of text.matchAll(/(@import\s+(?:url\()?|url\()\s*["']?(https?:\/\/[^"')\s]+)/gi)) {
        findings.push({ status: "fail", file: f.path, message: `CSS loads ${m[2]}`, fix: "Remote stylesheets and fonts are blocked. Bundle the font files and reference them relatively." });
      }
    }

    if (ext === ".js" || ext === ".mjs" || ext === ".html") {
      if (/(^|[^.\w$])eval\s*\(/.test(text)) {
        findings.push({ status: "warn", file: f.path, message: "Uses eval()", fix: "The CSP has no 'unsafe-eval': eval throws if this code path runs. Remove it, or make sure a library only uses it as an optional fallback." });
      }
      if (/\bnew\s+Function\s*\(/.test(text)) {
        findings.push({ status: "warn", file: f.path, message: "Uses new Function()", fix: "Blocked by the CSP (no 'unsafe-eval'). Fine only if the library never calls it at runtime." });
      }
      if (/\bwindow\.open\s*\(/.test(text)) {
        findings.push({ status: "warn", file: f.path, message: "Calls window.open()", fix: "Games can't open windows or navigate away. Use tc.share.challenge() for sharing." });
      }
      for (const m of ext === ".html" ? [] : text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[^\s"'`)<>]*/gi)) {
        const host = (m[1] ?? "").toLowerCase();
        if (BENIGN_HOSTS.test(host) || host === "localhost") continue;
        const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
        if (NETWORK_CALL.test(before)) {
          findings.push({ status: "fail", file: f.path, message: `Network request to ${m[0].slice(0, 80)}`, fix: "connect-src is 'self': requests to other origins are blocked. Bundle the data or drop the call." });
        } else if (!remoteHosts.has(host)) {
          remoteHosts.set(host, f.path);
        }
      }
    }
  }
  if (remoteHosts.size) {
    const hosts = [...remoteHosts.keys()].slice(0, 8);
    findings.push({
      status: "warn",
      file: [...remoteHosts.values()][0],
      message: `References ${remoteHosts.size} remote host${remoteHosts.size > 1 ? "s" : ""}: ${hosts.join(", ")}${remoteHosts.size > 8 ? ", …" : ""}`,
      fix: "Usually harmless strings inside a library. If your game loads anything from these hosts, it will be blocked by the CSP.",
    });
  }
  return findings;
}

/**
 * Everything the browser must download before your code starts: the entry HTML, its scripts and
 * stylesheets, modulepreloads, and the static import graph of those scripts.
 */
export function initialFiles(entry: string, files: BundleFile[]): string[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const seen = new Set<string>();
  const queue = [entry];
  const resolveRef = (from: string, ref: string): string | null => {
    if (/^(https?:|data:|blob:|\/\/)/i.test(ref)) return null;
    const clean = ref.split(/[?#]/)[0]!;
    const p = posix.normalize(posix.join(posix.dirname(from), clean)).replace(/^\.\//, "");
    return byPath.has(p) ? p : null;
  };
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    const f = byPath.get(path);
    if (!f) continue;
    seen.add(path);
    const ext = extname(path).toLowerCase();
    const text = TEXT.has(ext) ? f.data.toString("utf8") : "";
    if (ext === ".html") {
      for (const m of text.matchAll(/<(script|link)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        const tag = m[0];
        if (m[1]!.toLowerCase() === "link" && !/rel\s*=\s*["'](stylesheet|modulepreload|preload)["']/i.test(tag)) continue;
        const r = resolveRef(path, m[3]!);
        if (r) queue.push(r);
      }
    } else if (ext === ".js" || ext === ".mjs") {
      // Static imports only: `import x from "./a.js"`, `import "./a.js"`, `export * from "./a.js"`.
      for (const m of text.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["'](\.{1,2}\/[^"']+)["']/g)) {
        const r = resolveRef(path, m[1]!);
        if (r) queue.push(r);
      }
    } else if (ext === ".css") {
      for (const m of text.matchAll(/@import\s+(?:url\()?["']?([^"')\s]+)/g)) {
        const r = resolveRef(path, m[1]!);
        if (r) queue.push(r);
      }
    }
  }
  return [...seen];
}

function worst(findings: Finding[]): CheckStatus {
  if (findings.some((f) => f.status === "fail")) return "fail";
  if (findings.some((f) => f.status === "warn")) return "warn";
  return "pass";
}

/** Runs every static check on a built bundle directory (thumbcade.json at its root). */
export async function checkBundle(dir: string): Promise<BundleReport> {
  const files = await readBundle(dir);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const manifestFindings: Finding[] = [];
  let manifest: Manifest | null = null;

  const mf = byPath.get(MANIFEST_FILENAME);
  if (!mf) {
    manifestFindings.push({ status: "fail", message: `${MANIFEST_FILENAME} is missing from the bundle root`, fix: "Keep thumbcade.json next to package.json; thumbcade validate/publish copy it into the build." });
  } else {
    let raw: unknown = null;
    try {
      raw = JSON.parse(mf.data.toString("utf8"));
    } catch (err) {
      manifestFindings.push({ status: "fail", file: MANIFEST_FILENAME, message: `Not valid JSON (${err instanceof Error ? err.message : String(err)})` });
    }
    if (raw !== null) {
      const v = validateManifest(raw);
      if (!v.ok) for (const issue of v.issues) manifestFindings.push({ status: "fail", file: MANIFEST_FILENAME, message: issue, fix: manifestFix(issue) });
      else manifest = v.manifest;
    }
  }

  if (manifest) {
    const entry = byPath.get(manifest.entry);
    if (!entry) manifestFindings.push({ status: "fail", message: `Entry ${manifest.entry} is not in the bundle`, fix: 'Point "entry" at your built HTML file (usually index.html).' });
    else if (!/\.html?$/i.test(manifest.entry)) manifestFindings.push({ status: "fail", message: `Entry ${manifest.entry} is not an HTML file` });
    const icon = byPath.get(manifest.icon);
    if (!icon) {
      manifestFindings.push({ status: "fail", message: `Icon ${manifest.icon} is not in the bundle`, fix: "Put a 1024×1024 PNG at public/" + manifest.icon + " so Vite copies it into the build." });
    } else {
      const s = imageSize(icon.data);
      if (!s || s.type !== "png") manifestFindings.push({ status: "fail", message: `Icon ${manifest.icon} is not a PNG`, fix: "Export the icon as a 1024×1024 PNG." });
      else if (s.width !== 1024 || s.height !== 1024) manifestFindings.push({ status: "fail", message: `Icon is ${s.width}×${s.height}, needs 1024×1024`, fix: "Export the icon at exactly 1024×1024. Keep the subject inside the central 80%: it's masked to a squircle." });
    }
    if (manifest.poster) {
      const poster = byPath.get(manifest.poster);
      if (!poster) manifestFindings.push({ status: "fail", message: `Poster ${manifest.poster} is not in the bundle`, fix: "Add the file, or remove \"poster\" and the reviewer captures one from your attract mode." });
      else {
        const s = imageSize(poster.data);
        if (!s) manifestFindings.push({ status: "fail", message: `Poster ${manifest.poster} is not a PNG or JPEG` });
        else if (s.width !== 1080 || s.height !== 1920) manifestFindings.push({ status: "warn", message: `Poster is ${s.width}×${s.height}; the feed expects 1080×1920`, fix: "Export a 1080×1920 portrait still of your attract mode." });
      }
    }
  }

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const gzipBytes = files.reduce((n, f) => n + f.gzip, 0);
  const initial = manifest && byPath.has(manifest.entry) ? initialFiles(manifest.entry, files) : [];
  const initialGzipBytes = initial.reduce((n, p) => n + (byPath.get(p)?.gzip ?? 0), 0);
  const sizeFindings: Finding[] = [];
  if (totalBytes > BUDGETS.totalBundleBytes) {
    sizeFindings.push({ status: "fail", message: `Bundle is ${mb(totalBytes)}; the hard cap is ${mb(BUDGETS.totalBundleBytes)}`, fix: "Compress textures and audio (WebP/AVIF, Opus), drop unused assets, or generate them procedurally." });
  }
  if (initialGzipBytes > BUDGETS.initialPayloadGzipBytes) {
    sizeFindings.push({ status: "fail", message: `Initial payload is ${mb(initialGzipBytes)} gzipped; the budget is ${mb(BUDGETS.initialPayloadGzipBytes)}`, fix: "Load big assets after ready() (dynamic import, lazy textures) so the first frame comes fast." });
  }
  const big = files.filter((f) => f.size > 5 * 1024 * 1024 && f.path !== MANIFEST_FILENAME);
  for (const f of big) sizeFindings.push({ status: "warn", file: f.path, message: `${f.path} is ${mb(f.size)}`, fix: "Large single files slow the first load on mobile networks." });

  const scan = staticScan(files);
  const checks: BundleCheck[] = [
    { id: "manifest", label: "Manifest and assets", status: worst(manifestFindings), findings: manifestFindings },
    { id: "size", label: "Size budget", status: worst(sizeFindings), findings: sizeFindings, value: initialGzipBytes, budget: BUDGETS.initialPayloadGzipBytes },
    { id: "static_scan", label: "Static scan", status: worst(scan), findings: scan },
  ];
  return {
    manifest,
    checks,
    passed: checks.every((c) => c.status !== "fail"),
    totals: { files: files.length, totalBytes, gzipBytes, initialGzipBytes, initialFiles: initial },
  };
}

export function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** Turns a zod issue path into advice. */
export function manifestFix(issue: string): string | undefined {
  const key = issue.split(":")[0] ?? "";
  const fixes: Record<string, string> = {
    id: 'Lowercase letters, digits and dashes, 3-40 characters, e.g. "lane-rush". It becomes your game\'s address and can never change.',
    name: "1-32 characters. This is the big name in the feed caption.",
    version: 'Use semver, e.g. "1.0.0", and bump it for every publish.',
    sdk: 'The SDK range you built against, e.g. "^1.0.0".',
    description: "1-120 characters. One line with some voice beats a feature list.",
    tags: "1-5 lowercase hashtags (a-z, 0-9, _), without the #.",
    accentColor: 'A 6-digit hex color like "#FF6A1A". It tints the Dock and your caption chips.',
    icon: "A relative path to a 1024×1024 PNG inside the bundle.",
    "controls.vertical": "true if play uses ANY vertical motion (swipes, drags, joysticks). Read the Swipe Contract.",
    controls: "Declare { vertical, horizontal, multitouch, inputs }. vertical decides who owns swipes while playing.",
    score: 'Add { "order": "desc", "max": 100000, "format": "integer" }. Scores above max are rejected.',
    "score.max": "The highest score that is humanly possible. The server rejects anything above it.",
    ageRating: 'One of "4+", "9+", "12+", "17+".',
    orientation: 'Only "portrait" is supported.',
  };
  return fixes[key] ?? fixes[key.split(".")[0] ?? ""];
}

export async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
