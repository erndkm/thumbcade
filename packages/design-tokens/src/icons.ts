/**
 * Thumbcade icon set — 24-pt grid, 1.75 stroke, square caps, miter joins.
 * One source of truth for the app (react-native-svg), the simulator and the portal.
 *
 * Render a stroked icon:
 *   <svg viewBox="0 0 24 24"><path d={icon.d} fill="none" stroke="currentColor"
 *        stroke-width={ICON_STROKE} stroke-linecap="square" stroke-linejoin="miter"/></svg>
 * Active (filled) variant: render `icon.filled` with fill="currentColor" and no stroke
 * (plus `icon.filledDetail` stroked in the background color when present).
 * Icons with `solid: true` are always drawn filled.
 */

export const ICON_STROKE = 1.75;

export interface IconDef {
  /** Outline path (stroked). */
  d: string;
  /** Filled variant path (filled with currentColor). Defaults to `d` when omitted. */
  filled?: string;
  /** Detail stroked on top of the filled variant in the background color (e.g. the plus in "create"). */
  filledDetail?: string;
  /** Always render filled, never stroked. */
  solid?: boolean;
}

function star(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z`;
}

const HEART = "M12 20.2 L4.3 12.6 C2.2 10.5 2.4 7.1 4.8 5.5 C6.9 4.1 9.8 4.5 12 7.1 C14.2 4.5 17.1 4.1 19.2 5.5 C21.6 7.1 21.8 10.5 19.7 12.6 Z";
const STAR = star(12, 12.6, 8.8, 3.7);

export const icons = {
  home: {
    d: "M4 10.4 L12 4 L20 10.4 V20 H14.5 V14.2 H9.5 V20 H4 Z",
    filled: "M4 10.4 L12 4 L20 10.4 V20 H14.5 V14.2 H9.5 V20 H4 Z",
  },
  discover: {
    d: "M12 3.25 A8.75 8.75 0 1 1 11.99 3.25 Z M15.2 8.8 L13.4 13.4 L8.8 15.2 L10.6 10.6 Z",
    filled: "M12 3.25 A8.75 8.75 0 1 1 11.99 3.25 Z",
    filledDetail: "M15.2 8.8 L13.4 13.4 L8.8 15.2 L10.6 10.6 Z",
  },
  create: {
    d: "M4 4 H20 V20 H4 Z M12 8 V16 M8 12 H16",
    filled: "M4 4 H20 V20 H4 Z",
    filledDetail: "M12 8 V16 M8 12 H16",
  },
  inbox: {
    d: "M3.5 13 L6.2 5 H17.8 L20.5 13 V19.5 H3.5 Z M3.5 13 H8.6 L10.1 15.6 H13.9 L15.4 13 H20.5",
    filled: "M3.5 13 L6.2 5 H17.8 L20.5 13 V19.5 H3.5 Z",
    filledDetail: "M3.5 13 H8.6 L10.1 15.6 H13.9 L15.4 13 H20.5",
  },
  profile: {
    d: "M12 4.6 A3.9 3.9 0 1 1 11.99 4.6 Z M4.8 20 C4.8 15.9 7.9 13.9 12 13.9 C16.1 13.9 19.2 15.9 19.2 20 Z",
    filled: "M12 4.6 A3.9 3.9 0 1 1 11.99 4.6 Z M4.8 20 C4.8 15.9 7.9 13.9 12 13.9 C16.1 13.9 19.2 15.9 19.2 20 Z",
  },
  like: { d: HEART, filled: HEART },
  comment: {
    d: "M4 5 H20 V16 H11.2 L7.2 19.6 V16 H4 Z",
    filled: "M4 5 H20 V16 H11.2 L7.2 19.6 V16 H4 Z",
  },
  save: { d: STAR, filled: STAR },
  share: {
    d: "M13.2 4.8 L20.4 11.6 L13.2 18.4 V14.6 C8.6 14.6 5.6 16.1 3.8 19.6 C4.4 13.6 7.6 9.6 13.2 8.8 Z",
    filled: "M13.2 4.8 L20.4 11.6 L13.2 18.4 V14.6 C8.6 14.6 5.6 16.1 3.8 19.6 C4.4 13.6 7.6 9.6 13.2 8.8 Z",
  },
  soundOn: {
    d: "M3.8 9.4 H7.4 L12 5.4 V18.6 L7.4 14.6 H3.8 Z M15.4 9 C16.7 10.4 16.7 13.6 15.4 15 M18 6.4 C20.9 9.3 20.9 14.7 18 17.6",
  },
  soundOff: {
    d: "M3.8 9.4 H7.4 L12 5.4 V18.6 L7.4 14.6 H3.8 Z M15.6 9.6 L20.4 14.4 M20.4 9.6 L15.6 14.4",
  },
  more: {
    d: "M5 10.4 A1.6 1.6 0 1 1 4.99 10.4 Z M12 10.4 A1.6 1.6 0 1 1 11.99 10.4 Z M19 10.4 A1.6 1.6 0 1 1 18.99 10.4 Z",
    solid: true,
  },
  search: { d: "M10.5 4.25 A6.25 6.25 0 1 1 10.49 4.25 Z M15.2 15.2 L20 20" },
  play: { d: "M7.2 4.6 L19 12 L7.2 19.4 Z", filled: "M7.2 4.6 L19 12 L7.2 19.4 Z" },
  pause: { d: "M7 5 H10 V19 H7 Z M14 5 H17 V19 H14 Z", solid: true },
  replay: { d: "M5 12 A7 7 0 1 0 7.1 7 M7.1 3.6 V7.2 H3.5" },
  close: { d: "M5.6 5.6 L18.4 18.4 M18.4 5.6 L5.6 18.4" },
  back: { d: "M15 4.6 L7.6 12 L15 19.4" },
  forward: { d: "M9 4.6 L16.4 12 L9 19.4" },
  chevronDown: { d: "M4.6 9 L12 16.4 L19.4 9" },
  trophy: {
    d: "M7.2 4 H16.8 V9 C16.8 11.9 14.7 13.8 12 13.8 C9.3 13.8 7.2 11.9 7.2 9 Z M12 13.8 V17.6 M8 20 H16 M7.2 6 H4 V7.8 C4 9.8 5.4 11 7.4 11 M16.8 6 H20 V7.8 C20 9.8 18.6 11 16.6 11",
  },
  flag: { d: "M5.5 21 V4 M5.5 4.4 H17.6 L15.4 8.4 L17.6 12.4 H5.5" },
  settings: { d: "M4 7.5 H20 M4 16.5 H20 M9 5.2 V9.8 M15 14.2 V18.8" },
  check: { d: "M4.8 12.6 L9.8 17.4 L19.2 7" },
  link: { d: "M10.2 13.8 L13.8 10.2 M8.4 11.4 L6.2 13.6 C4.6 15.2 4.6 17.8 6.2 19.4 C7.8 21 10.4 21 12 19.4 L14.2 17.2 M15.6 12.6 L17.8 10.4 C19.4 8.8 19.4 6.2 17.8 4.6 C16.2 3 13.6 3 12 4.6 L9.8 6.8" },
  download: { d: "M12 4 V15 M7.2 10.4 L12 15.2 L16.8 10.4 M5 20 H19" },
  bolt: { d: "M13.4 3.5 L5.6 13.4 H11.4 L10.4 20.5 L18.4 10.4 H12.6 Z", filled: "M13.4 3.5 L5.6 13.4 H11.4 L10.4 20.5 L18.4 10.4 H12.6 Z" },
  code: { d: "M8.4 7 L3.6 12 L8.4 17 M15.6 7 L20.4 12 L15.6 17 M13.4 5 L10.6 19" },
  plus: { d: "M12 5 V19 M5 12 H19" },
  hash: { d: "M9.6 4.5 L8 19.5 M16 4.5 L14.4 19.5 M4.8 9 H19.6 M4.4 15 H19.2" },
  lock: { d: "M6 10.5 H18 V20 H6 Z M8.6 10.5 V7.6 C8.6 5.7 10.1 4.2 12 4.2 C13.9 4.2 15.4 5.7 15.4 7.6 V10.5" },
  eye: { d: "M2.8 12 C5 7.6 8.2 5.6 12 5.6 C15.8 5.6 19 7.6 21.2 12 C19 16.4 15.8 18.4 12 18.4 C8.2 18.4 5 16.4 2.8 12 Z M12 9.4 A2.6 2.6 0 1 1 11.99 9.4 Z" },
  grid: { d: "M4 4 H10.6 V10.6 H4 Z M13.4 4 H20 V10.6 H13.4 Z M4 13.4 H10.6 V20 H4 Z M13.4 13.4 H20 V20 H13.4 Z" },
  swipeUp: { d: "M12 20 V5 M6.8 10 L12 4.8 L17.2 10" },
  dock: { d: "M7 12 H17", solid: false },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof icons;
