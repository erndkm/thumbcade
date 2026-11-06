import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { noticeText, notices } from "../src/lib/notices.generated";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8")) as { dependencies: Record<string, string> };
const installed = (name: string) => {
  const dir = [join(app, "node_modules", name), join(app, "../../node_modules", name)].find((d) => existsSync(join(d, "package.json")))!;
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
};

describe("open-source licences page data", () => {
  it("is up to date with the lockfile (regenerate with `pnpm --filter @thumbcade/portal notices`)", () => {
    try {
      execFileSync(process.execPath, [join(app, "../../scripts/licenses/collect.ts"), app, join(app, "src/lib/notices.generated.ts"), "--check"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      throw new Error(String((e as { stderr?: string }).stderr || e), { cause: e });
    }
  }, 120_000);

  it("lists every direct production dependency at its installed version, and no workspace package", () => {
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      if (spec.startsWith("workspace:")) {
        expect(notices.some((n) => n.name === name)).toBe(false);
        continue;
      }
      expect(notices.filter((n) => n.name === name && n.kind === "package").map((n) => n.version)).toContain(installed(name));
    }
  });

  it("includes the fonts and the code Next.js bundles", () => {
    expect(notices.filter((n) => n.kind === "font").map((n) => n.name)).toEqual(["Departure Mono", "Mona Sans"]);
    const bundledReactDom = notices.find((n) => n.name === "react-dom" && n.kind === "bundled");
    expect(bundledReactDom?.note).toMatch(/^bundled in next \d/);
    expect(noticeText(bundledReactDom!.files[0]!.text)).toContain("Meta Platforms, Inc. and affiliates");
  });
});
