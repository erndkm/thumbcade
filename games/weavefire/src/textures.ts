/**
 * Every sprite in Weavefire is drawn once, here, into a canvas at boot: glows are baked into the art (no shadowBlur or
 * filters at run time), and the renderer only moves, tints and scales quads. Shapes are drawn in field units times
 * `TS` texels per unit, centred on the canvas.
 *
 * House look (Voltbrick, Neon Chop): ink-filled silhouettes with a bright rim in their own colour, an inner line and a
 * paper glint. Enemy bullets are the brightest things on screen: a white core in a hot-pink rim inside a dark ring.
 */
import { Texture } from "pixi.js";
import { mix, rgba } from "@thumbcade-games/kit/color";
import { PAL } from "./consts.ts";

/** Texels per field unit. */
export const TS = 3;

type Draw = (g: CanvasRenderingContext2D) => void;

function make(wUnits: number, hUnits: number, draw: Draw): Texture {
  const c = document.createElement("canvas");
  c.width = Math.ceil(wUnits * TS);
  c.height = Math.ceil(hUnits * TS);
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.scale(TS, TS);
  g.lineJoin = "round";
  g.lineCap = "round";
  draw(g);
  return Texture.from(c);
}

/** The same drawing as a flat white silhouette (for hit flashes). */
function silhouette(wUnits: number, hUnits: number, draw: Draw): Texture {
  return make(wUnits, hUnits, (g) => {
    draw(g);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#ffffff";
    g.fillRect(-wUnits, -hUnits, wUnits * 2, hUnits * 2);
  });
}

function radial(g: CanvasRenderingContext2D, r: number, stops: Array<[number, string]>): void {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
}

function poly(g: CanvasRenderingContext2D, pts: readonly number[]): void {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.closePath();
}

function scaled(pts: readonly number[], k: number, dx = 0, dy = 0): number[] {
  return pts.map((v, i) => v * k + (i % 2 ? dy : dx));
}

/** House enemy body: dark tinted fill, bright rim, inner line, glint. */
function body(g: CanvasRenderingContext2D, pts: readonly number[], rim: string, width = 1.8): void {
  poly(g, pts);
  g.fillStyle = mix(rim, PAL.ink, 0.74);
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = width + 2.2;
  g.stroke();
  g.strokeStyle = rim;
  g.lineWidth = width;
  g.stroke();
  poly(g, scaled(pts, 0.6));
  g.strokeStyle = rgba(rim, 0.4);
  g.lineWidth = 1;
  g.stroke();
}

