import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contrastRatio, validateManifest } from "@thumbcade/protocol";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { initials } from "../src/art.ts";
import { ACCENTS, backgroundFor, main, pickAccent, scaffold, slugify, TEMPLATES, type TemplateId } from "../src/index.ts";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

describe("options", () => {
  it("turns names into valid, immutable-looking slugs", () => {
    expect(slugify("Night Shift")).toBe("night-shift");
    expect(slugify("  Café   Crème!! ")).toBe("cafe-creme");
    expect(slugify("Z")).toBe("z-game");
    expect(slugify("A".repeat(60))).toHaveLength(40);
  });

  it("picks a stable accent that reads on ink, and derives a dark background from it", () => {
    expect(pickAccent("Night Shift")).toBe(pickAccent("Night Shift"));
    for (const a of ACCENTS) {
      expect(contrastRatio(a, "#0D0D10")).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(a, backgroundFor(a))).toBeGreaterThanOrEqual(3);
    }
  });

  it("makes initials for the icon", () => {
    expect(initials("Star Catch")).toBe("SC");
    expect(initials("dodge")).toBe("D");
  });
});

describe("scaffold", () => {
  for (const template of Object.keys(TEMPLATES) as TemplateId[]) {
    it(`${template}: a complete project with a valid manifest, a 1024² icon and a 1080×1920 poster`, async () => {
      const dir = join(await mkdtemp(join(tmpdir(), "tc-create-")), "game");
      await scaffold({ dir, name: "Night Shift", slug: "night-shift", template, controls: TEMPLATES[template].controls, accent: "#3DE0FF" });
      const files = (await walk(dir)).map((f) => f.slice(dir.length + 1)).sort();
      for (const f of ["package.json", "thumbcade.json", "index.html", "vite.config.ts", "tsconfig.json", "README.md", ".gitignore", "src/main.ts", "src/sound.ts", "src/tap.ts", "public/assets/icon.png", "public/assets/poster.png"]) {
        expect(files).toContain(f);
      }
      const manifest = JSON.parse(await readFile(join(dir, "thumbcade.json"), "utf8"));
      expect(validateManifest(manifest).ok).toBe(true);
      expect(manifest).toMatchObject({ id: "night-shift", name: "Night Shift", accentColor: "#3DE0FF", poster: "assets/poster.png" });
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      expect(pkg.dependencies["@thumbcade/sdk"]).toBe("^1.0.0");
      expect(pkg.devDependencies["@thumbcade/cli"]).toBe("^1.0.0");
      expect(pkg.scripts).toMatchObject({ dev: "thumbcade dev", validate: "thumbcade validate", release: "thumbcade publish" });
      for (const dep of Object.keys(TEMPLATES[template].deps)) expect(pkg.dependencies[dep]).toBeDefined();
      for (const f of files.filter((x) => /\.(ts|html|css|json|md)$/.test(x))) {
        expect(await readFile(join(dir, f), "utf8"), f).not.toMatch(/__[A-Z_]+__/);
      }
      const main = await readFile(join(dir, "src/main.ts"), "utf8");
      // Phaser runs its own loop and sleeps it on pause; the others render inside tc.loop.
      const loop = template === "phaser" ? "game.loop.sleep()" : "tc.loop";
      for (const call of ["tc.init(", "tc.ready()", "tc.gameplay.start()", "tc.gameplay.end(", "tc.storage", loop, '"replay"']) expect(main).toContain(call);
      const icon = await sharp(join(dir, "public/assets/icon.png")).metadata();
      expect([icon.width, icon.height]).toEqual([1024, 1024]);
      const poster = await sharp(join(dir, "public/assets/poster.png")).metadata();
      expect([poster.width, poster.height]).toEqual([1080, 1920]);
    });
  }

  it("refuses to overwrite a non-empty folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tc-create-"));
    await scaffold({ dir: join(dir, "a"), name: "A Game", slug: "a-game", template: "blank", controls: "tap", accent: "#FF6A1A" });
    await expect(scaffold({ dir: join(dir, "a"), name: "A Game", slug: "a-game", template: "blank", controls: "tap", accent: "#FF6A1A" })).rejects.toThrow(/isn't empty/);
  });

  it("links local checkouts with --local", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "tc-create-")), "linked");
    await scaffold({ dir, name: "Linked", slug: "linked", template: "canvas", controls: "vertical", accent: "#FF6A1A", local: { sdk: "/repo/packages/sdk", cli: "/repo/packages/cli" } });
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies["@thumbcade/sdk"]).toBe("file:/repo/packages/sdk");
    const manifest = JSON.parse(await readFile(join(dir, "thumbcade.json"), "utf8"));
    expect(manifest.controls.vertical).toBe(true);
  });
});

describe("main (non-interactive)", () => {
  it("validates flags", async () => {
    const err = console.error;
    console.error = () => undefined;
    try {
      expect(await main(["x", "--template", "unity", "--yes", "--no-install"])).toBe(2);
      expect(await main(["x", "--accent", "orange", "--yes", "--no-install"])).toBe(2);
      expect(await main(["x", "--controls", "tilt", "--yes", "--no-install"])).toBe(2);
    } finally {
      console.error = err;
    }
  });
});
