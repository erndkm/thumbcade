import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Manifest } from "@thumbcade/protocol";
import type * as Vite from "vite";
import { CliError } from "./ui.ts";

type ViteModule = typeof Vite;

/** Finds `node_modules/<name>` walking up from `from`. */
function findPackageDir(from: string, name: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The project's own Vite (so its plugins match), falling back to the CLI's. */
export async function loadVite(root: string): Promise<ViteModule> {
  const dir = findPackageDir(root, "vite");
  if (dir) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { exports?: Record<string, unknown>; module?: string; main?: string };
    const dot = pkg.exports?.["."] as string | Record<string, unknown> | undefined;
    const pick = (v: unknown): string | undefined =>
      typeof v === "string" ? v : v && typeof v === "object" ? pick((v as Record<string, unknown>).import ?? (v as Record<string, unknown>).default) : undefined;
    const entry = pick(dot) ?? pkg.module ?? pkg.main;
    if (entry) return (await import(pathToFileURL(join(dir, entry)).href)) as ViteModule;
  }
  try {
    return await import("vite");
  } catch {
    throw new CliError("Vite isn't installed in this project.", "Run your package manager's install (npm install) and try again.");
  }
}

/**
 * Production build with the project's vite.config, then makes sure the bundle root holds
 * thumbcade.json and the icon/poster it references (copied from the project when the build lacks them).
 */
export async function buildProject(root: string, manifest: Manifest, opts: { quiet?: boolean } = {}): Promise<string> {
  const vite = await loadVite(root);
  const config = await vite.resolveConfig({ root, mode: "production" }, "build", "production");
  const outDir = resolve(root, config.build.outDir);
  try {
    await vite.build({ root, mode: "production", logLevel: opts.quiet ? "error" : "warn" });
  } catch (err) {
    throw new CliError(`The build failed: ${err instanceof Error ? err.message : String(err)}`, "Fix the error above and run the command again.");
  }
  await copyFile(join(root, "thumbcade.json"), join(outDir, "thumbcade.json"));
  for (const asset of [manifest.icon, manifest.poster]) {
    if (!asset || existsSync(join(outDir, asset))) continue;
    for (const src of [join(root, asset), join(root, "public", asset)]) {
      if (existsSync(src)) {
        await mkdir(dirname(join(outDir, asset)), { recursive: true });
        await copyFile(src, join(outDir, asset));
        break;
      }
    }
  }
  return outDir;
}
