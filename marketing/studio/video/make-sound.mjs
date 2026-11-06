// Renders a spot's soundtrack (comp/sound.js) with Chromium's OfflineAudioContext.
//   node make-sound.mjs <spot> [cut]   -> out/<spot>[-<cut>].wav
import { chromium } from "playwright";
import fs from "node:fs";
const HERE = new URL(".", import.meta.url).pathname;
const [spot, cut = ""] = process.argv.slice(2);
const name = `${spot}${cut ? `-${cut}` : ""}.wav`;
const b = await chromium.launch();
const p = await b.newPage();
p.on("pageerror", (e) => console.error(e));
await p.goto("about:blank");
await p.addScriptTag({ path: `${HERE}comp/sound.js` });
const { b64, peak } = await p.evaluate(([s, c]) => window.renderSound(s, c), [spot, cut]);
fs.mkdirSync(`${HERE}out`, { recursive: true });
fs.writeFileSync(`${HERE}out/${name}`, Buffer.from(b64, "base64"));
console.log(`${name} written, raw peak`, peak.toFixed(3));
await b.close();
