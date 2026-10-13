import { SLUG_PATTERN, type Controls } from "@thumbcade/protocol";

export type TemplateId = "canvas" | "phaser" | "pixi" | "three" | "blank";
export type ControlStyle = "tap" | "horizontal" | "vertical";

export interface TemplateInfo {
  label: string;
  hint: string;
  sample: string;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  controls: ControlStyle;
  tags: string[];
  description: string;
}

/** Versions resolved with `npm view` when this release was cut. */
export const VERSIONS = {
  sdk: "^1.0.0",
  cli: "^1.0.0",
  vite: "^8.3.4",
  typescript: "^6.0.3",
  phaser: "^4.2.1",
  pixi: "^8.22.0",
  three: "^0.186.1",
  threeTypes: "^0.186.0",
} as const;

export const TEMPLATES: Record<TemplateId, TemplateInfo> = {
  canvas: {
    label: "Canvas 2D",
    hint: "no engine, full control",
    sample: "two lanes, falling blocks, tap to switch",
    deps: {},
    devDeps: {},
    controls: "tap",
    tags: ["arcade", "onetap", "reflex"],
    description: "Two lanes, falling blocks, one thumb. How long can you sidestep?",
  },
  phaser: {
    label: "Phaser",
    hint: "batteries-included 2D engine",
    sample: "drag to catch falling stars",
    deps: { phaser: VERSIONS.phaser },
    devDeps: {},
    controls: "horizontal",
    tags: ["arcade", "catch", "chill"],
    description: "Stars fall, you catch. Miss three and the night is over.",
  },
  pixi: {
    label: "PixiJS",
    hint: "fast 2D WebGL renderer",
    sample: "tap bubbles before they float away",
    deps: { "pixi.js": VERSIONS.pixi },
    devDeps: {},
    controls: "tap",
    tags: ["arcade", "tap", "reflex"],
    description: "Pop every bubble before it floats off. Three escapes and you're out.",
  },
  three: {
    label: "Three.js",
    hint: "3D with WebGL",
    sample: "tap to hop over sliding cubes",
    deps: { three: VERSIONS.three },
    devDeps: { "@types/three": VERSIONS.threeTypes },
    controls: "tap",
    tags: ["3d", "arcade", "onetap"],
    description: "One cube, one button, a conveyor of trouble. Hop.",
  },
  blank: {
    label: "Blank HTML",
    hint: "plain DOM + CSS, no engine",
    sample: "stop the needle inside the zone",
    deps: {},
    devDeps: {},
    controls: "tap",
    tags: ["timing", "onetap", "reflex"],
    description: "Stop the needle in the zone. The zone keeps shrinking.",
  },
};

export const CONTROL_STYLES: Record<ControlStyle, { label: string; hint: string; controls: Controls }> = {
  tap: { label: "Taps only", hint: "the feed keeps vertical swipes", controls: { vertical: false, horizontal: false, multitouch: false, inputs: ["tap"] } },
  horizontal: { label: "Taps + horizontal drags", hint: "vertical swipes still go to the feed", controls: { vertical: false, horizontal: true, multitouch: false, inputs: ["tap", "drag"] } },
  vertical: {
    label: "Any vertical motion",
    hint: "swipes, drags, joysticks: you own the surface while playing",
    controls: { vertical: true, horizontal: true, multitouch: false, inputs: ["swipe", "drag"] },
  },
};

/** Curated accents that keep 3:1 contrast on ink. */
export const ACCENTS = ["#FF6A1A", "#3DE0FF", "#FF6FB5", "#B48CFF", "#4DFF88", "#FFE14D", "#5CC8FF", "#FF3D6E", "#00E5C7", "#FFB23F"];

export function slugify(name: string): string {
  let s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (s.length < 3) s = `${s || "my"}-game`;
  return SLUG_PATTERN.test(s) ? s : "my-game";
}

export function pickAccent(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length]!;
}

/** A deep background tone derived from the accent (88% toward ink). */
export function backgroundFor(accent: string): string {
  const v = accent.replace("#", "");
  const mix = (i: number, ink: number) => Math.round(parseInt(v.slice(i, i + 2), 16) * 0.12 + ink * 0.88);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(mix(0, 0x0d))}${hex(mix(2, 0x0d))}${hex(mix(4, 0x10))}`;
}
