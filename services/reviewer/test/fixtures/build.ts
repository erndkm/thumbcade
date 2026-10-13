import { build } from "esbuild";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function png1024(): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(1024, 16);
  b.writeUInt32BE(1024, 20);
  return b;
}

/** Bundles a fixture game (test/fixtures/<name>/main.ts) into a reviewable bundle directory. */
export async function buildFixture(name: "good" | "bad"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `tc-review-${name}-`));
  await mkdir(join(dir, "assets"), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL(`./${name}/main.ts`, import.meta.url))],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: join(dir, "assets/main.js"),
    logLevel: "silent",
  });
  await writeFile(
    join(dir, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style><script type="module" src="./assets/main.js"></script></head><body></body></html>',
  );
  await writeFile(join(dir, "assets/icon.png"), png1024());
  await writeFile(
    join(dir, "thumbcade.json"),
    JSON.stringify({
      id: `fixture-${name}`,
      name: `Fixture ${name}`,
      version: "1.0.0",
      sdk: "^1.0.0",
      description: "Reviewer fixture.",
      tags: ["test"],
      accentColor: "#FF6A1A",
      icon: "assets/icon.png",
      controls: { vertical: false, inputs: ["tap"] },
      score: { max: 100 },
    }),
  );
  return dir;
}
