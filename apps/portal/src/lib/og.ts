import "server-only";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Fonts for next/og ImageResponse (satori needs TTF/OTF buffers). */
export async function ogFonts() {
  const dir = join(dirname(require.resolve("@thumbcade/design-tokens/package.json")), "fonts/native");
  const [black, semi, mono] = await Promise.all([
    readFile(join(dir, "MonaSansDisplayExpanded-Black.ttf")),
    readFile(join(dir, "MonaSans-SemiBold.ttf")),
    readFile(join(dir, "DepartureMono-Regular.otf")),
  ]);
  return [
    { name: "Display", data: black, weight: 900 as const, style: "normal" as const },
    { name: "Sans", data: semi, weight: 600 as const, style: "normal" as const },
    { name: "Mono", data: mono, weight: 400 as const, style: "normal" as const },
  ];
}

export async function brandMarkDataUrl(): Promise<string> {
  const dir = join(dirname(require.resolve("@thumbcade/design-tokens/package.json")), "brand");
  const svg = await readFile(join(dir, "mark.svg"));
  return `data:image/svg+xml;base64,${svg.toString("base64")}`;
}
