import { describe, expect, it } from "vitest";
import {
  bundleFileProblem,
  createRateLimiter,
  envelope,
  executableKind,
  formatCount,
  formatScore,
  gameEntryUrl,
  parseGameMessage,
  formatPlaytime,
  METRIC_DEFINITIONS,
  milestoneCopy,
  nonstopSpan,
  rateOrNull,
  safeAccent,
  validateManifest,
} from "../src/index.ts";

const manifest = {
  id: "duskrail",
  name: "Duskrail",
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
    const r = validateManifest({ ...manifest, id: "Dusk Rail", tags: ["#Runner"], icon: "/etc/passwd" });
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

describe("creator analytics", () => {
  it("formats playtime without rounding up", () => {
    expect(formatPlaytime(8_449)).toBe("8.4 s");
    expect(formatPlaytime(42_900)).toBe("42 s");
    expect(formatPlaytime(72_000)).toBe("1 min 12 s");
    expect(formatPlaytime(12 * 60_000 + 59_000)).toBe("12 min");
    expect(formatPlaytime(3.56 * 3_600_000)).toBe("3.5 h");
    expect(formatPlaytime(1_234 * 3_600_000)).toBe("1.2K h");
  });

  it("writes milestone copy that never claims more than happened", () => {
    expect(milestoneCopy({ kind: "players", threshold: 10_000, value: 10_212, detail: {} }, "Duskrail")).toMatchObject({
      title: "10K players",
      body: "Duskrail just passed 10,000 players.",
      figureText: "10,000",
    });
    expect(milestoneCopy({ kind: "playtime", threshold: 1000, value: 1003, detail: {} }, "Stackd").body).toBe(
      "1,000 hours played in Stackd. That's more than 5 weeks of nonstop play.",
    );
    expect(milestoneCopy({ kind: "taking_off", threshold: 20261014, value: 3.4, detail: { players: 680, ratio: 3.4 } }, "Snek")).toMatchObject({
      body: "Snek is taking off: 3.4× your usual players today.",
      figureText: "3.4×",
    });
    expect(nonstopSpan(100)).toBe("4 days");
    expect(nonstopSpan(10_000)).toBe("1 year");
  });

  it("has a definition for every metric and a rate floor", () => {
    for (const [id, def] of Object.entries(METRIC_DEFINITIONS)) {
      expect(def.label.length, id).toBeGreaterThan(2);
      expect(def.definition.endsWith("."), id).toBe(true);
    }
    expect(rateOrNull(5, 19, 20)).toBeNull();
    expect(rateOrNull(5, 20, 20)).toBe(0.25);
    expect(rateOrNull(0, 0, 0)).toBeNull();
  });
});

describe("bundle files", () => {
  it("allows web code and media, refuses everything else", () => {
    for (const ok of ["index.html", "assets/index-D0z.js", "licenses/OFL.txt", "a/b/model.glb", "Sound.OGG", "fonts/x.woff2"]) expect(bundleFileProblem(ok)).toBeNull();
    expect(bundleFileProblem("tools/setup.exe")).toBe(".exe files are not allowed");
    expect(bundleFileProblem("payload.zip")).toBe(".zip files are not allowed");
    expect(bundleFileProblem("server.php")).toBe(".php files are not allowed");
    expect(bundleFileProblem(".env")).toBe("hidden files are not allowed");
    expect(bundleFileProblem("assets/.DS_Store")).toBe("hidden files are not allowed");
    expect(bundleFileProblem("LICENSE")).toBe("files need an extension");
  });

  it("recognises native executables by their bytes", () => {
    const pe = new Uint8Array(256);
    pe.set([0x4d, 0x5a]);
    pe.set([0x80, 0, 0, 0], 60);
    pe.set([0x50, 0x45, 0, 0], 0x80);
    expect(executableKind(pe)).toBe("a Windows executable");
    expect(executableKind(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1]))).toBe("a Linux (ELF) executable");
    expect(executableKind(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 7, 0]))).toBe("a macOS (Mach-O) executable");
    // "MZ" by chance (say, the start of a binary buffer) is not enough.
    const mz = new Uint8Array(256);
    mz.set([0x4d, 0x5a]);
    expect(executableKind(mz)).toBeNull();
    expect(executableKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
