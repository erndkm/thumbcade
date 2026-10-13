import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { gzipSync } from "node:zlib";

/** The CSP every game origin serves (§6). The reviewer serves bundles with it so violations surface. */
export const GAME_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; " +
  "media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-src 'none'";

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".txt": "text/plain; charset=utf-8",
};

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|wasm)|image\/svg|model\/gltf\+json)/;

export interface ServedRequest {
  /** Path relative to the bundle root. */
  file: string;
  status: number;
  bytes: number;
  /** Gzip size of the file (what a CDN would transfer). */
  gzipBytes: number;
  /** ms since the server started. */
  at: number;
}

export interface GameServer {
  /** Origin, e.g. http://127.0.0.1:53421 */
  origin: string;
  /** Entry URL for the bundle under `/<slug>/<versionId>/` (path-mode game host layout). */
  entryUrl: string;
  basePath: string;
  requests: ServedRequest[];
  close(): Promise<void>;
}

/**
 * Serves one bundle directory like the game host: immutable path `/<slug>/<versionId>/...`, the game CSP,
 * gzip when accepted, nothing outside the bundle.
 */
export async function serveBundle(opts: {
  dir: string;
  slug: string;
  versionId?: string;
  entry?: string;
  host?: string;
  csp?: boolean;
}): Promise<GameServer> {
  const versionId = opts.versionId ?? "review";
  const basePath = `/${opts.slug}/${versionId}/`;
  const root = normalize(opts.dir);
  const requests: ServedRequest[] = [];
  const started = Date.now();
  const gzCache = new Map<string, Buffer>();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      res.end(body);
    };
    if (!url.pathname.startsWith(basePath)) return send(404, "not found");
    let rel = decodeURIComponent(url.pathname.slice(basePath.length));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep) && file !== root) return send(403, "forbidden");
    let size: number;
    try {
      const s = await stat(file);
      if (!s.isFile()) return send(404, "not found");
      size = s.size;
    } catch {
      requests.push({ file: rel, status: 404, bytes: 0, gzipBytes: 0, at: Date.now() - started });
      return send(404, "not found");
    }
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "cross-origin",
    };
    if (opts.csp !== false) headers["content-security-policy"] = GAME_CSP;
    let gz = gzCache.get(file);
    if (!gz) {
      gz = gzipSync(await readFile(file), { level: 9 });
      gzCache.set(file, gz);
    }
    requests.push({ file: rel, status: 200, bytes: size, gzipBytes: gz.length, at: Date.now() - started });
    const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    if (acceptsGzip && COMPRESSIBLE.test(type)) {
      res.writeHead(200, { ...headers, "content-encoding": "gzip", "content-length": String(gz.length), vary: "accept-encoding" });
      res.end(req.method === "HEAD" ? undefined : gz);
      return;
    }
    res.writeHead(200, { ...headers, "content-length": String(size) });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  const origin = await listen(server, opts.host ?? "127.0.0.1");
  return {
    origin,
    basePath,
    entryUrl: `${origin}${basePath}${opts.entry ?? "index.html"}`,
    requests,
    close: () => close(server),
  };
}

export function listen(server: Server, host: string, port = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const { port: p } = server.address() as AddressInfo;
      resolve(`http://${host}:${p}`);
    });
  });
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
