/**
 * Loads bundled faces from assets/fonts/library for games that don't use the house fonts. Kept apart from fonts.ts:
 * a `?url` import emits its asset when the module loads, so importing fonts.ts would ship the house fonts too.
 */
export interface FontFaceSource {
  family: string;
  /** A bundled font URL (`import url from "…/Face.woff2?url"`). */
  url: string;
  descriptors?: FontFaceDescriptors;
}

/** Resolves after at most `timeoutMs` either way. */
export async function loadFontFaces(sources: FontFaceSource[], timeoutMs = 1500): Promise<void> {
  const all = Promise.all(
    sources.map(async ({ family, url, descriptors }) => {
      try {
        document.fonts.add(await new FontFace(family, `url(${url})`, descriptors).load());
      } catch {
        /* fall back to system fonts */
      }
    }),
  ).then(() => undefined);
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
