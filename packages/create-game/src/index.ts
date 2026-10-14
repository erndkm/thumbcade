/**
 * npm create thumbcade-game@latest [dir] [--name "My Game"] [--template canvas|phaser|pixi|three|blank]
 *   [--controls tap|horizontal|vertical] [--accent #RRGGBB] [--yes] [--no-install] [--local <thumbcade repo>]
 */
import { spawn } from "node:child_process";
import { basename, relative, resolve } from "node:path";
import { parseArgs, styleText } from "node:util";
import * as p from "@clack/prompts";
import { HEX_COLOR_PATTERN } from "@thumbcade/protocol";
import { ACCENTS, CONTROL_STYLES, pickAccent, slugify, TEMPLATES, type ControlStyle, type TemplateId } from "./options.ts";
import { scaffold } from "./scaffold.ts";

export { scaffold } from "./scaffold.ts";
export * from "./options.ts";
export { renderIcon, renderPoster } from "./art.ts";

const tty = !!process.stdout.isTTY && !process.env.CI;
const c = (style: Parameters<typeof styleText>[0], s: string) => (tty ? styleText(style, s) : s);

function packageManager(): "npm" | "pnpm" | "yarn" | "bun" {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

function install(dir: string, pm: string): Promise<boolean> {
  return new Promise((resolveP) => {
    const child = spawn(pm, ["install"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => resolveP(code === 0));
    child.on("error", () => resolveP(false));
  });
}

const cancelled = (v: unknown): v is symbol => p.isCancel(v);

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      template: { type: "string", short: "t" },
      controls: { type: "string" },
      accent: { type: "string" },
      yes: { type: "boolean", short: "y" },
      "no-install": { type: "boolean" },
      local: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`create-thumbcade-game [dir] [--name "My Game"] [--template ${Object.keys(TEMPLATES).join("|")}] [--controls tap|horizontal|vertical] [--accent #RRGGBB] [--yes] [--no-install]`);
    return 0;
  }
  const interactive = tty && !values.yes;
  if (interactive) p.intro(`${c(["bold"], "thumbcade")} ${c("gray", "· a new game for the feed")}`);

  let name = values.name ?? (positionals[0] ? basename(positionals[0]).replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : undefined);
  if (!name && interactive) {
    const v = await p.text({ message: "What's it called?", placeholder: "Night Shift", validate: (s) => (!s || s.trim().length === 0 ? "Give it a name" : s.length > 32 ? "32 characters max" : undefined) });
    if (cancelled(v)) return 1;
    name = v.trim();
  }
  name ??= "My Game";

  let template = values.template as TemplateId | undefined;
  if (template && !(template in TEMPLATES)) {
    console.error(`Unknown template "${template}". Pick one of: ${Object.keys(TEMPLATES).join(", ")}`);
    return 2;
  }
  if (!template && interactive) {
    const v = await p.select({
      message: "Pick a template",
      options: (Object.keys(TEMPLATES) as TemplateId[]).map((id) => ({ value: id, label: TEMPLATES[id].label, hint: `${TEMPLATES[id].hint} · sample: ${TEMPLATES[id].sample}` })),
    });
    if (cancelled(v)) return 1;
    template = v as TemplateId;
  }
  template ??= "canvas";

  let controls = values.controls as ControlStyle | undefined;
  if (controls && !(controls in CONTROL_STYLES)) {
    console.error('--controls must be "tap", "horizontal" or "vertical"');
    return 2;
  }
  if (!controls && interactive) {
    const v = await p.select({
      message: "How will people play it?",
      initialValue: TEMPLATES[template].controls,
      options: (Object.keys(CONTROL_STYLES) as ControlStyle[]).map((id) => ({ value: id, label: CONTROL_STYLES[id].label, hint: CONTROL_STYLES[id].hint })),
    });
    if (cancelled(v)) return 1;
    controls = v as ControlStyle;
  }
  controls ??= TEMPLATES[template].controls;

  const accent = (values.accent ?? pickAccent(name)).toUpperCase();
  if (!HEX_COLOR_PATTERN.test(accent)) {
    console.error(`--accent must be a 6-digit hex color, e.g. ${ACCENTS[0]}`);
    return 2;
  }

  const slug = slugify(positionals[0] ? basename(positionals[0]) : name);
  const dir = resolve(positionals[0] ?? slug);
  const pm = packageManager();
  const local = values.local
    ? { sdk: resolve(values.local, "packages/sdk"), cli: resolve(values.local, "packages/cli"), protocol: pm === "pnpm" ? ("link" as const) : ("file" as const) }
    : undefined;

  const spin = interactive ? p.spinner() : null;
  spin?.start("Drawing your icon and poster");
  try {
    await scaffold({ dir, name, slug, template, controls, accent, local });
  } catch (err) {
    spin?.stop("Couldn't create the project");
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
  spin?.stop(`${name} is ready in ${c("cyan", relative(process.cwd(), dir) || ".")}`);
  if (!interactive) console.log(`Created ${name} (${TEMPLATES[template].label}) in ${dir}`);

  let installed = false;
  if (!values["no-install"]) {
    if (interactive) p.log.step(`Installing with ${pm}…`);
    installed = await install(dir, pm);
    if (!installed) console.error(c("yellow", `${pm} install didn't finish. Run it yourself in ${dir}.`));
  }
  const run = pm === "npm" ? "npm run" : pm;
  const steps = [`cd ${relative(process.cwd(), dir) || "."}`, ...(installed ? [] : [`${pm} install`]), `${run} dev`];
  const outro = `Next:\n  ${steps.join("\n  ")}\n\nThe simulator opens with your game in a real feed. When it feels good: ${run} release`;
  if (interactive) p.outro(outro);
  else console.log(outro);
  return 0;
}
