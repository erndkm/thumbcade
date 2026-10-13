/**
 * `thumbcade()` — the Vite plugin every Thumbcade game uses (the templates add it for you):
 * - relative `base` so a bundle works under any versioned path;
 * - no modulepreload polyfill (it would be an inline script, which the game CSP blocks);
 * - validates thumbcade.json at build time and emits it at the bundle root;
 * - serves thumbcade.json in dev (the simulator and the standalone host read it).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "@thumbcade/protocol";
import type { Plugin } from "vite";

export function thumbcade(): Plugin {
  let root = process.cwd();
  return {
    name: "thumbcade",
    config(config) {
      return {
        base: config.base ?? "./",
        build: {
          modulePreload: { polyfill: false },
          target: config.build?.target ?? "es2022",
          // Engines (Phaser, Three.js, Pixi) are big single chunks; the reviewer enforces the real budget.
          chunkSizeWarningLimit: config.build?.chunkSizeWarningLimit ?? 2000,
        },
      };
    },
    configResolved(c) {
      root = c.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").split("?")[0]!.endsWith("/thumbcade.json")) return next();
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(readFileSync(join(root, "thumbcade.json")));
      });
    },
    generateBundle() {
      const raw = JSON.parse(readFileSync(join(root, "thumbcade.json"), "utf8")) as unknown;
      const v = validateManifest(raw);
      if (!v.ok) this.error(`thumbcade.json is invalid:\n  ${v.issues.join("\n  ")}`);
      this.emitFile({ type: "asset", fileName: "thumbcade.json", source: `${JSON.stringify(raw, null, 2)}\n` });
    },
  };
}

export default thumbcade;
