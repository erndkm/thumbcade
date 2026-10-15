import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * The design-tokens package on disk. Turbopack's dev server resolves packages to virtual
 * `[project]/…` paths that `readFile` can't open, so fall back to the workspace layout.
 */
function tokensDir(): string {
  const resolved = dirname(require.resolve("@thumbcade/design-tokens/package.json"));
  return existsSync(resolved) ? resolved : join(process.cwd(), "../../packages/design-tokens");
}

/** Fonts for next/og ImageResponse (satori needs TTF/OTF buffers). */
export async function ogFonts() {
  const dir = join(tokensDir(), "fonts/native");
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
  const dir = join(tokensDir(), "brand");
  const svg = await readFile(join(dir, "mark.svg"));
  return `data:image/svg+xml;base64,${svg.toString("base64")}`;
}

const OG_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];

/**
 * Fetches an image for an OG card and inlines it. next/og refuses loopback URLs (SSRF protection), which is
 * where local storage serves icons, and an inlined image can't take the whole card down: on any failure
 * this returns null and the card renders without it.
 */
export async function imageDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!res.ok || !OG_IMAGE_TYPES.includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 2 * 1024 * 1024) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
