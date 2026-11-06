import { describe, expect, it } from "vitest";
import { formatLegalDate, LEGAL_DOCS, OPERATOR, RETENTION, splitLinks, type LegalDoc } from "../src/index.ts";

const text = (doc: LegalDoc) =>
  [doc.intro ?? "", ...doc.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : b.items.map((f) => f.text))))].join("\n");

describe("documents", () => {
  it.each(Object.entries(LEGAL_DOCS))("%s is well-formed (renderers key by heading, item and label)", (_, doc) => {
    expect(doc.title).not.toBe("");
    expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(doc.sections.map((s) => s.heading)).size).toBe(doc.sections.length);
    for (const s of doc.sections) {
      expect(s.blocks.length).toBeGreaterThan(0);
      for (const b of s.blocks) {
        if (b.kind === "list") expect(new Set(b.items).size).toBe(b.items.length);
        if (b.kind === "facts") expect(new Set(b.items.map((f) => f.label)).size).toBe(b.items.length);
      }
    }
  });

  it("the imprint names the operator, its address and every contact detail that is set", () => {
    const imprint = text(LEGAL_DOCS.imprint);
    for (const v of [OPERATOR.name, ...OPERATOR.address, OPERATOR.email.general, OPERATOR.representedBy, OPERATOR.phone, OPERATOR.vatId, OPERATOR.register?.number]) {
      if (v) expect(imprint).toContain(v);
    }
  });

  it("the terms carry the photosensitive epilepsy warning and point to Reduce Motion", () => {
    const section = LEGAL_DOCS.terms.sections.find((s) => s.heading === "Health and safety");
    const warning = text({ title: "", updated: LEGAL_DOCS.terms.updated, sections: section ? [section] : [] });
    expect(warning).toContain("photosensitive epilepsy");
    expect(warning).toContain("Stop playing");
    expect(warning).toContain("Reduce Motion in your device's accessibility settings");
    expect(warning).toContain("Settings → Reduce motion");
  });

  it("the privacy policy names the controller and states the enforced retention periods", () => {
    const privacy = text(LEGAL_DOCS.privacy);
    expect(privacy).toContain(OPERATOR.name);
    expect(privacy).toContain(OPERATOR.email.privacy);
    expect(privacy).toContain(`after ${RETENTION.usageEventsDays} days`);
    expect(privacy).toContain(`after ${RETENTION.inactiveGuestMonths} months without use`);
    expect(privacy).toContain(`at most ${RETENTION.serverLogsDays} days`);
  });
});

describe("splitLinks", () => {
  it("links email addresses and URLs and leaves trailing punctuation outside", () => {
    expect(splitLinks("Write to privacy@thumbcade.com. Or see https://thumbcade.com/account.")).toEqual([
      { text: "Write to " },
      { text: "privacy@thumbcade.com", href: "mailto:privacy@thumbcade.com" },
      { text: ". Or see " },
      { text: "https://thumbcade.com/account", href: "https://thumbcade.com/account" },
      { text: "." },
    ]);
  });

  it("returns plain text untouched", () => {
    expect(splitLinks("Art. 6(1)(b) GDPR")).toEqual([{ text: "Art. 6(1)(b) GDPR" }]);
  });
});

it("formats dates the way the documents show them", () => {
  expect(formatLegalDate("2026-10-14")).toBe("14 October 2026");
});
