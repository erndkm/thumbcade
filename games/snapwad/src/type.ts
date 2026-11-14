/**
 * marginalia's handwriting: Caveat Bold for headings and numbers, Caveat Medium for notes (library fonts, OFL),
 * loaded through the kit's font-face loader so no house font ships in this bundle.
 */
import { loadFontFaces } from "@thumbcade-games/kit/font-faces";
import boldUrl from "@thumbcade-games/kit/assets/fonts/library/caveat/Caveat-Bold.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/caveat/Caveat-Medium.woff2?url";
import { FAMILY } from "./ink.ts";

export function loadType(): Promise<void> {
  return loadFontFaces([
    { family: FAMILY, url: boldUrl, descriptors: { weight: "700" } },
    { family: FAMILY, url: mediumUrl, descriptors: { weight: "500" } },
  ]);
}

/** Thousands grouped with a comma. */
export function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
