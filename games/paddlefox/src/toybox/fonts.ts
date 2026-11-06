import blackUrl from "@thumbcade-games/kit/assets/fonts/library/rubik/Rubik-Black.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/rubik/Rubik-Medium.woff2?url";

/** Rubik: Black for titles and big numbers, Medium for labels. */
export const FONT = '"Rubik", ui-rounded, system-ui, sans-serif';

/** Loads both weights (bundled, same origin). Resolves after at most `timeoutMs` either way. */
export async function loadRubik(timeoutMs = 1500): Promise<void> {
  const faces = [
    new FontFace("Rubik", `url(${blackUrl})`, { weight: "900" }),
    new FontFace("Rubik", `url(${mediumUrl})`, { weight: "500" }),
  ];
  const all = Promise.all(
    faces.map(async (f) => {
      try {
        document.fonts.add(await f.load());
      } catch {
        /* system fallback */
      }
    }),
  ).then(() => undefined);
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
