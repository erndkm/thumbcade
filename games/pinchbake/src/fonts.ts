/**
 * Loads the bundled Fredoka faces. (Kept local: the kit's font module also references the house fonts,
 * which would ship them in this bundle.)
 */
import boldUrl from "@thumbcade-games/kit/assets/fonts/library/fredoka/Fredoka-Bold.woff2?url";
import semiUrl from "@thumbcade-games/kit/assets/fonts/library/fredoka/Fredoka-SemiBold.woff2?url";

export async function loadFredoka(timeoutMs = 1500): Promise<void> {
  const faces = [
    new FontFace("Fredoka", `url(${boldUrl})`, { weight: "700" }),
    new FontFace("Fredoka", `url(${semiUrl})`, { weight: "600" }),
  ];
  const all = Promise.all(
    faces.map(async (f) => {
      try {
        document.fonts.add(await f.load());
      } catch {
        /* fall back to the system's rounded sans */
      }
    }),
  ).then(() => undefined);
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
