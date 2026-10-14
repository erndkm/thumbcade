import { SLUG_PATTERN } from "@thumbcade/protocol";

/**
 * Request policy for the games origin: which paths exist, which headers every response carries.
 * Pure functions so they can be unit-tested without a socket.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT_PATTERN = /^[A-Za-z0-9._~!$&'()+,;=@-]+$/;

export interface GamePath {
  slug: string;
  versionId: string;
  /** Path of the file inside the version, never empty, never starting with "/". */
  file: string;
}

/**
 * Parses `/<slug>/<versionId>/<path>` from a raw (still percent-encoded) URL pathname.
 * Rejects traversal in every spelling: `..`, encoded dots/slashes/backslashes, NUL, empty segments.
 */
export function parseGamePath(rawPathname: string): GamePath | null {
  if (!rawPathname.startsWith("/")) return null;
  if (rawPathname.length > 512) return null;
  if (/%(2e|2f|5c|00)/i.test(rawPathname)) return null;
  if (rawPathname.includes("\\") || rawPathname.includes("\0")) return null;

  const parts = rawPathname.slice(1).split("/");
  if (parts.length < 2) return null;
  const [slug, versionId, ...rest] = parts as [string, string, ...string[]];
  if (!SLUG_PATTERN.test(slug)) return null;
  if (!UUID_PATTERN.test(versionId)) return null;

  // `/<slug>/<versionId>` and `/<slug>/<versionId>/` both serve the entry document.
  let segments = rest;
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "")) segments = ["index.html"];
  else if (segments[segments.length - 1] === "") segments = [...segments.slice(0, -1), "index.html"];

  const decoded: string[] = [];
  for (const seg of segments) {
    let d: string;
    try {
      d = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (d === "" || d === "." || d === ".." || d.startsWith(".")) return null;
    if (!SEGMENT_PATTERN.test(d)) return null;
    decoded.push(d);
  }
  return { slug, versionId: versionId.toLowerCase(), file: decoded.join("/") };
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
  ktx2: "image/ktx2",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function contentTypeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/** The games-origin CSP from the build brief §6, plus frame-ancestors for the portal and simulator. */
export const GAME_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; " +
  "media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; " +
  "frame-src 'none'";

export function cspHeader(frameAncestors: readonly string[]): string {
  const fa = frameAncestors.length > 0 ? frameAncestors.join(" ") : "'none'";
  return `${GAME_CSP}; frame-ancestors ${fa}`;
}

export function securityHeaders(frameAncestors: readonly string[]): Record<string, string> {
  return {
    "Content-Security-Policy": cspHeader(frameAncestors),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), display-capture=()",
  };
}

/** CORS: echo the Origin only when it is on the allowlist. Never `*`. */
export function corsHeaders(origin: string | undefined, allowlist: readonly string[]): Record<string, string> {
  if (!origin || !allowlist.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, If-None-Match",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag",
    "Access-Control-Max-Age": "600",
  };
}

/** Parses a single `bytes=a-b` range. Returns null for absent/unsupported, "invalid" when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m as unknown as [string, string, string];
  let start: number;
  let end: number;
  if (a === "" && b === "") return "invalid";
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}
