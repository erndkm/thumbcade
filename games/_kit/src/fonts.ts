import displayUrl from "../assets/fonts/display.woff2?url";
import monoUrl from "../assets/fonts/mono.woff2?url";

/** Departure Mono (OFL): scores, counters, labels. */
export const FONT_MONO = '"TC Mono", ui-monospace, Menlo, monospace';
/** Mona Sans Display Expanded Black (OFL, ASCII subset): titles. */
export const FONT_DISPLAY = '"TC Display", system-ui, sans-serif';

let loading: Promise<void> | null = null;

/** Loads both fonts (bundled, same origin). Resolves after at most `timeoutMs` either way. */
export function loadFonts(timeoutMs = 1500): Promise<void> {
  loading ??= (async () => {
    const faces = [new FontFace("TC Mono", `url(${monoUrl})`), new FontFace("TC Display", `url(${displayUrl})`, { weight: "900" })];
    const all = Promise.all(
      faces.map(async (f) => {
        try {
          document.fonts.add(await f.load());
        } catch {
          /* fall back to system fonts */
        }
      }),
    ).then(() => undefined);
    await Promise.race([all, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  })();
  return loading;
}

/** CSS font shorthand helpers. */
export const mono = (px: number) => `${px}px ${FONT_MONO}`;
export const display = (px: number) => `900 ${px}px ${FONT_DISPLAY}`;
