import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { thumbcade } from "../src/vite.ts";
import { MANIFEST } from "./fixtures.ts";

async function project(manifest: object): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tc-vite-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><script type="module" src="/src/main.ts"></script></body></html>');
  await writeFile(join(root, "src/main.ts"), "document.body.dataset.ok = '1';");
  await writeFile(join(root, "thumbcade.json"), JSON.stringify(manifest));
  return root;
}

describe("thumbcade() Vite plugin", () => {
  it("builds with a relative base, no inline scripts, and thumbcade.json at the root", async () => {
    const root = await project(MANIFEST);
    await build({ root, logLevel: "silent", configFile: false, plugins: [thumbcade()] });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    expect(html).toMatch(/src="\.\/assets\/index-[\w-]+\.js"/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]+<\/script>/);
    expect(JSON.parse(await readFile(join(root, "dist/thumbcade.json"), "utf8")).id).toBe("fixture-game");
  });

  it("fails the build on an invalid manifest", async () => {
    const root = await project({ ...MANIFEST, accentColor: "orange" });
    await expect(build({ root, logLevel: "silent", configFile: false, plugins: [thumbcade()] })).rejects.toThrow(/accentColor/);
  });
});
