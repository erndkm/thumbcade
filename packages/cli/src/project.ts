import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MANIFEST_FILENAME, validateManifest, type Manifest } from "@thumbcade/protocol";
import { manifestFix } from "./checks/index.ts";
import { CliError } from "./ui.ts";

/** Walks up from `start` to the folder holding thumbcade.json. */
export function findProjectRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, MANIFEST_FILENAME))) return dir;
    const up = dirname(dir);
    if (up === dir) {
      throw new CliError(
        "No thumbcade.json here or in any parent folder.",
        "Run this inside a game project, or create one with: npm create thumbcade-game@latest",
      );
    }
    dir = up;
  }
}

export interface ProjectManifest {
  raw: unknown;
  manifest: Manifest | null;
  issues: Array<{ message: string; fix?: string }>;
}

export async function readProjectManifest(root: string): Promise<ProjectManifest> {
  const text = await readFile(join(root, MANIFEST_FILENAME), "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { raw: null, manifest: null, issues: [{ message: `thumbcade.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }] };
  }
  const v = validateManifest(raw);
  if (v.ok) return { raw, manifest: v.manifest, issues: [] };
  return { raw, manifest: null, issues: v.issues.map((m) => ({ message: m, fix: manifestFix(m) })) };
}
