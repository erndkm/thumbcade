// @vitest-environment node
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

describe("bundle budget", () => {
  it("the game-facing SDK is <= 8 KB gzipped (minified, everything included) and ships no zod", async () => {
    const out = await build({ entryPoints: [entry], bundle: true, minify: true, format: "esm", write: false, target: "es2020" });
    const code = out.outputFiles[0]!.contents;
    const gz = gzipSync(code, { level: 9 }).length;
    console.info(`@thumbcade/sdk: ${code.length} B minified, ${gz} B gzipped`);
    expect(gz).toBeLessThanOrEqual(8 * 1024);
    const text = new TextDecoder().decode(code);
    expect(text).not.toMatch(/zod|ZodError/);
  });
});
