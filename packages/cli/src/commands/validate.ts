import { relative } from "node:path";
import { buildProject } from "../build.ts";
import { checkBundle, mb, type BundleReport } from "../checks/index.ts";
import { findProjectRoot, readProjectManifest } from "../project.ts";
import { CliError, paint, ui } from "../ui.ts";

export interface ValidateResult {
  root: string;
  outDir: string;
  report: BundleReport;
  manifestRaw: unknown;
}

/** Build, then check the manifest, budgets and static rules. Throws if anything fails. */
export async function validate(opts: { cwd?: string; skipBuild?: boolean; quiet?: boolean } = {}): Promise<ValidateResult> {
  const root = findProjectRoot(opts.cwd);
  const pm = await readProjectManifest(root);
  if (!pm.manifest) {
    ui.title("thumbcade.json");
    for (const issue of pm.issues) {
      ui.fail(issue.message);
      if (issue.fix) ui.fix(issue.fix);
    }
    throw new CliError("Fix thumbcade.json first; nothing was built.");
  }
  if (!opts.quiet) ui.dim(`Building ${pm.manifest.name} ${pm.manifest.version}…`);
  const outDir = opts.skipBuild ? `${root}/dist` : await buildProject(root, pm.manifest, { quiet: opts.quiet });
  const report = await checkBundle(outDir);
  printReport(report, relative(process.cwd(), outDir) || ".");
  if (!report.passed) throw new CliError("Validation failed. Fix the items marked ✗ and run it again.");
  return { root, outDir, report, manifestRaw: pm.raw };
}

export function printReport(report: BundleReport, dir: string): void {
  for (const check of report.checks) {
    ui.title(check.label);
    if (check.findings.length === 0) ui.ok(check.id === "size" ? `${mb(report.totals.initialGzipBytes)} before ready (budget 3 MB gz), ${mb(report.totals.totalBytes)} total (cap 15 MB)` : "All good");
    for (const f of check.findings) {
      const where = f.file ? paint("gray", ` (${f.file})`) : "";
      if (f.status === "fail") ui.fail(f.message + where);
      else if (f.status === "warn") ui.warn(f.message + where);
      else ui.ok(f.message + where);
      if (f.fix) ui.fix(f.fix);
    }
  }
  const t = report.totals;
  console.log("");
  ui.kv("bundle", dir);
  ui.kv("files", `${t.files}, ${mb(t.totalBytes)} (${mb(t.gzipBytes)} gzipped)`);
  ui.kv("first load", `${mb(t.initialGzipBytes)} gzipped across ${t.initialFiles.length} file${t.initialFiles.length === 1 ? "" : "s"}`);
  console.log(report.passed ? `\n${paint("green", "Ready to publish.")} The automated reviewer runs the runtime checks after upload.` : "");
}

export async function validateCommand(args: { noBuild?: boolean }): Promise<void> {
  await validate({ skipBuild: args.noBuild });
}
