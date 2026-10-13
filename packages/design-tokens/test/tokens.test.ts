import { contrastRatio } from "@thumbcade/protocol";
import { describe, expect, it } from "vitest";
import { buildTailwindTheme, buildTokensCss, colors, pixelAvatar, pixelAvatarSvg, textStyles } from "../src/index.ts";

describe("contrast", () => {
  it.each(["dark", "light"] as const)("%s theme text meets 4.5:1 on bg and surface", (t) => {
    const c = colors[t];
    expect(contrastRatio(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.textDim, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.accentText, c.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("avatars", () => {
  it("are deterministic and symmetric", () => {
    const a = pixelAvatar("user-123");
    expect(pixelAvatar("user-123")).toEqual(a);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) expect(a.cells[y * 8 + x]).toBe(a.cells[y * 8 + 7 - x]);
    expect(a.cells.filter(Boolean).length).toBeGreaterThanOrEqual(10);
    expect(pixelAvatarSvg("x")).toContain("<svg");
  });
  it("vary across seeds", () => {
    const set = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(pixelAvatar(`seed-${i}`).cells)));
    expect(set.size).toBeGreaterThan(35);
  });
});

describe("css", () => {
  it("emits variables for both themes and every text style", () => {
    const css = buildTokensCss();
    expect(css).toContain("--tc-bg: #000000");
    expect(css).toContain('[data-theme="light"]');
    for (const name of Object.keys(textStyles)) expect(css).toContain(`.tc-${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
    expect(buildTailwindTheme()).toContain("--color-accent: var(--tc-accent)");
  });
});

describe("icons", () => {
  it("every icon has path data on the 24 grid", async () => {
    const { icons } = await import("../src/icons.ts");
    for (const [name, def] of Object.entries(icons)) {
      expect(def.d.length, name).toBeGreaterThan(5);
      const nums = (def.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      for (const n of nums) expect(n, `${name} coordinate ${n}`).toBeLessThanOrEqual(24);
    }
  });
});
