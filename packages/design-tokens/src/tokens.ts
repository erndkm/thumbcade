/**
 * Thumbcade design tokens — "midnight arcade, editorial restraint".
 * The games bring the color; the chrome is ink, paper and one accent: arcade-button red (`heat`), the logo's color.
 *
 * Units are points (React Native) / CSS pixels (web).
 */

export const palette = {
  ink0: "#000000",
  ink1: "#0D0D10",
  ink2: "#17171C",
  ink3: "#24242B",
  ink4: "#34343D",
  paper: "#F3F0E8",
  paperDim: "#A7A3AE",
  paperMute: "#6E6A78",
  heat: "#FF4A3D",
  heatDeep: "#C42A1F",
  /** Light-theme surfaces (portal only). */
  paper0: "#FBFAF6",
  paper1: "#F3F0E8",
  paper2: "#E8E4D9",
  paper3: "#D6D1C4",
  ink: "#0D0D10",
  inkDim: "#4B4853",
  inkMute: "#7A7684",
} as const;

export type ThemeName = "dark" | "light";

export interface SemanticColors {
  /** Feed backdrop / page background. */
  bg: string;
  surface: string;
  raised: string;
  line: string;
  lineStrong: string;
  text: string;
  textDim: string;
  textMute: string;
  /** Signature accent as a fill (buttons, active pills, focus rings). */
  accent: string;
  /** Text/icon color placed on top of `accent`. */
  onAccent: string;
  /** Accent used as text on `bg`. */
  accentText: string;
  heat: string;
  onHeat: string;
  /** Scrim for sheets and overlays. */
  scrim: string;
  /** Gradient stops behind feed captions (bottom) and top tabs. */
  captionScrim: [string, string];
  success: string;
  warning: string;
  danger: string;
}

export const colors: Record<ThemeName, SemanticColors> = {
  dark: {
    bg: palette.ink0,
    surface: palette.ink1,
    raised: palette.ink2,
    line: palette.ink3,
    lineStrong: palette.ink4,
    text: palette.paper,
    textDim: palette.paperDim,
    textMute: palette.paperMute,
    accent: palette.heat,
    onAccent: palette.ink1,
    accentText: palette.heat,
    heat: palette.heat,
    onHeat: palette.paper,
    scrim: "rgba(0,0,0,0.62)",
    captionScrim: ["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"],
    success: "#4CC38A",
    warning: "#FFB547",
    danger: palette.heat,
  },
  light: {
    bg: palette.paper0,
    surface: palette.paper1,
    raised: "#FFFFFF",
    line: palette.paper2,
    lineStrong: palette.paper3,
    text: palette.ink,
    textDim: palette.inkDim,
    textMute: palette.inkMute,
    accent: palette.heat,
    onAccent: palette.ink,
    accentText: palette.heatDeep,
    heat: palette.heatDeep,
    onHeat: palette.paper0,
    scrim: "rgba(13,13,16,0.42)",
    captionScrim: ["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"],
    success: "#3F7A00",
    warning: "#9A5B00",
    danger: palette.heatDeep,
  },
};

