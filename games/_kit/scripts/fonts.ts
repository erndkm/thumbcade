/**
 * Builds the two fonts every launch game may use:
 *  - mono.woff2     Departure Mono (OFL), the upstream woff2 copied byte for byte — scores, labels, prompts.
 *  - display.woff2  "TC Display Black": Mona Sans Display Expanded Black (OFL), subset to printable ASCII + a few
 *                   symbols — titles.
 *
 * A subset is a Modified Version under the OFL, and Mona Sans reserves the font name "Mona", so the subset gets
 * a name table of its own: new family/full/PostScript names, the original copyright, designer and vendor
 * records, and the license records (IDs 13/14). The license texts ship next to the fonts in every game bundle
 * (`src/vite.ts`).
 * Run: pnpm --filter @thumbcade-games/kit fonts
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { convert } from "fontverter";
import subsetFont from "subset-font";

const tokens = fileURLToPath(new URL("../../../packages/design-tokens/fonts/", import.meta.url));
const out = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

let ascii = "";
for (let c = 0x20; c <= 0x7e; c++) ascii += String.fromCharCode(c);
const extra = "×·•–—’“”…→←↑↓★♥✓";

/** The name the subset goes by. Must not contain the Reserved Font Name. */
const FAMILY = "TC Display";
const STYLE = "Black";
const POSTSCRIPT = "TCDisplay-Black";
const RESERVED = /mona/i;

// --- sfnt helpers -------------------------------------------------------------------------------

function readTables(font: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  const count = font.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    const offset = font.readUInt32BE(rec + 8);
    tables.set(font.toString("latin1", rec, rec + 4), font.subarray(offset, offset + font.readUInt32BE(rec + 12)));
  }
  return tables;
}

/** Windows/Unicode/en-US name records (the only ones the source font has), by name ID. */
function readNames(name: Buffer): Map<number, string> {
  const names = new Map<number, string>();
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((k) => name.readUInt16BE(rec + k)) as [number, number, number, number, number, number];
    if (platform !== 3 || encoding !== 1 || language !== 0x409) continue;
    const raw = name.subarray(strings + offset, strings + offset + length);
    let text = "";
    for (let j = 0; j + 1 < raw.length; j += 2) text += String.fromCharCode(raw.readUInt16BE(j));
    names.set(id, text);
  }
  return names;
}

/** A format-0 name table with Windows/Unicode/en-US records, sorted by name ID. */
function writeNames(records: Map<number, string>): Buffer {
  const sorted = [...records].sort(([a], [b]) => a - b);
  const strings = sorted.map(([, text]) => {
    const b = Buffer.alloc(text.length * 2);
    for (let i = 0; i < text.length; i++) b.writeUInt16BE(text.charCodeAt(i), i * 2);
    return b;
  });
  const header = Buffer.alloc(6 + sorted.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(sorted.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  sorted.forEach(([id], i) => {
    const rec = 6 + i * 12;
    for (const [k, v] of [3, 1, 0x409, id, strings[i]!.length, offset].entries()) header.writeUInt16BE(v, rec + k * 2);
    offset += strings[i]!.length;
  });
  return Buffer.concat([header, ...strings]);
}

function checksum(data: Buffer): number {
  const padded = data.length % 4 ? Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]) : data;
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

/** Reassembles an sfnt from its tables: sorted directory, 4-byte aligned, fresh checksums and head.checkSumAdjustment. */
function writeSfnt(flavor: number, tables: Map<string, Buffer>): Buffer {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const log2 = Math.floor(Math.log2(n));
  const dir = Buffer.alloc(12 + n * 16);
  dir.writeUInt32BE(flavor, 0);
  dir.writeUInt16BE(n, 4);
  dir.writeUInt16BE(2 ** log2 * 16, 6);
  dir.writeUInt16BE(log2, 8);
  dir.writeUInt16BE(n * 16 - 2 ** log2 * 16, 10);
  const bodies: Buffer[] = [];
  let offset = dir.length;
  let headOffset = -1;
  tags.forEach((tag, i) => {
    let data = tables.get(tag)!;
    if (tag === "head") {
      data = Buffer.from(data);
      data.writeUInt32BE(0, 8);
      headOffset = offset;
    }
    const rec = 12 + i * 16;
    dir.write(tag, rec, 4, "latin1");
    dir.writeUInt32BE(checksum(data), rec + 4);
    dir.writeUInt32BE(offset, rec + 8);
    dir.writeUInt32BE(data.length, rec + 12);
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    bodies.push(padded);
    offset += padded.length;
  });
  const font = Buffer.concat([dir, ...bodies]);
  if (headOffset >= 0) font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  return font;
}

// --- build --------------------------------------------------------------------------------------

await copyFile(`${tokens}web/DepartureMono-Regular.woff2`, `${out}mono.woff2`);

const source = await readFile(`${tokens}native/MonaSansDisplayExpanded-Black.ttf`);
const original = readNames(readTables(source).get("name")!);
const keep = (id: number): string => {
  const text = original.get(id);
  if (text === undefined) throw new Error(`MonaSansDisplayExpanded-Black.ttf has no name record ${id}`);
  return text;
};

const sfnt = await subsetFont(source, ascii + extra, { targetFormat: "truetype" });
const tables = readTables(sfnt);
const names = new Map<number, string>([
  [0, keep(0)],
  [1, `${FAMILY} ${STYLE}`],
  [2, "Regular"],
  [3, `${keep(5).replace(/^Version\s+/i, "")};${POSTSCRIPT}`],
  [4, `${FAMILY} ${STYLE}`],
  [5, `${keep(5)}; printable-ASCII subset`],
  [6, POSTSCRIPT],
  [8, keep(8)],
  [9, keep(9)],
  [10, "Modified Version (OFL 1.1): a printable-ASCII subset of the original font, renamed as its Reserved Font Name requires."],
  [11, keep(11)],
  [12, keep(12)],
  [13, keep(13)],
  [14, keep(14)],
  [16, FAMILY],
  [17, STYLE],
]);
// Keep any feature-name records (256+) the subset still references.
for (const [id, text] of readNames(tables.get("name")!)) if (id >= 256) names.set(id, text);
for (const [id, text] of names) {
  // The copyright notice (ID 0) has to stay verbatim; it names the original project.
  if (id !== 0 && RESERVED.test(text)) throw new Error(`name record ${id} still uses the Reserved Font Name: ${text}`);
}
tables.set("name", writeNames(names));
tables.delete("DSIG");

const renamed = writeSfnt(sfnt.readUInt32BE(0), tables);
const check = readNames(readTables(renamed).get("name")!);
if (check.get(1) !== `${FAMILY} ${STYLE}` || check.get(13) !== keep(13)) throw new Error("renamed name table did not round-trip");

const display = await convert(renamed, "woff2");
await writeFile(`${out}display.woff2`, display);
console.log(`display.woff2 ${display.length} B ("${FAMILY} ${STYLE}"), mono.woff2 copied`);
