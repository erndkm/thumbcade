import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_SCHEMA_URL, validateManifest } from "@thumbcade/protocol";
import { renderIcon, renderPoster } from "./art.ts";
import { backgroundFor, CONTROL_STYLES, TEMPLATES, VERSIONS, type ControlStyle, type TemplateId } from "./options.ts";

export interface ScaffoldOptions {
  dir: string;
  name: string;
  slug: string;
  template: TemplateId;
  controls: ControlStyle;
  accent: string;
  /** Use local checkouts of @thumbcade/sdk and @thumbcade/cli (monorepo development, e2e tests). */
  local?: { sdk: string; cli: string };
}

const TEXT = new Set([".ts", ".tsx", ".js", ".json", ".html", ".css", ".md", ""]);
const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));

async function copyTree(from: string, to: string, tokens: Record<string, string>): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const name = entry.name === "_gitignore" ? ".gitignore" : entry.name;
    const dest = join(to, name);
    if (entry.isDirectory()) await copyTree(src, dest, tokens);
    else if (TEXT.has(extname(entry.name))) {
      let text = await readFile(src, "utf8");
      for (const [k, v] of Object.entries(tokens)) text = text.split(k).join(v);
      await writeFile(dest, text);
    } else await copyFile(src, dest);
  }
}

export async function scaffold(o: ScaffoldOptions): Promise<string[]> {
  if (existsSync(o.dir) && (await readdir(o.dir)).length > 0) throw new Error(`${o.dir} already exists and isn't empty.`);
  const t = TEMPLATES[o.template];
  const bg = backgroundFor(o.accent);
  const tokens = {
    __NAME_UPPER__: o.name.toUpperCase().replace(/"/g, '\\"'),
    __NAME__: o.name,
    __SLUG__: o.slug,
    __ACCENT__: o.accent,
    __BG__: bg,
    __TEMPLATE_LABEL__: t.label,
  };
  await copyTree(join(templatesDir, "_base"), o.dir, tokens);
  await copyTree(join(templatesDir, o.template), o.dir, tokens);

  const sdk = o.local ? `file:${o.local.sdk}` : VERSIONS.sdk;
  const cli = o.local ? `file:${o.local.cli}` : VERSIONS.cli;
  const pkg = {
    name: o.slug,
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "thumbcade dev",
      device: "thumbcade dev --device",
      build: "vite build",
      validate: "thumbcade validate",
      release: "thumbcade publish",
      typecheck: "tsc --noEmit",
    },
    dependencies: { "@thumbcade/sdk": sdk, ...t.deps },
    devDependencies: { "@thumbcade/cli": cli, typescript: VERSIONS.typescript, vite: VERSIONS.vite, ...t.devDeps },
  };
  await writeFile(join(o.dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  const manifest = {
    $schema: MANIFEST_SCHEMA_URL,
    id: o.slug,
    name: o.name,
    version: "0.1.0",
    sdk: VERSIONS.sdk,
    entry: "index.html",
    description: t.description,
    tags: t.tags,
    accentColor: o.accent,
    icon: "assets/icon.png",
    poster: "assets/poster.png",
    ageRating: "4+",
    controls: CONTROL_STYLES[o.controls].controls,
    session: "short",
    audio: true,
    orientation: "portrait",
    score: { order: "desc", max: 100000, format: "integer" },
  };
  const v = validateManifest(manifest);
  if (!v.ok) throw new Error(`Generated an invalid thumbcade.json:\n${v.issues.join("\n")}`);
  await writeFile(join(o.dir, "thumbcade.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  await mkdir(join(o.dir, "public", "assets"), { recursive: true });
  await writeFile(join(o.dir, "public", "assets", "icon.png"), await renderIcon(o.name, o.accent));
  await writeFile(join(o.dir, "public", "assets", "poster.png"), await renderPoster(o.name, o.accent));
  return ["package.json", "thumbcade.json", "public/assets/icon.png", "public/assets/poster.png", "src/main.ts"];
}
