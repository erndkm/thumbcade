import { mix, shade } from "@thumbcade-games/kit";
import { Rectangle, Texture } from "pixi.js";
import { TIER_COLORS } from "./levels.ts";

/** Canvas-baked textures: every brick, token and glow is one quad at draw time. */

export type PowerKind = "split" | "wide" | "beam" | "slow" | "life";

export const POWER_COLORS: Record<PowerKind, string> = {
  split: "#4DF0FF",
  wide: "#B6FF5C",
  beam: "#FF5FC8",
  slow: "#FFB547",
  life: "#FF4A5C",
};

function bake(w: number, h: number, scale: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const g = c.getContext("2d")!;
  g.scale(scale, scale);
  draw(g);
  return Texture.from(c);
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * Every brick variant (7 tiers × 3 damage stages) in one atlas: one GPU upload, one batch.
 * Returns a lookup for the sub-texture of a tier/damage pair.
 */
export function brickAtlas(w: number, h: number, scale: number): (tier: number, damage: number) => Texture {
  const pad = 2;
  const cw = Math.ceil((w + pad) * scale);
  const ch = Math.ceil((h + pad) * scale);
  const c = document.createElement("canvas");
  c.width = cw * 3;
  c.height = ch * 7;
  const g = c.getContext("2d")!;
  for (let tier = 1; tier <= 7; tier++) {
    for (let dmg = 0; dmg < 3; dmg++) {
      g.save();
      g.translate(dmg * cw, (tier - 1) * ch);
      g.scale(scale, scale);
      drawBrick(g, tier, dmg, w, h);
      g.restore();
    }
  }
  const source = Texture.from(c).source;
  const cache = new Map<string, Texture>();
  return (tier, damage) => {
    const key = `${tier}:${damage}`;
    let t = cache.get(key);
    if (!t) {
      t = new Texture({ source, frame: new Rectangle(damage * cw, (tier - 1) * ch, Math.ceil(w * scale), Math.ceil(h * scale)) });
      cache.set(key, t);
    }
    return t;
  };
}

function drawBrick(g: CanvasRenderingContext2D, tier: number, damage: number, w: number, h: number): void {
  const base = TIER_COLORS[tier] ?? "#FFFFFF";
  const metal = tier >= 6;
  {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, shade(base, metal ? 0.25 : 0.18));
    grad.addColorStop(0.55, base);
    grad.addColorStop(1, shade(base, -0.35));
    g.fillStyle = grad;
    rr(g, 0.5, 0.5, w - 1, h - 1, 4);
    g.fill();
    // Inner bevel.
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(4, 1.5);
    g.lineTo(w - 4, 1.5);
    g.stroke();
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(3, h - 3, w - 6, 1.5);
    if (metal) {
      g.fillStyle = shade(base, -0.45);
      for (const x of [5, w - 5]) {
        g.beginPath();
        g.arc(x, h / 2, 1.8, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgba(255,255,255,0.25)";
      g.fillRect(w * 0.2, 3.5, w * 0.6, 1.5);
    } else {
      g.fillStyle = mix(base, "#FFFFFF", 0.55);
      g.globalAlpha = 0.5;
      g.fillRect(6, 4, Math.min(10, w * 0.2), 2);
      g.globalAlpha = 1;
    }
    if (damage > 0) {
      g.strokeStyle = "rgba(7,11,26,0.85)";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(w * 0.32, 0);
      g.lineTo(w * 0.42, h * 0.45);
      g.lineTo(w * 0.36, h);
      g.moveTo(w * 0.42, h * 0.45);
      g.lineTo(w * 0.6, h * 0.55);
      if (damage > 1) {
        g.moveTo(w * 0.7, 0);
        g.lineTo(w * 0.62, h * 0.4);
        g.lineTo(w * 0.78, h);
      }
      g.stroke();
    }
  }
}

export function glowTexture(): Texture {
  return bake(128, 128, 1, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,0.95)");
    r.addColorStop(0.3, "rgba(255,255,255,0.35)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
}

export function dotTexture(): Texture {
  return bake(32, 32, 1, (g) => {
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
  });
}

export function squareTexture(): Texture {
  return bake(8, 8, 1, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 8, 8);
  });
}

/** Hexagonal power token with a glyph (no text). */
export function tokenTexture(kind: PowerKind, scale: number): Texture {
  const s = 30;
  const color = POWER_COLORS[kind];
  return bake(s, s, scale, (g) => {
    const c = s / 2;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
      g.lineTo(c + Math.cos(a) * 13.5, c + Math.sin(a) * 13.5);
    }
    g.closePath();
    g.fillStyle = shade(color, -0.65);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = 2.2;
    g.lineCap = "square";
    switch (kind) {
      case "split":
        for (const [x, y] of [
          [c - 4.5, c + 3],
          [c + 4.5, c + 3],
          [c, c - 4.5],
        ] as const) {
          g.beginPath();
          g.arc(x, y, 2.8, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case "wide":
        g.fillRect(c - 7, c - 1.5, 14, 3);
        g.beginPath();
        g.moveTo(c - 9, c);
        g.lineTo(c - 5, c - 4);
        g.lineTo(c - 5, c + 4);
        g.closePath();
        g.moveTo(c + 9, c);
        g.lineTo(c + 5, c - 4);
        g.lineTo(c + 5, c + 4);
        g.closePath();
        g.fill();
        break;
      case "beam":
        g.fillRect(c - 5, c - 7, 2.5, 14);
        g.fillRect(c + 2.5, c - 7, 2.5, 14);
        break;
      case "slow":
        g.beginPath();
        g.arc(c, c, 6, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(c, c - 3.5);
        g.lineTo(c, c);
        g.lineTo(c + 3, c + 1.5);
        g.stroke();
        break;
      case "life":
        g.beginPath();
        g.moveTo(c, c + 6);
        g.bezierCurveTo(c - 9, c, c - 6, c - 7, c, c - 3);
        g.bezierCurveTo(c + 6, c - 7, c + 9, c, c, c + 6);
        g.fill();
        break;
    }
  });
}
