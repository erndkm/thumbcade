import { noticeText, notices, type ThirdPartyNotice } from "./notices.generated";

export { noticeText, notices, type ThirdPartyNotice };

const haystack = notices.map((n) => `${n.name}\n${n.license}\n${n.note ?? ""}`.toLowerCase());

/** Indices into `notices` that match a search (name, licence or note) and, if set, exactly one licence. */
export function filterNotices(query: string, license: string | null): number[] {
  const q = query.trim().toLowerCase();
  const out: number[] = [];
  for (let i = 0; i < notices.length; i++) {
    if (license && notices[i]!.license !== license) continue;
    if (q && !haystack[i]!.includes(q)) continue;
    out.push(i);
  }
  return out;
}

/** Every licence in the list with its number of entries, most common first. */
export const LICENSES: readonly { license: string; count: number }[] = [
  ...notices.reduce((m, n) => m.set(n.license, (m.get(n.license) ?? 0) + 1), new Map<string, number>()),
]
  .map(([license, count]) => ({ license, count }))
  .sort((a, b) => b.count - a.count || a.license.localeCompare(b.license));

/** "7.29.7 · MIT" (version left out for code bundled without one). */
export function noticeMeta(n: ThirdPartyNotice): string {
  return [n.version, n.license].filter(Boolean).join(" · ");
}

/** Why a package shows a standard licence text instead of its own file. */
export const FALLBACK_NOTE: Record<NonNullable<ThirdPartyNotice["fallback"]>, string> = {
  readme: "This package ships no licence file. Shown is the standard text of its licence with the copyright notice from its README.",
  source: "This package ships no licence file. Shown is the standard text of its licence with the copyright notice from its source files.",
  author: "This package ships no licence file. Shown is the standard text of its licence with the author named in its package details.",
  none: "This package ships no licence file and names no copyright holder. Shown is the standard text of its licence.",
};

const LIST_ITEM = /^([-*•+]|\d+[.)]|\(?[a-z0-9]{1,3}\))\s/i;
const RULE = /^[-=_*#~]{3,}$/;
const COPYRIGHT = /^(copyright\b|\(c\)\s|©)/i;

/**
 * Licence files are hard-wrapped at about 80 columns, which turns into ragged half-lines on a phone. For
 * display only, joins a line onto the previous one when the previous line was long (a wrap, not a break)
 * and the line does not start a list item, a rule or a copyright notice. Indentation is dropped.
 */
export function reflow(paragraph: string): string {
  const out: string[] = [];
  let lastLength = 0;
  for (const raw of paragraph.split("\n")) {
    const line = raw.trim();
    const prev = out[out.length - 1];
    if (prev !== undefined && lastLength >= 50 && line && !LIST_ITEM.test(line) && !RULE.test(line) && !RULE.test(prev) && !COPYRIGHT.test(line)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
    lastLength = raw.trimEnd().length;
  }
  return out.join("\n");
}

/** A notice file as display paragraphs. */
export function noticeParagraphs(text: number): string[] {
  return noticeText(text).split("\n\n").map(reflow);
}
