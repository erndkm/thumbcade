/**
 * Builds the font library for games that don't wear the house style (assets/fonts/library/<family>/):
 * upstream OFL fonts from google/fonts at a pinned commit, variable axes pinned to one instance each,
 * subset to printable ASCII plus a few symbols, compressed to woff2. Each family folder keeps its OFL.txt,
 * which `src/vite.ts` ships as `licenses/OFL-<family>.txt` in every bundle that uses one of its fonts.
 *
 * None of these families has a Reserved Font Name, so the modified (instanced + subset) files keep their names.
 * Run: pnpm --filter @thumbcade-games/kit fonts:library [family …]   (no families = all of them)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const COMMIT = "47d54ca1ebb14fd864695f1d39dc734f39017c33";
const RAW = `https://raw.githubusercontent.com/google/fonts/${COMMIT}/ofl`;
const out = fileURLToPath(new URL("../assets/fonts/library/", import.meta.url));

let text = "";
for (let c = 0x20; c <= 0x7e; c++) text += String.fromCharCode(c);
text += "×·•–—‘’“”…→←↑↓★♥✓°";

interface Face {
  /** Output file name (without .woff2). */
  name: string;
  source: string;
  axes?: Record<string, number>;
}

const FAMILIES: Record<string, Face[]> = {
  "instrument-serif": [
    { name: "InstrumentSerif-Regular", source: "instrumentserif/InstrumentSerif-Regular.ttf" },
    { name: "InstrumentSerif-Italic", source: "instrumentserif/InstrumentSerif-Italic.ttf" },
  ],
  fredoka: [
    { name: "Fredoka-SemiBold", source: "fredoka/Fredoka[wdth,wght].ttf", axes: { wdth: 100, wght: 600 } },
    { name: "Fredoka-Bold", source: "fredoka/Fredoka[wdth,wght].ttf", axes: { wdth: 100, wght: 700 } },
  ],
  caveat: [
    { name: "Caveat-Medium", source: "caveat/Caveat[wght].ttf", axes: { wght: 500 } },
    { name: "Caveat-Bold", source: "caveat/Caveat[wght].ttf", axes: { wght: 700 } },
  ],
  rubik: [
    { name: "Rubik-Medium", source: "rubik/Rubik[wght].ttf", axes: { wght: 500 } },
    { name: "Rubik-Black", source: "rubik/Rubik[wght].ttf", axes: { wght: 900 } },
  ],
  jost: [
    { name: "Jost-Light", source: "jost/Jost[wght].ttf", axes: { wght: 300 } },
    { name: "Jost-Medium", source: "jost/Jost[wght].ttf", axes: { wght: 500 } },
  ],
  bungee: [{ name: "Bungee-Regular", source: "bungee/Bungee-Regular.ttf" }],
  bricolage: [
    { name: "Bricolage-CondensedExtraBold", source: "bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf", axes: { opsz: 96, wdth: 75, wght: 800 } },
    { name: "Bricolage-Medium", source: "bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf", axes: { opsz: 14, wdth: 100, wght: 500 } },
  ],
};

async function fetchBuffer(path: string): Promise<Buffer> {
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const only = process.argv.slice(2);
for (const [family, faces] of Object.entries(FAMILIES)) {
  if (only.length && !only.includes(family)) continue;
  const dir = `${out}${family}/`;
  await mkdir(dir, { recursive: true });
  const ofl = (await fetchBuffer(`${faces[0]!.source.split("/")[0]}/OFL.txt`)).toString("utf8");
  if (/with Reserved Font Name/i.test(ofl)) throw new Error(`${family}: has a Reserved Font Name; subset it under a new name instead`);
  await writeFile(`${dir}OFL.txt`, ofl);
  const sources = new Map<string, Buffer>();
  for (const face of faces) {
    let src = sources.get(face.source);
    if (!src) sources.set(face.source, (src = await fetchBuffer(face.source)));
    const woff2 = await subsetFont(src, text, { targetFormat: "woff2", ...(face.axes ? { variationAxes: face.axes } : {}) });
    await writeFile(`${dir}${face.name}.woff2`, woff2);
    console.log(`${family}/${face.name}.woff2 ${woff2.length} B`);
  }
}
