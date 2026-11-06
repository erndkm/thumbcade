// Renders comp/music.js with Chromium's OfflineAudioContext.
//   node make-music.mjs        -> out/music.wav    (26.5 s)
//   node make-music.mjs 15     -> out/music-15.wav (15 s cut)
import { chromium } from "playwright";
import fs from "node:fs";
const ROOT = new URL(".", import.meta.url).pathname;
const cut = process.argv[2] || "";
const name = cut ? `music-${cut}.wav` : "music.wav";
const b = await chromium.launch();
const p = await b.newPage();
p.on("pageerror", (e) => console.error(e));
await p.goto("about:blank");
await p.addScriptTag({ path: `${ROOT}comp/music.js` });
const { b64, peak } = await p.evaluate((c) => window.renderMusic(c), cut);
fs.mkdirSync(`${ROOT}out`, { recursive: true });
fs.writeFileSync(`${ROOT}out/${name}`, Buffer.from(b64, "base64"));
console.log(`${name} written, raw peak`, peak.toFixed(3));
await b.close();
