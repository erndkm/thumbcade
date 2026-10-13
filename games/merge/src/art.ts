import { FONT_DISPLAY, roundRect } from "@thumbcade-games/kit";

export const PAL = {
  bg: "#120E1C",
  bgDeep: "#0C0914",
  board: "#1D1730",
  boardLip: "#0E0A17",
  cell: "#281F3F",
  accent: "#B48CFF",
  pink: "#FF7AC6",
  heat: "#FF4A3D",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E6A78",
  ink: "#0D0D10",
} as const;

interface TileStyle {
  fill: string;
  lip: string;
  text: string;
}

/** One color per power of two: cool lilacs into hot pinks, then sunlit golds and cold mints. */
const RAMP: TileStyle[] = [
  { fill: "#EDE6FA", lip: "#B9AED3", text: "#2A2240" }, // 2
  { fill: "#D3C3FF", lip: "#9D88DB", text: "#2A2240" }, // 4
  { fill: "#B48CFF", lip: "#7C55D6", text: "#1A1030" }, // 8
  { fill: "#8E62FF", lip: "#5A35C2", text: "#F3F0E8" }, // 16
  { fill: "#FF7AC6", lip: "#C94A92", text: "#2A0F20" }, // 32
  { fill: "#FF4F8B", lip: "#BF2A60", text: "#FFF3F7" }, // 64
  { fill: "#FFB547", lip: "#C47F1C", text: "#2A1A05" }, // 128
  { fill: "#FFD84D", lip: "#C9A21F", text: "#2A2205" }, // 256
  { fill: "#7CF0C8", lip: "#3FB38C", text: "#05261B" }, // 512
  { fill: "#4DD7FF", lip: "#1F9CC4", text: "#05202A" }, // 1024
  { fill: "#F3F0E8", lip: "#B48CFF", text: "#120E1C" }, // 2048
];

export function tileStyle(value: number): TileStyle {
  const i = Math.max(0, Math.round(Math.log2(value)) - 1);
  return RAMP[Math.min(i, RAMP.length - 1)]!;
}

/** Draws one tile centered at (cx, cy) with side `s`. */
export function drawTile(ctx: CanvasRenderingContext2D, value: number, cx: number, cy: number, s: number, alpha = 1): void {
  if (s <= 1) return;
  const st = tileStyle(value);
  const r = Math.max(4, s * 0.16);
  const lip = Math.max(2, s * 0.06);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = st.lip;
  roundRect(ctx, cx - s / 2, cy - s / 2 + lip, s, s - lip, r);
  ctx.fill();
  ctx.fillStyle = st.fill;
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s - lip, r);
  ctx.fill();
  // Top sheen.
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  roundRect(ctx, cx - s / 2 + s * 0.08, cy - s / 2 + s * 0.06, s * 0.84, s * 0.14, r * 0.6);
  ctx.fill();
  const label = String(value);
  const size = s * (label.length <= 2 ? 0.44 : label.length === 3 ? 0.36 : label.length === 4 ? 0.29 : 0.23);
  ctx.font = `900 ${Math.round(size)}px ${FONT_DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = st.text;
  ctx.fillText(label, cx, cy - lip / 2 + size * 0.04);
  ctx.globalAlpha = 1;
}
