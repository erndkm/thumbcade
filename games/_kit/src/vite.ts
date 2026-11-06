import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@thumbcade/protocol";
import type { Plugin, UserConfig } from "vite";

const FONTS = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

/** The kit's fonts and the license text that has to travel with each of them (SIL OFL 1.1, condition 2). */
const FONT_LICENSES = [
  {
    font: "display.woff2",
    license: "OFL-MonaSans.txt",
    preface:
      'The title font (assets/display-*.woff2, family "TC Display Black") is a Modified Version of Mona Sans\n' +
      'Display Expanded Black: a printable-ASCII subset, renamed because Mona Sans reserves the font name "Mona".\n' +
      "It is distributed under the same license:\n\n",
  },
  { font: "mono.woff2", license: "OFL-DepartureMono.txt", preface: "" },
];

/** Where every bundle keeps its license texts. */
export const LICENSES_DIR = "licenses";

/**
 * Shared Vite setup for the launch games:
 * - relative base, so a bundle works under any path (/<slug>/<versionId>/ locally, <slug>.thumbcade.gg/<v>/ in prod);
 * - no inline scripts (the game origin's CSP is script-src 'self');
 * - emits the validated `thumbcade.json` at the bundle root and renders `art/icon.svg` to the 1024² icon;
 * - ships the license texts: `licenses/libraries.txt` (Vite's report of every bundled npm package) and the OFL
 *   text of each kit font the bundle contains;
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
    async generateBundle(_options, bundle) {
      const shipped = Object.values(bundle).flatMap((f) => (f.type === "asset" ? f.originalFileNames.map((p) => p.replaceAll("\\", "/")) : []));
      for (const { font, license, preface } of FONT_LICENSES) {
        if (!shipped.some((p) => p.endsWith(`assets/fonts/${font}`))) continue;
        this.emitFile({ type: "asset", fileName: `${LICENSES_DIR}/${license}`, source: preface + readFileSync(join(FONTS, license), "utf8") });
      }
      // Library fonts (assets/fonts/library/<family>/, scripts/library-fonts.ts): each family folder carries its OFL.txt.
      const families = new Set(shipped.map((p) => /assets\/fonts\/library\/([^/]+)\//.exec(p)?.[1]).filter((f): f is string => !!f));
      for (const family of families) {
        this.emitFile({ type: "asset", fileName: `${LICENSES_DIR}/OFL-${family}.txt`, source: readFileSync(join(FONTS, "library", family, "OFL.txt"), "utf8") });
      }
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
      // MIT/ISC/BSD all require their notice in every copy; minified chunks keep none.
      license: { fileName: `${LICENSES_DIR}/libraries.txt` },
      ...extra.build,
    },
    plugins: [thumbcadeGame(), ...(extra.plugins ?? [])],
  };
}
