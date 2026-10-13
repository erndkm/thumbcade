// Copies generated brand assets from @thumbcade/design-tokens into the portal (run before dev/build).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = resolve(here, "../../../packages/design-tokens/brand");
const pub = resolve(here, "../public/brand");
const app = resolve(here, "../src/app");
mkdirSync(pub, { recursive: true });
for (const f of ["mark.svg", "lockup.svg", "wordmark.svg", "wordmark-ink.svg", "app-icon.png", "og-default-1200.png", "favicon-192.png", "favicon-512.png"]) {
  copyFileSync(resolve(brand, f), resolve(pub, f));
}
copyFileSync(resolve(brand, "favicon.svg"), resolve(app, "icon.svg"));
copyFileSync(resolve(brand, "favicon-180.png"), resolve(app, "apple-icon.png"));
copyFileSync(resolve(brand, "og-default-1200.png"), resolve(app, "opengraph-image.png"));
console.log("brand assets copied");
