// Builds private copies of the launch games into the scratchpad with small in-memory patches
// (no repo files are modified). Usage: node build-games.mjs [game ...]
import { pathToFileURL } from "node:url";
import { patches } from "./patches.mjs";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const OUT = new URL("../games-built/", import.meta.url).pathname;
const ALL = ["duskrail","flapjack","heatfall","kingsnare","kneejerk","mines","neon-chop","pairs","shortwick","snek","stackd","voltbrick"];
const which = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

for (const g of which) {
  const root = `${REPO}/games/${g}`;
  const { build } = await import(pathToFileURL(`${REPO}/node_modules/vite/dist/node/index.js`).href);
  const list = patches[g] ?? [];
  const sdkList = patches.__sdk ?? [];
  let applied = 0;
  const plugin = {
    name: "trailer-patch",
    enforce: "pre",
    transform(code, id) {
      const apply = (rules) => {
        for (const [from, to] of rules) {
          if (!code.includes(from)) throw new Error(`[${g}] patch not found in ${id}:\n${from}`);
          code = code.split(from).join(to);
          applied++;
        }
      };
      if (id.endsWith(`/games/${g}/src/main.ts`)) apply(list.filter((r) => !r[2]));
      for (const r of list.filter((r) => r[2])) if (id.endsWith(r[2])) apply([r]);
      if (id.endsWith("/packages/sdk/src/standalone.ts")) apply(sdkList);
      return code;
    },
  };
  await build({
    root,
    configFile: `${root}/vite.config.ts`,
    logLevel: "warn",
    plugins: [plugin],
    build: { outDir: `${OUT}${g}`, emptyOutDir: true, minify: false, license: false },
  });
  console.log(`built ${g} (${applied} patches)`);
}
