import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "@thumbcade/protocol";
import type { Plugin, UserConfig } from "vite";

/**
 * Shared Vite setup for the launch games:
 * - relative base, so a bundle works under any path (/<slug>/<versionId>/ locally, <slug>.thumbcade.gg/<v>/ in prod);
 * - no inline scripts (the game origin's CSP is script-src 'self');
 * - emits the validated `thumbcade.json` at the bundle root and renders `art/icon.svg` to the 1024² icon;
 * - serves `/thumbcade.json` in dev so the standalone host and the simulator can read it.
 */
export function thumbcadeGame(): Plugin {
  let root = process.cwd();
  return {
    name: "thumbcade-game",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use("/thumbcade.json", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(readFileSync(join(root, "thumbcade.json")));
      });
    },
    async generateBundle() {
      const raw = JSON.parse(readFileSync(join(root, "thumbcade.json"), "utf8")) as unknown;
      const result = validateManifest(raw);
      if (!result.ok) this.error(`thumbcade.json is invalid:\n  ${result.issues.join("\n  ")}`);
      this.emitFile({ type: "asset", fileName: "thumbcade.json", source: `${JSON.stringify(raw, null, 2)}\n` });
      const svg = join(root, "art", "icon.svg");
      if (result.ok && existsSync(svg)) {
        const { default: sharp } = await import("sharp");
        const png = await sharp(readFileSync(svg), { density: 300 })
          .resize(1024, 1024)
          .png({ compressionLevel: 9, palette: false })
          .toBuffer();
        this.emitFile({ type: "asset", fileName: result.manifest.icon, source: png });
      }
    },
  };
}

export function defineGame(extra: UserConfig = {}): UserConfig {
  return {
    base: "./",
    ...extra,
    build: {
      target: "es2022",
      outDir: "dist",
      assetsDir: "assets",
      emptyOutDir: true,
      modulePreload: { polyfill: false },
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1500,
      ...extra.build,
    },
    plugins: [thumbcadeGame(), ...(extra.plugins ?? [])],
  };
}
