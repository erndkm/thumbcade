/**
 * Loads bundled font faces (same origin). Resolves after at most `timeoutMs` either way, so a slow font never
 * holds up the first frame for long. (Kept local: the kit's font module also pulls in the house fonts.)
 */
export async function loadFonts(sources: Array<{ family: string; url: string; descriptors?: FontFaceDescriptors }>, timeoutMs = 1500): Promise<void> {
  const all = Promise.all(
    sources.map(async ({ family, url, descriptors }) => {
      try {
        document.fonts.add(await new FontFace(family, `url(${url})`, descriptors).load());
      } catch {
        /* fall back to the system cursive font */
      }
    }),
  ).then(() => undefined);
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