function hexPts(r: number, flat = true): number[] {
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (flat ? 0 : Math.PI / 6) + (i * Math.PI) / 3;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

export interface Textures {
  glow: Texture;
  glowSoft: Texture;
  bulletS: Texture;
  bulletL: Texture;
  shot: Texture;
  shotHeavy: Texture;
  dartShot: Texture;
  crystal: Texture;
  spark: Texture;
  shard: Texture;
  ring: Texture;
  puff: Texture;
  dot: Texture;
  line: Texture;
  ships: Texture[];
  hitbox: Texture;
  bubble: Texture;
  flame: Texture;
  drone: Texture;
  dart: Texture;
  dartFlash: Texture;
  weaverHead: Texture;
  weaverBead: Texture;
  weaverFlash: Texture;
  bloomCore: Texture;
  bloomPetal: Texture;
  bloomFlash: Texture;
  bastion: Texture;
  bastionEye: Texture;
  bastionFlash: Texture;
  skiff: Texture;
  skiffFlash: Texture;
  loomArm: Texture;
  loomArmFlash: Texture;
  loomCoreShut: Texture;
  loomCoreOpen: Texture;
  loomCoreFlash: Texture;
  loomWheel: Texture;
  pickups: Record<"power" | "drone" | "shield" | "nova", Texture>;
  pickupRing: Texture;
}

export function createTextures(): Textures {
  const glow = make(64, 64, (g) => radial(g, 32, [[0, "rgba(255,255,255,0.9)"], [0.25, "rgba(255,255,255,0.42)"], [0.6, "rgba(255,255,255,0.1)"], [1, "rgba(255,255,255,0)"]]));
  const glowSoft = make(64, 64, (g) => radial(g, 32, [[0, "rgba(255,255,255,0.5)"], [0.5, "rgba(255,255,255,0.16)"], [1, "rgba(255,255,255,0)"]]));

  // Enemy bullets: dark ring, hot rim, white core, a short pink halo. Visual radius ~7 (small) and ~10.5 (big).
  const bullet = (r: number, big: boolean) => (g: CanvasRenderingContext2D) => {
    radial(g, r * 1.9, [[0.45, rgba(PAL.bullet, 0.35)], [1, rgba(PAL.bullet, 0)]]);
    g.fillStyle = rgba("#12040C", 0.92);
    g.beginPath();
    g.arc(0, 0, r * 1.06, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAL.bullet;
    g.beginPath();
    g.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    g.fill();
    if (big) {
      g.strokeStyle = rgba("#12040C", 0.7);
      g.lineWidth = 0.9;
      g.beginPath();
      g.arc(0, 0, r * 0.66, 0, Math.PI * 2);
      g.stroke();
    }
    radial(g, r * (big ? 0.56 : 0.6), [[0, "#FFFFFF"], [0.6, "#FFFFFF"], [1, PAL.bulletHi]]);
  };
  const bulletS = make(28, 28, bullet(7, false));
  const bulletL = make(40, 40, bullet(10.5, true));

  // Player bolts: a needle of light, white core, aquamarine edge. Drawn pointing up.
  const needle = (len: number, w: number) => (g: CanvasRenderingContext2D) => {
    // A thin needle of light: faint aquamarine sheath, white core, brightest at the tip.
    g.fillStyle = rgba(PAL.accent, 0.16);
    g.beginPath();
    g.ellipse(0, 0, w * 1.5, len * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    const body = g.createLinearGradient(0, -len / 2, 0, len / 2);
    body.addColorStop(0, rgba(PAL.accentHi, 1));
    body.addColorStop(0.45, rgba(PAL.accent, 0.95));
    body.addColorStop(1, rgba(PAL.accent, 0));
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 0, w * 0.62, len / 2, 0, 0, Math.PI * 2);
    g.fill();
    const core = g.createLinearGradient(0, -len / 2, 0, len * 0.25);
    core.addColorStop(0, "#FFFFFF");
    core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core;
    g.beginPath();
    g.ellipse(0, -len * 0.12, w * 0.3, len * 0.38, 0, 0, Math.PI * 2);
    g.fill();
  };
  const shot = make(10, 40, needle(32, 2.4));
  const shotHeavy = make(14, 50, needle(40, 3.4));
  const dartShot = make(10, 16, (g) => {
    g.fillStyle = rgba(PAL.paper, 0.25);
    g.beginPath();
    g.ellipse(0, 0, 3.4, 6.6, 0, 0, Math.PI * 2);
    g.fill();
    poly(g, [0, -6, 2.4, 1, 0, 4.5, -2.4, 1]);
    g.fillStyle = PAL.accentHi;
    g.fill();
  });

  const crystal = make(16, 20, (g) => {
    g.fillStyle = rgba(PAL.crystal, 0.28);
    g.beginPath();
    g.ellipse(0, 0, 7, 9, 0, 0, Math.PI * 2);
    g.fill();
    poly(g, [0, -6.5, 4.2, 0, 0, 6.5, -4.2, 0]);
    g.fillStyle = PAL.crystal;
    g.fill();
    poly(g, [0, -6.5, 4.2, 0, 0, 0]);
    g.fillStyle = "#FFF6C8";
    g.fill();
    poly(g, [0, 0, -4.2, 0, 0, 6.5]);
    g.fillStyle = "#C9961E";
    g.fill();
  });

  const spark = make(24, 6, (g) => {
    const gr = g.createLinearGradient(-12, 0, 12, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.7, "rgba(255,255,255,0.9)");
    gr.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, 12, 1.4, 0, 0, Math.PI * 2);
    g.fill();
  });
  const shard = make(10, 10, (g) => {
    poly(g, [0, -4, 3.6, 2.6, -3, 3.2]);
    g.fillStyle = "#FFFFFF";
    g.fill();
  });
  const ring = make(64, 64, (g) => {
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, 29, 0, Math.PI * 2);
    g.stroke();
  });
  const puff = make(32, 32, (g) => radial(g, 16, [[0, "rgba(255,255,255,0.75)"], [0.55, "rgba(255,255,255,0.4)"], [1, "rgba(255,255,255,0)"]]));
  const dot = make(8, 8, (g) => radial(g, 4, [[0, "#FFFFFF"], [0.5, "rgba(255,255,255,0.9)"], [1, "rgba(255,255,255,0)"]]));
  const line = make(4, 32, (g) => {
    const gr = g.createLinearGradient(0, -16, 0, 16);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, "rgba(255,255,255,1)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(-0.7, -16, 1.4, 32);
  });

  // --- the shuttle -----------------------------------------------------------------------------------
  const ships: Texture[] = [];
  for (let level = 1; level <= 5; level++) ships.push(make(48, 48, (g) => drawShip(g, level)));
  const hitbox = make(14, 14, (g) => {
    g.fillStyle = rgba(PAL.ink, 0.85);
    g.beginPath();
    g.arc(0, 0, 4.6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = PAL.accent;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, 3.6, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#FFFFFF";
    g.beginPath();
    g.arc(0, 0, 2.1, 0, Math.PI * 2);
    g.fill();
  });
  const bubble = make(64, 64, (g) => {
    radial(g, 30, [[0.6, rgba(PAL.accent, 0)], [0.86, rgba(PAL.accent, 0.16)], [0.96, rgba(PAL.accent, 0.55)], [1, rgba(PAL.accent, 0)]]);
  });
  const flame = make(12, 24, (g) => {
    const gr = g.createLinearGradient(0, -10, 0, 12);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, rgba(PAL.accent, 0.9));
    gr.addColorStop(1, rgba(PAL.accent, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -10);
    g.quadraticCurveTo(4.6, -2, 0, 12);
    g.quadraticCurveTo(-4.6, -2, 0, -10);
    g.fill();
  });
  const drone = make(22, 22, (g) => {
    radial(g, 10, [[0, rgba(PAL.accent, 0.4)], [1, rgba(PAL.accent, 0)]]);
    poly(g, [0, -6.5, 4.6, 0, 0, 5.5, -4.6, 0]);
    g.fillStyle = mix(PAL.accent, PAL.ink, 0.55);
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 2.6;
    g.stroke();
    g.strokeStyle = PAL.accent;
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = PAL.paper;
    g.beginPath();
    g.arc(0, -0.5, 1.6, 0, Math.PI * 2);
    g.fill();
  });

  // --- enemies (drawn pointing down: heading 0) ----------------------------------------------------------
  const dartPts = [0, 12, 11, -6, 4.5, -3, 0, -9, -4.5, -3, -11, -6];
  const drawDart = (g: CanvasRenderingContext2D) => {
    body(g, dartPts, PAL.dart);
    // A hot core that shows where it is heading.
    radial(g, 4, [[0, "#FFFFFF"], [0.4, PAL.dart], [1, rgba(PAL.dart, 0)]]);
    g.strokeStyle = rgba(PAL.paper, 0.8);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-7.5, -4.2);
    g.lineTo(-3.5, -2.2);
    g.stroke();
  };
  const dart = make(30, 30, drawDart);
  const dartFlash = silhouette(30, 30, drawDart);

  const drawWeaverHead = (g: CanvasRenderingContext2D) => {
    // Mandible fins, then a rounded hex bead with an eye.
    g.strokeStyle = PAL.ink;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-6, 6);
    g.quadraticCurveTo(-10, 12, -4, 15);
    g.moveTo(6, 6);
    g.quadraticCurveTo(10, 12, 4, 15);
    g.stroke();
    g.strokeStyle = PAL.weaver;
    g.lineWidth = 1.8;
    g.stroke();
    body(g, hexPts(10, false), PAL.weaver);
    radial(g, 4.2, [[0, "#FFFFFF"], [0.45, PAL.weaver], [1, rgba(PAL.weaver, 0)]]);
  };
  const drawWeaverBead = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.arc(0, 0, 8, 0, Math.PI * 2);
    g.fillStyle = mix(PAL.weaver, PAL.ink, 0.72);
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 3.8;
    g.stroke();
    g.strokeStyle = PAL.weaver;
    g.lineWidth = 1.6;
    g.stroke();
    g.strokeStyle = rgba(PAL.weaver, 0.45);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, 4.4, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = PAL.weaver;
    g.beginPath();
    g.arc(0, 0, 1.8, 0, Math.PI * 2);
    g.fill();
  };
  const weaverHead = make(30, 36, drawWeaverHead);
  const weaverBead = make(22, 22, drawWeaverBead);
  const weaverFlash = silhouette(22, 22, drawWeaverBead);

  const drawBloomCore = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.arc(0, 0, 11, 0, Math.PI * 2);
    g.fillStyle = mix(PAL.bloom, PAL.ink, 0.7);
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = PAL.bloom;
    g.lineWidth = 1.8;
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      g.fillStyle = rgba(PAL.bloom, 0.55);
      g.beginPath();
      g.arc(Math.cos(a) * 6.6, Math.sin(a) * 6.6, 1.3, 0, Math.PI * 2);
      g.fill();
    }
    radial(g, 5, [[0, "#FFFFFF"], [0.45, PAL.bloom], [1, rgba(PAL.bloom, 0)]]);
  };
  const bloomCore = make(28, 28, drawBloomCore);
  const bloomFlash = silhouette(28, 28, drawBloomCore);
  // A petal points outward along -y from the pod's centre; the renderer places and turns six of them.
  const bloomPetal = make(18, 24, (g) => {
    g.beginPath();
    g.moveTo(0, 9);
    g.bezierCurveTo(9, 6, 8, -6, 0, -9.5);
    g.bezierCurveTo(-8, -6, -9, 6, 0, 9);
    g.fillStyle = mix(PAL.bloom, PAL.ink, 0.62);
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 3.4;
    g.stroke();
    g.strokeStyle = PAL.bloom;
    g.lineWidth = 1.5;
    g.stroke();
    g.strokeStyle = rgba(PAL.paper, 0.6);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 5);
    g.lineTo(0, -5);
    g.stroke();
  });

  const drawBastion = (g: CanvasRenderingContext2D) => {
    body(g, hexPts(30, true), PAL.bastion, 2.2);
    // Armour plates and vents.
    g.strokeStyle = rgba(PAL.bastion, 0.55);
    g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 6;
      g.beginPath();
      g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18);
      g.lineTo(Math.cos(a) * 25, Math.sin(a) * 25);
      g.stroke();
    }
    g.fillStyle = rgba(PAL.paper, 0.75);
    for (const [x, y] of [[-14, -14], [14, -14], [-20, 4], [20, 4]] as const) {
      g.beginPath();
      g.arc(x, y, 1.3, 0, Math.PI * 2);
      g.fill();
    }
    // The cannon housing.
    poly(g, [-9, 8, 9, 8, 6, 20, -6, 20]);
    g.fillStyle = mix(PAL.bastion, PAL.ink, 0.55);
    g.fill();
    g.strokeStyle = PAL.bastion;
    g.lineWidth = 1.4;
    g.stroke();
  };
  const bastion = make(68, 68, drawBastion);
  const bastionFlash = silhouette(68, 68, drawBastion);
  // The slit eye that glows before it fires.
  const bastionEye = make(26, 12, (g) => {
    radial(g, 6, [[0, "#FFFFFF"], [0.5, rgba(PAL.bastion, 0.9)], [1, rgba(PAL.bastion, 0)]]);
    g.fillStyle = "#FFF1E0";
    g.beginPath();
    g.ellipse(0, 0, 10, 2.2, 0, 0, Math.PI * 2);
    g.fill();
  });

  // The supply skiff (friendly-looking: paper hull, aquamarine stripe, a crate). Points right.
  const drawSkiff = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-19, -5);
    g.quadraticCurveTo(0, -11, 19, 0);
    g.quadraticCurveTo(0, 11, -19, 5);
    g.closePath();
    g.fillStyle = "#D9D5DF";
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 2.4;
    g.stroke();
    g.fillStyle = PAL.accent;
    g.fillRect(-15, -1.2, 26, 2.4);
    g.fillStyle = "#2A2440";
    g.fillRect(-9, -9.5, 13, 8);
    g.strokeStyle = PAL.ink;
    g.lineWidth = 1.4;
    g.strokeRect(-9, -9.5, 13, 8);
    poly(g, [-2.5, -8.6, 0.3, -5.5, -2.5, -2.4, -5.3, -5.5]);
    g.fillStyle = PAL.crystal;
    g.fill();
    g.fillStyle = PAL.accentHi;
    g.beginPath();
    g.arc(13, 0, 1.6, 0, Math.PI * 2);
    g.fill();
  };
  const skiff = make(44, 26, drawSkiff);
  const skiffFlash = silhouette(44, 26, drawSkiff);

  // --- the Loom -----------------------------------------------------------------------------------------
  const drawArm = (g: CanvasRenderingContext2D) => {
    // A dark shuttle pod pointing outward (down = away from the hub), gold rim, glowing emitter tip.
    g.beginPath();
    g.moveTo(0, 19);
    g.quadraticCurveTo(12, 2, 0, -17);
    g.quadraticCurveTo(-12, 2, 0, 19);
    g.fillStyle = mix(PAL.loom, PAL.ink, 0.7);
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 4.4;
    g.stroke();
    g.strokeStyle = PAL.loomGold;
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = rgba(PAL.loom, 0.7);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, 12);
    g.lineTo(0, -10);
    g.stroke();
    g.save();
    g.translate(0, 13);
    radial(g, 5.5, [[0, "#FFFFFF"], [0.4, PAL.bullet], [1, rgba(PAL.bullet, 0)]]);
    g.restore();
  };
  const loomArm = make(32, 44, drawArm);
  const loomArmFlash = silhouette(32, 44, drawArm);
  const drawCore = (open: boolean) => (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.arc(0, 0, 34, 0, Math.PI * 2);
    g.fillStyle = mix(PAL.loom, PAL.ink, 0.76);
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 5;
    g.stroke();
    g.strokeStyle = PAL.loomGold;
    g.lineWidth = 2.4;
    g.stroke();
    g.strokeStyle = rgba(PAL.loom, 0.8);
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, 27, 0, Math.PI * 2);
    g.stroke();
    // Twelve gold studs.
    g.fillStyle = PAL.loomGold;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      g.beginPath();
      g.arc(Math.cos(a) * 30.5, Math.sin(a) * 30.5, 1.2, 0, Math.PI * 2);
      g.fill();
    }
    if (open) {
      // The eye: a dark iris ringed in pink, a hot pupil, one glint.
      g.fillStyle = "#1A0612";
      g.beginPath();
      g.arc(0, 0, 22, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = PAL.bullet;
      g.lineWidth = 2.6;
      g.stroke();
      g.strokeStyle = rgba(PAL.bullet, 0.5);
      g.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        g.beginPath();
        g.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
        g.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
        g.stroke();
      }
      radial(g, 10, [[0, "#FFFFFF"], [0.35, PAL.bulletHi], [0.7, PAL.bullet], [1, rgba(PAL.bullet, 0)]]);
      g.fillStyle = "#FFFFFF";
      g.beginPath();
      g.arc(-5, -6, 2.4, 0, Math.PI * 2);
      g.fill();
    } else {
      // Six shutter plates closed over the eye.
      for (let i = 0; i < 6; i++) {
        g.save();
        g.rotate((i * Math.PI) / 3);
        poly(g, [0, 0, 20, -3, 17, 10]);
        g.fillStyle = mix(PAL.loomGold, PAL.ink, 0.45);
        g.fill();
        g.strokeStyle = PAL.ink;
        g.lineWidth = 1.2;
        g.stroke();
        g.restore();
      }
      radial(g, 4, [[0, "#FFFFFF"], [1, rgba(PAL.bullet, 0)]]);
    }
  };
  const loomCoreShut = make(76, 76, drawCore(false));
  const loomCoreOpen = make(76, 76, drawCore(true));
  const loomCoreFlash = silhouette(76, 76, drawCore(false));
  const loomWheel = make(176, 176, (g) => {
    // The hub plate behind the core: solid, so the Loom reads as one machine.
    g.fillStyle = mix(PAL.loom, PAL.ink, 0.84);
    g.beginPath();
    g.arc(0, 0, 52, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(PAL.loomGold, 0.6);
    g.lineWidth = 1.4;
    g.stroke();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(0, 0, 74, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = rgba(PAL.loom, 0.9);
    g.lineWidth = 3.4;
    g.beginPath();
    g.arc(0, 0, 74, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = rgba(PAL.loomGold, 0.35);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, 80, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 68, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(Math.sin(a) * 40, Math.cos(a) * 40);
      g.lineTo(Math.sin(a) * 74, Math.cos(a) * 74);
      g.stroke();
      g.strokeStyle = rgba(PAL.loomGold, 0.75);
      g.lineWidth = 2.2;
      g.stroke();
    }
    // Threads strung between the spokes: the loom's warp.
    g.strokeStyle = rgba(PAL.bullet, 0.3);
    g.lineWidth = 0.9;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const b = ((i + 2) * Math.PI) / 3;
      g.beginPath();
      g.moveTo(Math.sin(a) * 74, Math.cos(a) * 74);
      g.lineTo(Math.sin(b) * 74, Math.cos(b) * 74);
      g.stroke();
    }
  });

  // --- pickups: hex badges with an icon ----------------------------------------------------------------
  const badge = (color: string, icon: (g: CanvasRenderingContext2D) => void) =>
    make(40, 40, (g) => {
      radial(g, 19, [[0.4, rgba(color, 0.3)], [1, rgba(color, 0)]]);
      poly(g, hexPts(12.5, false));
      g.fillStyle = mix(color, PAL.ink, 0.78);
      g.fill();
      g.strokeStyle = PAL.ink;
      g.lineWidth = 4.4;
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = color;
      g.strokeStyle = color;
      icon(g);
    });
  const pickups = {
    power: badge(PAL.accent, (g) => {
      // Two chevrons: more guns.
      g.lineWidth = 2.4;
      for (const y of [-1.5, 4]) {
        g.beginPath();
        g.moveTo(-5, y + 2.5);
        g.lineTo(0, y - 2.5);
        g.lineTo(5, y + 2.5);
        g.stroke();
      }
    }),
    drone: badge(PAL.paper, (g) => {
      poly(g, [0, -6, 4.2, 0, 0, 5, -4.2, 0]);
      g.fill();
      g.fillStyle = PAL.ink;
      g.beginPath();
      g.arc(0, -0.5, 1.4, 0, Math.PI * 2);
      g.fill();
    }),
    shield: badge("#8CB8FF", (g) => {
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(0, 1, 5.4, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      g.beginPath();
      g.arc(0, 1, 2.6, 0, Math.PI * 2);
      g.fill();
    }),
    nova: badge(PAL.bloom, (g) => {
      const pts: number[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        const r = i % 2 ? 2.6 : 6.8;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      poly(g, pts);
      g.fill();
    }),
  };
  const pickupRing = make(44, 44, (g) => {
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 1.2;
    g.setLineDash([3, 3.2]);
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.stroke();
  });

  return {
    glow, glowSoft, bulletS, bulletL, shot, shotHeavy, dartShot, crystal, spark, shard, ring, puff, dot, line, ships, hitbox, bubble,
    flame, drone, dart, dartFlash, weaverHead, weaverBead, weaverFlash, bloomCore, bloomPetal, bloomFlash, bastion, bastionEye,
    bastionFlash, skiff, skiffFlash, loomArm, loomArmFlash, loomCoreShut, loomCoreOpen, loomCoreFlash, loomWheel, pickups, pickupRing,
  };
}

/**
 * The shuttle, pointing up, its hitbox at (0, 0). Every gun level adds hardware you can see: wingtip lights, side
 * cannons, longer wings, outer pods and a halo.
 */
export function drawShip(g: CanvasRenderingContext2D, level: number): void {
  const wing = level >= 4 ? 16 : 13;
  // Halo behind the ship at full power.
  if (level >= 5) radial(g, 22, [[0.55, rgba(PAL.accent, 0)], [0.85, rgba(PAL.accent, 0.18)], [1, rgba(PAL.accent, 0)]]);
  // Wings: ink with a paper edge.
  const wings = [5, 0, wing, 7, wing - 1, 12, 5, 9, -5, 9, -(wing - 1), 12, -wing, 7, -5, 0];
  poly(g, wings);
  g.fillStyle = "#1E1A33";
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = 3;
  g.stroke();
  g.strokeStyle = "#CFCBD8";
  g.lineWidth = 1.1;
  g.stroke();
  // Outer pods (level 5).
  if (level >= 5) {
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(sx * 19, 4, 2.6, 6.5, 0, 0, Math.PI * 2);
      g.fillStyle = PAL.paper;
      g.fill();
      g.strokeStyle = PAL.ink;
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = PAL.accent;
      g.beginPath();
      g.arc(sx * 19, -1.5, 1.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Side cannons (level 3+).
  if (level >= 3) {
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(sx * 10.5, -2, 2.4, 6, 0, 0, Math.PI * 2);
      g.fillStyle = PAL.paper;
      g.fill();
      g.strokeStyle = PAL.ink;
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = PAL.accent;
      g.fillRect(sx * 10.5 - 0.9, -8.5, 1.8, 3);
    }
  }
  // The hull: a loom shuttle, pointed at both ends, lit from the left.
  g.beginPath();
  g.moveTo(0, -18);
  g.quadraticCurveTo(8.6, -2, 0, 14);
  g.quadraticCurveTo(-8.6, -2, 0, -18);
  g.fillStyle = PAL.paper;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = "#C9C4D4";
  g.fillRect(0, -20, 10, 36);
  g.restore();
  g.strokeStyle = PAL.ink;
  g.lineWidth = 1.8;
  g.stroke();
  // Spine and the canopy slit.
  g.strokeStyle = rgba(PAL.ink, 0.45);
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(0, -15);
  g.lineTo(0, 11);
  g.stroke();
  g.fillStyle = PAL.ink;
  g.beginPath();
  g.ellipse(0, -8, 2.2, 4.6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PAL.accent;
  g.beginPath();
  g.ellipse(0, -8.4, 1.2, 3.4, 0, 0, Math.PI * 2);
  g.fill();
  // Wingtip lights (level 2+).
  if (level >= 2) {
    g.fillStyle = PAL.accent;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.arc(sx * (wing - 0.5), 9, 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }
}
