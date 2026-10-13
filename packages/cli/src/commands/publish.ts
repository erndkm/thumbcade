import { publishBundle, versionStatus, type VersionStatus } from "../api.ts";
import { readBundle, mb } from "../checks/index.ts";
import { loadToken } from "../config.ts";
import { zipBundle } from "../zip.ts";
import { CliError, paint, ui } from "../ui.ts";
import { validate } from "./validate.ts";

const WAIT_STATES = new Set(["uploaded", "auto_checking"]);

export async function publishCommand(args: { notes?: string; wait?: boolean; timeout?: number }): Promise<void> {
  const auth = await loadToken();
  if (!auth) throw new CliError("You're not logged in.", "Run `thumbcade login` (or set THUMBCADE_TOKEN).");
  const { outDir, report, manifestRaw } = await validate({ quiet: true });
  const files = await readBundle(outDir);
  const zip = zipBundle(files);
  const m = report.manifest!;
  ui.dim(`Uploading ${m.id}@${m.version} (${mb(zip.length)} zipped)…`);
  const res = await publishBundle(auth.token, JSON.stringify(manifestRaw), zip, args.notes);
  ui.ok(`Published ${paint("bold", `${m.name} ${m.version}`)} for review.`);
  ui.kv("version", res.versionId);
  ui.kv("status", res.status);
  ui.kv("review", paint("cyan", res.reviewUrl));
  if (!args.wait) {
    ui.dim("The automated reviewer is on it. Add --wait to watch, or open the review link.");
    return;
  }
  const deadline = Date.now() + (args.timeout ?? 300) * 1000;
  let last: VersionStatus | null = null;
  ui.dim("Waiting for the automated review…");
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    last = await versionStatus(auth.token, res.versionId);
    if (!WAIT_STATES.has(last.status)) break;
  }
  if (!last || WAIT_STATES.has(last.status)) throw new CliError("The automated review is still running.", `Check later: ${res.reviewUrl}`);
  ui.title(`Automated review: ${last.status === "auto_failed" ? paint("red", "failed") : paint("green", "passed")}`);
  for (const c of last.report?.checks ?? []) {
    const line = `${c.label}${c.detail ? paint("gray", ` — ${c.detail}`) : ""}`;
    if (c.status === "fail") ui.fail(line);
    else if (c.status === "warn") ui.warn(line);
    else if (c.status === "pass") ui.ok(line);
    else ui.dim(`- ${line}`);
  }
  if (last.status === "auto_failed") throw new CliError("Fix the failed checks, bump the version and publish again.");
  ui.info(`\nNext: a human plays it and approves. You'll see it at ${paint("cyan", last.reviewUrl)}.`);
}
