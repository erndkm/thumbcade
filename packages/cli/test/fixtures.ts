import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A buffer that passes PNG size sniffing (signature + IHDR). */
export function fakePng(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/** A minimal baseline JPEG header with an SOF0 segment. */
export function fakeJpeg(w: number, h: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0]);
}

export const MANIFEST = {
  id: "fixture-game",
  name: "Fixture",
  version: "1.0.0",
  sdk: "^1.0.0",
  entry: "index.html",
  description: "A fixture for tests.",
  tags: ["test"],
  accentColor: "#FF6A1A",
  icon: "assets/icon.png",
  controls: { vertical: false, horizontal: false, multitouch: false, inputs: ["tap"] },
  score: { order: "desc", max: 1000, format: "integer" },
};

export const GOOD_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="./assets/main.js"></script></head><body></body></html>`;

/** Writes a bundle directory; `files` overrides/extends the default good bundle. */
export async function bundle(files: Record<string, string | Buffer | null> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tc-cli-test-"));
  const all: Record<string, string | Buffer | null> = {
    "thumbcade.json": JSON.stringify(MANIFEST),
    "index.html": GOOD_HTML,
    "assets/main.js": 'import "./chunk.js";\nconsole.log("hi");',
    "assets/chunk.js": "export const x = 1;",
    "assets/later.js": "export const lazy = 2;",
    "assets/icon.png": fakePng(1024, 1024),
    ...files,
  };
  for (const [path, data] of Object.entries(all)) {
    if (data === null) continue;
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), data);
  }
  return dir;
}
