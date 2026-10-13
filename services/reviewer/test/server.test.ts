import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAME_CSP, serveBundle, type GameServer } from "../src/server.ts";
import { buildFixture } from "./fixtures/build.ts";

let server: GameServer;
beforeAll(async () => {
  server = await serveBundle({ dir: await buildFixture("good"), slug: "fixture-good", versionId: "v1" });
});
afterAll(() => server.close());

describe("serveBundle", () => {
  it("serves the bundle under /<slug>/<versionId>/ with the game CSP, gzip and immutable caching", async () => {
    expect(server.entryUrl).toBe(`${server.origin}/fixture-good/v1/index.html`);
    const res = await fetch(server.entryUrl, { headers: { "accept-encoding": "gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(GAME_CSP);
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("assets/main.js");
    const js = await fetch(`${server.origin}/fixture-good/v1/assets/main.js`);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(server.requests.map((r) => r.file)).toEqual(expect.arrayContaining(["index.html", "assets/main.js"]));
    expect(server.requests.find((r) => r.file === "assets/main.js")!.gzipBytes).toBeGreaterThan(0);
    void gunzipSync;
  });

  it("refuses paths outside the version folder", async () => {
    expect((await fetch(`${server.origin}/other/v1/index.html`)).status).toBe(404);
    expect((await fetch(`${server.origin}/fixture-good/v1/%2e%2e/%2e%2e/etc/passwd`)).status).toBeGreaterThanOrEqual(403);
    expect((await fetch(`${server.origin}/fixture-good/v1/missing.js`)).status).toBe(404);
  });
});
