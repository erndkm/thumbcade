/**
 * A legal document as plain data, rendered natively by the app and as HTML by the portal.
 * Text is plain; renderers turn email addresses and https:// URLs into links (see `splitLinks`).
 */
export type LegalBlock =
  /** A paragraph. "\n" is a line break. */
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  /** Label/value pairs, e.g. "Legal basis" → "Art. 6(1)(b) GDPR". */
  | { kind: "facts"; items: { label: string; text: string }[] };

export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  title: string;
  /** ISO date of the last substantive change. */
  updated: string;
  intro?: string;
  sections: LegalSection[];
}

export type LegalDocId = "imprint" | "privacy" | "terms" | "guidelines";

export const p = (text: string): LegalBlock => ({ kind: "p", text });
export const list = (...items: string[]): LegalBlock => ({ kind: "list", items });
export const facts = (items: Record<string, string>): LegalBlock => ({
  kind: "facts",
  items: Object.entries(items).map(([label, text]) => ({ label, text })),
});

export interface TextSegment {
  text: string;
  /** mailto: or https: target when the segment is an address or URL. */
  href?: string;
}

const LINK = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(https?:\/\/[^\s)]+[^\s).,;:])/g;

/** Splits text into plain and linked segments (email addresses and http(s) URLs). */
export function splitLinks(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[0], href: m[1] ? `mailto:${m[1]}` : m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** "2026-10-14" → "14 October 2026". */
export function formatLegalDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  return `${d} ${month} ${y}`;
}
