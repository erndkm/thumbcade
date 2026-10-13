/**
 * CSS the SDK injects on import. It turns the page into a game surface: no scrolling, no
 * overscroll bounce, no text selection, no iOS callout, no tap highlight, and no browser
 * gesture handling (pinch zoom, double-tap zoom, pan) — the feed and the game own every touch.
 */
export const INJECTED_CSS =
  "html,body{touch-action:none;overscroll-behavior:none;user-select:none;-webkit-user-select:none;" +
  "-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}";

export const STYLE_ID = "tc-sdk-css";

export function injectCss(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = INJECTED_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
