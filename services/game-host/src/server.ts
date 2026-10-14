import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { contentTypeFor, corsHeaders, parseGamePath, parseRange, securityHeaders, type GamePath } from "./policy.ts";

export interface GameHostOptions {
  /** Base URL of the bucket's public objects, e.g. http://127.0.0.1:54321/storage/v1/object/public/game-bundles */
  upstream: string;
  frameAncestors: readonly string[];
  corsOrigins: readonly string[];
  /** Total bytes kept in memory. */
  cacheBytes?: number;
  /** Log one line per request. */
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
}

interface Entry {
  body: Buffer;
  etag: string;
  contentType: string;
}

/** Byte-bounded LRU. Content under a version id is immutable, so entries never need revalidation. */
export class ByteLru {
  private map = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly max: number) {}
  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }
  set(key: string, e: Entry): void {
    if (e.body.byteLength > this.max / 4) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.body.byteLength;
      this.map.delete(key);
    }
    this.map.set(key, e);
    this.bytes += e.body.byteLength;
    while (this.bytes > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.bytes -= this.map.get(oldest)!.body.byteLength;
      this.map.delete(oldest);
    }
  }
  get size(): number {
    return this.map.size;
  }
  get totalBytes(): number {
    return this.bytes;
  }
}

export function createGameHost(opts: GameHostOptions): Server {
  const cache = new ByteLru(opts.cacheBytes ?? 256 * 1024 * 1024);
  const doFetch = opts.fetchImpl ?? fetch;
  const inflight = new Map<string, Promise<Entry | number>>();
  const upstream = opts.upstream.replace(/\/$/, "");

  async function load(p: GamePath): Promise<Entry | number> {
    const key = `${p.slug}/${p.versionId}/${p.file}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = (async (): Promise<Entry | number> => {
      const url = `${upstream}/${key.split("/").map(encodeURIComponent).join("/")}`;
      let res: Response;
      try {
        res = await doFetch(url);
      } catch {
        return 502;
      }
      if (res.status >= 500) return 502;
      // Storage answers 400 or 404 for missing objects.
      if (!res.ok) return 404;
      const body = Buffer.from(await res.arrayBuffer());
      const entry: Entry = {
        body,
        etag: `"${createHash("sha1").update(body).digest("base64url")}"`,
        contentType: contentTypeFor(p.file),
      };
      cache.set(key, entry);
      return entry;
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  function send(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body?: Buffer | string,
  ): void {
    const base = { ...securityHeaders(opts.frameAncestors), ...corsHeaders(req.headers.origin, opts.corsOrigins), Vary: "Origin" };
    const all: Record<string, string> = { ...base, ...headers };
    if (body !== undefined && all["Content-Length"] === undefined) {
      all["Content-Length"] = String(typeof body === "string" ? Buffer.byteLength(body) : body.byteLength);
    }
    res.writeHead(status, all);
    if (req.method === "HEAD" || body === undefined) res.end();
    else res.end(body);
    opts.log?.(`${req.method} ${req.url} ${status}`);
  }

  function error(req: IncomingMessage, res: ServerResponse, status: number, message: string): void {
    send(req, res, status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, `${message}\n`);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? "/";
    const q = rawUrl.indexOf("?");
    const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q);

    if (req.method === "OPTIONS") {
      const origin = req.headers.origin;
      if (!origin || !opts.corsOrigins.includes(origin)) return error(req, res, 403, "Origin not allowed");
      return send(req, res, 204, { "Cache-Control": "no-store" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(req, res, 405, { Allow: "GET, HEAD, OPTIONS", "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, "Method not allowed\n");
    }
    if (pathname === "/healthz") {
      return send(req, res, 200, { "Content-Type": "application/json", "Cache-Control": "no-store" }, JSON.stringify({ ok: true, cached: cache.size, cachedBytes: cache.totalBytes }));
    }

    const parsed = parseGamePath(pathname);
    if (!parsed) return error(req, res, 404, "Not found");

    const result = await load(parsed);
    if (typeof result === "number") return error(req, res, result, result === 404 ? "Not found" : "Upstream unavailable");

    const common: Record<string, string> = {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: result.etag,
      "Accept-Ranges": "bytes",
    };
    if (req.headers["if-none-match"] === result.etag) return send(req, res, 304, common);

    const range = parseRange(req.headers.range, result.body.byteLength);
    if (range === "invalid") {
      return send(req, res, 416, { ...common, "Content-Range": `bytes */${result.body.byteLength}`, "Cache-Control": "no-store" }, "");
    }
    if (range) {
      const slice = result.body.subarray(range.start, range.end + 1);
      return send(req, res, 206, { ...common, "Content-Range": `bytes ${range.start}-${range.end}/${result.body.byteLength}` }, slice);
    }
    return send(req, res, 200, common, result.body);
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) error(req, res, 500, "Internal error");
      else res.end();
    });
  });
}
