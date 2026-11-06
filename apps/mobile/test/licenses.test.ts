/// <reference types="node" />
// Node types for the lockfile check below (child_process, fs); adding them to the app program changes no types.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { filterNotices, LICENSES, noticeText, notices, reflow } from "../src/features/licenses/notices";

const app = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8")) as { dependencies: Record<string, string> };
/** Installed version as Node resolves it from the app (the workspace hoists to the root node_modules). */
const installed = (name: string) => {
  const dir = [join(app, "node_modules", name), join(app, "../../node_modules", name)].find((d) => existsSync(join(d, "package.json")))!;
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
};

describe("open-source licences", () => {
  it("are up to date with the lockfile (regenerate with `pnpm --filter @thumbcade/mobile notices`)", () => {
    try {
      execFileSync(process.execPath, [join(app, "../../scripts/licenses/collect.ts"), app, join(app, "src/features/licenses/notices.generated.ts"), "--check"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      throw new Error(String((e as { stderr?: string }).stderr || e), { cause: e });
    }
  }, 120_000);

  it("list every direct production dependency at its installed version, and no workspace package", () => {
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      if (spec.startsWith("workspace:")) {
        expect(notices.some((n) => n.name === name)).toBe(false);
        continue;
      }
      expect(notices.filter((n) => n.name === name && n.kind === "package").map((n) => n.version)).toContain(installed(name));
    }
  });

  it("include the fonts with their OFL texts", () => {
    for (const font of ["Mona Sans", "Departure Mono"]) {
      const n = notices.find((x) => x.name === font);
      expect(n?.kind).toBe("font");
      expect(noticeText(n!.files[0]!.text)).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });

  it("give every entry a non-empty text, and keep each package's own copyright line", () => {
    for (const n of notices) {
      expect(n.files.length).toBeGreaterThan(0);
      for (const f of n.files) expect(noticeText(f.text).length).toBeGreaterThan(100);
    }
    const react = notices.find((n) => n.name === "react" && n.kind === "package")!;
    expect(noticeText(react.files[0]!.text)).toMatch(/^MIT License\n\nCopyright \(c\) Meta Platforms, Inc\. and affiliates\./);
    const metro = notices.find((n) => n.name === "metro")!;
    expect(metro.fallback).toBe("source");
    expect(noticeText(metro.files[0]!.text)).toContain("Copyright (c) Meta Platforms, Inc. and affiliates.");
  });

  it("filter by name and licence", () => {
    const all = filterNotices("", null);
    expect(all).toHaveLength(notices.length);
    const mit = filterNotices("", "MIT");
    expect(mit.length).toBe(LICENSES.find((l) => l.license === "MIT")!.count);
    expect(mit.every((i) => notices[i]!.license === "MIT")).toBe(true);
    expect(filterNotices("  REACT-NATIVE-SVG ", null).map((i) => notices[i]!.name)).toEqual(["react-native-svg"]);
    expect(filterNotices("no-such-package", null)).toEqual([]);
  });

  it("reflows hard-wrapped lines for display but keeps lists, rules and copyright lines", () => {
    expect(reflow("Permission is hereby granted, free of charge, to any person obtaining a copy\nof this software.")).toBe("Permission is hereby granted, free of charge, to any person obtaining a copy of this software.");
    expect(reflow("Conditions:\n1. Keep this notice.\n2. Do not sue.")).toBe("Conditions:\n1. Keep this notice.\n2. Do not sue.");
    expect(reflow("Copyright (c) 2014-present Sebastian McKenzie and other contributors\nCopyright (c) 2020 Someone Else with a long enough name")).toContain("contributors\nCopyright");
    expect(reflow("-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------")).toBe(
      "-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------",
    );
  });
});
