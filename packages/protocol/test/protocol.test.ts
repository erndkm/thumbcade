import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  envelope,
  formatCount,
  formatScore,
  gameEntryUrl,
  parseGameMessage,
  safeAccent,
  validateManifest,
} from "../src/index.ts";

const manifest = {
  id: "lane-rush",
  name: "Lane Rush",
  version: "1.0.0",
  sdk: "^1.0.0",
  description: "Three lanes. Zero chill.",
  tags: ["runner", "3d"],
  accentColor: "#FF6A1A",
  icon: "assets/icon.png",
  controls: { vertical: true, horizontal: true, inputs: ["swipe"] },
  score: { max: 1000000 },
};

describe("manifest", () => {
  it("accepts a valid manifest and applies defaults", () => {
    const r = validateManifest(manifest);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.entry).toBe("index.html");
      expect(r.manifest.ageRating).toBe("9+");
      expect(r.manifest.controls.multitouch).toBe(false);
      expect(r.manifest.score.order).toBe("desc");
    }
  });
  it("rejects bad slugs, hashtags and absolute paths", () => {
    const r = validateManifest({ ...manifest, id: "Lane Rush", tags: ["#Runner"], icon: "/etc/passwd" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
  it("rejects unknown keys", () => {
    expect(validateManifest({ ...manifest, permissions: ["camera"] }).ok).toBe(false);
  });
});

describe("bridge", () => {
  it("parses a valid game message from a JSON string", () => {
    const env = envelope("gameplay.end", { score: 42, outcome: "lose" });
    const r = parseGameMessage(JSON.stringify(env));
    expect(r.ok).toBe(true);
  });
  it("drops unknown types and bad payloads", () => {
    expect(parseGameMessage(envelope("camera.open", {})).ok).toBe(false);
    expect(parseGameMessage(envelope("gameplay.end", { score: "lots" })).ok).toBe(false);
    expect(parseGameMessage({ hello: true }).ok).toBe(false);
    expect(parseGameMessage("{not json").ok).toBe(false);
  });
  it("rejects analytics names outside the whitelist", () => {
    expect(parseGameMessage(envelope("analytics.track", { name: "credit_card" })).ok).toBe(false);
    expect(parseGameMessage(envelope("analytics.track", { name: "level_complete" })).ok).toBe(true);
  });
  it("rate limits per type", () => {
    const allow = createRateLimiter({ "storage.set": 2, default: 100 });
    expect(allow("storage.set", 0)).toBe(true);
    expect(allow("storage.set", 10)).toBe(true);
    expect(allow("storage.set", 20)).toBe(false);
    expect(allow("storage.set", 1500)).toBe(true);
  });
});

describe("urls", () => {
  it("builds subdomain and path entry URLs", () => {
    expect(gameEntryUrl({ slug: "snek", versionId: "v1" }, { mode: "subdomain", domain: "thumbcade.gg" })).toBe(
      "https://snek.thumbcade.gg/v1/index.html",
    );
    expect(gameEntryUrl({ slug: "snek", versionId: "v1" }, { mode: "path", base: "http://localhost:5555/" })).toBe(
      "http://localhost:5555/snek/v1/index.html",
    );
  });
});

describe("format", () => {
  it("formats counts", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1234)).toBe("1.2K");
    expect(formatCount(1_000)).toBe("1K");
    expect(formatCount(3_456_789)).toBe("3.4M");
    expect(formatCount(123_456)).toBe("123K");
  });
  it("formats scores", () => {
    expect(formatScore(9842)).toBe("9,842");
    expect(formatScore(12345, { format: "ms" })).toBe("12.35s");
    expect(formatScore(120, { format: "integer", unit: "m" })).toBe("120m");
  });
  it("falls back when an accent has poor contrast", () => {
    expect(safeAccent("#111111")).toBe("#F3F0E8");
    expect(safeAccent("#D4FF3D")).toBe("#D4FF3D");
  });
});
