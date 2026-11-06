import { loadFontFaces } from "@thumbcade-games/kit/font-faces";
import blackUrl from "@thumbcade-games/kit/assets/fonts/library/rubik/Rubik-Black.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/rubik/Rubik-Medium.woff2?url";

/** Rubik: Black for titles and big numbers, Medium for labels. */
export const FONT = '"Rubik", ui-rounded, system-ui, sans-serif';

/** Loads both weights (bundled, same origin) through the kit's library-font loader. */
export function loadRubik(timeoutMs = 1500): Promise<void> {
  return loadFontFaces(
    [
      { family: "Rubik", url: blackUrl, descriptors: { weight: "900" } },
      { family: "Rubik", url: mediumUrl, descriptors: { weight: "500" } },
    ],
    timeoutMs,
  );
}
