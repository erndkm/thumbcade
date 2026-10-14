import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAME_CSP, contentTypeFor, parseGamePath, parseRange } from "../src/policy.ts";
import { ByteLru, createGameHost } from "../src/server.ts";

const V = "0b6f7a4e-5a1c-4c55-9b43-2f0a8f1b9e01";

describe("parseGamePath", () => {
  it("accepts versioned paths and defaults to index.html", () => {
    expect(parseGamePath(`/lane-rush/${V}/assets/app.js`)).toEqual({ slug: "lane-rush", versionId: V, file: "assets/app.js" });
    expect(parseGamePath(`/lane-rush/${V}/`)?.file).toBe("index.html");
    expect(parseGamePath(`/lane-rush/${V}`)?.file).toBe("index.html");
    expect(parseGamePath(`/lane-rush/${V}/assets/`)?.file).toBe("assets/index.html");
  });
  it("rejects traversal in every spelling", () => {
    for (const p of [
      `/lane-rush/${V}/../secret`,
      `/lane-rush/${V}/a/../../b`,
      `/lane-rush/${V}/%2e%2e/b`,
      `/lane-rush/${V}/%2E%2E%2Fb`,
      `/lane-rush/${V}/a%2fb`,
      `/lane-rush/${V}/a%5cb`,
      `/lane-rush/${V}/a\\b`,
      `/lane-rush/${V}/a%00b`,
      `/lane-rush/${V}/.env`,
      `/lane-rush/${V}//index.html`,
      `/lane-rush/${V}/%E0%A4%A`,
    ]) {
      expect(parseGamePath(p), p).toBeNull();
    }
  });
  it("rejects bad slugs and version ids", () => {
    expect(parseGamePath(`/Lane-Rush/${V}/index.html`)).toBeNull();
    expect(parseGamePath(`/lane-rush/v1/index.html`)).toBeNull();
    expect(parseGamePath(`/lane-rush`)).toBeNull();
    expect(parseGamePath(`/`)).toBeNull();
  });
});

describe("helpers", () => {
  it("maps content types", () => {
    expect(contentTypeFor("index.html")).toMatch(/^text\/html/);
    expect(contentTypeFor("a.wasm")).toBe("application/wasm");
    expect(contentTypeFor("m.glb")).toBe("model/gltf-binary");
    expect(contentTypeFor("f.woff2")).toBe("font/woff2");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
  });
  it("parses ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=200-300", 100)).toBe("invalid");
    expect(parseRange(undefined, 100)).toBeNull();
  });
  it("evicts least recently used entries by bytes", () => {
    const lru = new ByteLru(40);
    const e = (n: number) => ({ body: Buffer.alloc(n), etag: "x", contentType: "t" });
    lru.set("a", e(10));
    lru.set("b", e(10));
    lru.get("a");
    lru.set("c", e(10));
    lru.set("d", e(10));
    lru.set("e", e(10));
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBeDefined();
    expect(lru.totalBytes).toBeLessThanOrEqual(40);
  });
});

describe("server", () => {
  const files: Record<string, string> = {
    [`/bucket/snek/${V}/index.html`]: "<!doctype html><title>snek</title>",
    [`/bucket/snek/${V}/assets/app.js`]: "console.log(1)",
  };
  let upstreamCalls = 0;
  const fakeFetch = (async (input: string | URL | Request) => {
    upstreamCalls++;
    const url = new URL(String(input));
    const body = files[url.pathname];
    if (body === undefined) return new Response('{"error":"not_found"}', { status: 400 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  const server = createGameHost({
    upstream: "http://upstream.test/bucket",
    frameAncestors: ["http://localhost:3000"],
    corsOrigins: ["http://localhost:3000"],
    fetchImpl: fakeFetch,
  });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("serves files with the game CSP and immutable caching", async () => {
    const res = await fetch(`${base}/snek/${V}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("snek");
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("content-security-policy")).toBe(`${GAME_CSP}; frame-ancestors http://localhost:3000`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("caches immutable content", async () => {
    const before = upstreamCalls;
    await fetch(`${base}/snek/${V}/assets/app.js`);
    await fetch(`${base}/snek/${V}/assets/app.js`);
    expect(upstreamCalls - before).toBe(1);
  });

  it("answers 304 for a matching ETag and 206 for ranges", async () => {
    const first = await fetch(`${base}/snek/${V}/assets/app.js`);
    const etag = first.headers.get("etag")!;
    const again = await fetch(`${base}/snek/${V}/assets/app.js`, { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    const part = await fetch(`${base}/snek/${V}/assets/app.js`, { headers: { Range: "bytes=0-6" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("console");
  });

  it("maps missing objects and bad paths to 404 with no-store", async () => {
    const missing = await fetch(`${base}/snek/${V}/nope.js`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(missing.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect((await fetch(`${base}/snek/${V}/%2e%2e/x`)).status).toBe(404);
  });

  it("allows only GET/HEAD and echoes CORS only for allowlisted origins", async () => {
    expect((await fetch(`${base}/snek/${V}/`, { method: "POST" })).status).toBe(405);
    const head = await fetch(`${base}/snek/${V}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    const allowed = await fetch(`${base}/snek/${V}/`, { headers: { Origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const denied = await fetch(`${base}/snek/${V}/`, { headers: { Origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await fetch(`${base}/snek/${V}/`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(pre.status).toBe(403);
    const okPre = await fetch(`${base}/snek/${V}/`, { method: "OPTIONS", headers: { Origin: "http://localhost:3000" } });
    expect(okPre.status).toBe(204);
  });

  it("reports health", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
