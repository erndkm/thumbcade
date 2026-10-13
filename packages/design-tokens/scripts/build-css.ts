import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTailwindTheme, buildTokensCss } from "../src/css.ts";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
mkdirSync(dist, { recursive: true });
writeFileSync(resolve(dist, "tokens.css"), buildTokensCss("../fonts/web"));
writeFileSync(resolve(dist, "theme.css"), buildTailwindTheme());
console.log("wrote dist/tokens.css and dist/theme.css");