/** Font family names. Native: the keys the app registers with expo-font. Web: CSS families. */
export const fontFamily = {
  native: {
    displayBlack: "MonaSansDisplayExpanded-Black",
    displayExtraBold: "MonaSansDisplayExpanded-ExtraBold",
    displayBold: "MonaSansDisplayExpanded-Bold",
    wideBold: "MonaSansExpanded-Bold",
    wideSemiBold: "MonaSansExpanded-SemiBold",
    regular: "MonaSans-Regular",
    medium: "MonaSans-Medium",
    semiBold: "MonaSans-SemiBold",
    bold: "MonaSans-Bold",
    mono: "DepartureMono-Regular",
  },
  web: {
    sans: '"Mona Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"Departure Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
} as const;

export const fontSize = {
  micro: 11,
  caption: 13,
  body: 15,
  headline: 17,
  title: 22,
  display3: 28,
  display2: 40,
  display1: 56,
} as const;

type NativeFamily = keyof typeof fontFamily.native;

export interface TextStyleToken {
  family: NativeFamily;
  /** Web equivalents of the native family. */
  web: { family: "sans" | "mono"; weight: number; stretch: string };
  size: number;
  lineHeight: number;
  /** Absolute letter spacing in points (RN needs absolute values). */
  letterSpacing: number;
  uppercase?: boolean;
}

const track = (size: number, pct: number) => Math.round(size * pct * 100) / 100;

/** Text styles. Display sizes track −2 %, uppercase mono labels +4 %. */
export const textStyles = {
  display1: { family: "displayBlack", web: { family: "sans", weight: 900, stretch: "125%" }, size: 56, lineHeight: 54, letterSpacing: track(56, -0.02) },
  display2: { family: "displayBlack", web: { family: "sans", weight: 900, stretch: "125%" }, size: 40, lineHeight: 40, letterSpacing: track(40, -0.02) },
  display3: { family: "displayExtraBold", web: { family: "sans", weight: 800, stretch: "125%" }, size: 28, lineHeight: 30, letterSpacing: track(28, -0.02) },
  title: { family: "displayBold", web: { family: "sans", weight: 700, stretch: "125%" }, size: 22, lineHeight: 26, letterSpacing: track(22, -0.01) },
  headline: { family: "semiBold", web: { family: "sans", weight: 600, stretch: "100%" }, size: 17, lineHeight: 22, letterSpacing: 0 },
  button: { family: "wideBold", web: { family: "sans", weight: 700, stretch: "112.5%" }, size: 15, lineHeight: 18, letterSpacing: 0.1 },
  body: { family: "regular", web: { family: "sans", weight: 400, stretch: "100%" }, size: 15, lineHeight: 21, letterSpacing: 0 },
  bodyStrong: { family: "semiBold", web: { family: "sans", weight: 600, stretch: "100%" }, size: 15, lineHeight: 21, letterSpacing: 0 },
  caption: { family: "medium", web: { family: "sans", weight: 500, stretch: "100%" }, size: 13, lineHeight: 17, letterSpacing: 0 },
  micro: { family: "semiBold", web: { family: "sans", weight: 600, stretch: "100%" }, size: 11, lineHeight: 14, letterSpacing: 0.1 },
  /** Counters, scores, ranks, timestamps. */
  mono: { family: "mono", web: { family: "mono", weight: 400, stretch: "100%" }, size: 13, lineHeight: 16, letterSpacing: 0 },
  monoLabel: { family: "mono", web: { family: "mono", weight: 400, stretch: "100%" }, size: 11, lineHeight: 14, letterSpacing: track(11, 0.04), uppercase: true },
  /** Big score numerals (result card odometer). */
  monoScore: { family: "mono", web: { family: "mono", weight: 400, stretch: "100%" }, size: 56, lineHeight: 60, letterSpacing: track(56, -0.03) },
} as const satisfies Record<string, TextStyleToken>;

export type TextStyleName = keyof typeof textStyles;

/** 4-pt grid. */
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

export const radius = {
  none: 0,
  chip: 6,
  input: 10,
  sheetInner: 14,
  sheet: 24,
  /** Game icons use a continuous-corner squircle at this radius for 96pt; scale with `iconRadius()`. */
  icon: 22,
  pill: 999,
} as const;

/** iOS-style squircle radius for an icon of the given size (22 at 96). */
export function iconRadius(size: number): number {
  return Math.round(size * 0.2292 * 10) / 10;
}

/** Layout constants shared by the app and the simulator so both chrome renderings match. */
export const layout = {
  /** Height of the top tab row (Following | For You) below the status bar. */
  topBarHeight: 44,
  /** Width of the right action rail. */
  actionRailWidth: 72,
  /** Height reserved for the bottom-left caption block above the tab bar. */
  captionHeight: 148,
  /** Tab bar and Dock share one height so the morph never resizes the game viewport. */
  bottomBarHeight: 56,
  /** Grabber pill in the Dock. */
  grabberWidth: 44,
  grabberHeight: 5,
  /** Minimum hit target. */
  hitTarget: 44,
  /** Cartridge (spinning game icon) at the bottom of the action rail. */
  cartridgeSize: 44,
  /** Avatar sizes. */
  avatar: { xs: 20, sm: 28, md: 40, lg: 64, xl: 96 },
  /** Horizontal page gutter. */
  gutter: 16,
} as const;

/** Reanimated spring configs. Every spatial move uses a spring. */
export const springs = {
  /** Card snap (mirrors SNAP_SPRING in @thumbcade/swipe-contract). */
  snap: { damping: 26, stiffness: 260, mass: 1 },
  /** Buttons, toggles, small UI. */
  ui: { damping: 20, stiffness: 320, mass: 0.8 },
  /** Bottom sheets. */
  sheet: { damping: 24, stiffness: 220, mass: 1 },
  /** Tab bar -> Dock morph, shared-element moves. */
  morph: { damping: 22, stiffness: 240, mass: 1 },
  /** Playful pops (like, stamps). */
  pop: { damping: 11, stiffness: 340, mass: 0.7 },
} as const;

/** Durations (ms) for opacity-only transitions and for Reduce Motion fallbacks. */
export const durations = {
  instant: 80,
  fade: 120,
  overlay: 220,
  morph: 280,
  scanline: 360,
  coach: 1400,
} as const;

/** Semantic haptic mapping (the shell decides; games only send semantic feedback). */
export const haptics = {
  snap: "soft",
  like: "light",
  newBest: "success",
  result: "medium",
  coach: "light",
  gameTap: "selection",
  gameSuccess: "success",
  gameFail: "error",
  gameImpact: "rigid",
} as const;

export const zIndex = {
  game: 0,
  poster: 1,
  overlay: 10,
  result: 20,
  bottomBar: 30,
  sheet: 40,
  toast: 50,
} as const;
