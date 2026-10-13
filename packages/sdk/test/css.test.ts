import { describe, expect, it } from "vitest";
import { INJECTED_CSS, injectCss, STYLE_ID } from "../src/css.ts";
import { createThumbcade } from "../src/sdk.ts";
import { makeWindow } from "./helpers.ts";

describe("injected CSS", () => {
  it("contains every rule from the Swipe Contract (§5.6) on html and body", () => {
    expect(INJECTED_CSS.startsWith("html,body{")).toBe(true);
    for (const rule of [
      "touch-action:none",
      "overscroll-behavior:none",
      "user-select:none",
      "-webkit-user-select:none",
      "-webkit-touch-callout:none",
    ]) {
      expect(INJECTED_CSS).toContain(rule);
    }
  });

  it("is injected once, on SDK creation", () => {
    const win = makeWindow({ rn: true });
    createThumbcade(win);
    injectCss(win.document);
    const styles = win.document.querySelectorAll(`#${STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(INJECTED_CSS);
    const computed = win.getComputedStyle(win.document.body);
    expect(computed.getPropertyValue("touch-action")).toBe("none");
  });
});
