/** Pre-rendered sprites for Flapjack (drawn once to offscreen canvases; cheap to blit every frame). */

export const PAL = {
  wallTop: "#0B1A20",
  wallBottom: "#12303A",
  panel: "#0E252D",
  rail: "#5E7480",
  amber: "#FFB23F",
  syrup: "#B8621B",
  syrupDeep: "#7A3A0E",
  cake: "#F2B85B",
  cakeEdge: "#C98436",
  cakeUnder: "#D89A45",
  butter: "#FFE89A",
  steel: "#C9D2DC",
  steelDark: "#7C8995",
  steelLight: "#F1F5F9",
  pink: "#FF5C8A",
  cyan: "#5CE1E6",
  berry: "#5B6CFF",
  floorA: "#E8E4D9",
  floorB: "#1C1C22",
  ink: "#0D0D10",
  paper: "#F3F0E8",
  /** Warm griddle light for the impact flash. */
  flash: "#FFECC8",
} as const;

function canvas(w: number, h: number, scale: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  return [c, ctx];
}

/** A fork head (tines pointing down), 64 wide, 96 tall. Flip vertically for the bottom fork. */
export function forkHead(scale: number): HTMLCanvasElement {
  const w = 64;
  const h = 96;
  const [c, g] = canvas(w, h, scale);
  const steel = g.createLinearGradient(0, 0, w, 0);
  steel.addColorStop(0, PAL.steelDark);
  steel.addColorStop(0.35, PAL.steelLight);
  steel.addColorStop(0.6, PAL.steel);
  steel.addColorStop(1, PAL.steelDark);
  g.fillStyle = steel;
  // Neck: from the handle (top, 20 wide) flaring into the head.
  g.beginPath();
  g.moveTo(w / 2 - 10, 0);
  g.lineTo(w / 2 + 10, 0);
  g.quadraticCurveTo(w / 2 + 12, 22, w - 4, 38);
  g.lineTo(w - 4, 46);
  g.lineTo(4, 46);
  g.lineTo(4, 38);
  g.quadraticCurveTo(w / 2 - 12, 22, w / 2 - 10, 0);
  g.closePath();
  g.fill();
  // Four tines with rounded tips.
  const tw = 9;
  const gap = (w - 8 - tw * 4) / 3;
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * (tw + gap);
    g.beginPath();
    g.moveTo(x, 44);
    g.lineTo(x + tw, 44);
    g.lineTo(x + tw, h - tw / 2);
    g.arc(x + tw / 2, h - tw / 2, tw / 2, 0, Math.PI);
    g.closePath();
    g.fill();
  }
  // Specular stripe.
  g.globalAlpha = 0.55;
  g.fillStyle = PAL.steelLight;
  g.fillRect(w * 0.3, 8, 3, h - 18);
  g.globalAlpha = 1;
  return c;
}

/** Neon signs on the diner wall: glow baked in. */
export function neonSigns(scale: number, displayFont: string): HTMLCanvasElement[] {
  const make = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const [c, g] = canvas(w, h, scale);
    g.lineCap = "round";
    g.lineJoin = "round";
    // Glow pass then crisp pass.
    for (const pass of [0, 1]) {
      g.save();
      if (pass === 0) {
        g.shadowBlur = 18;
        g.globalAlpha = 0.9;
      } else {
        g.shadowBlur = 4;
      }
      draw(g);
      g.restore();
    }
    return c;
  };
  const stack = make(150, 130, (g) => {
    g.strokeStyle = PAL.amber;
    g.shadowColor = PAL.amber;
    g.lineWidth = 5;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(75, 100 - i * 22, 52 - i * 4, 12, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = PAL.pink;
    g.shadowColor = PAL.pink;
    g.beginPath();
    g.moveTo(52, 52);
    g.quadraticCurveTo(75, 40, 98, 52);
    g.lineTo(98, 70);
    g.moveTo(60, 54);
    g.lineTo(60, 78);
    g.stroke();
    g.strokeStyle = PAL.paper;
    g.shadowColor = PAL.amber;
    g.lineWidth = 4;
    g.strokeRect(66, 26, 18, 12);
  });
  const cup = make(140, 130, (g) => {
    g.strokeStyle = PAL.cyan;
    g.shadowColor = PAL.cyan;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(28, 50);
    g.lineTo(36, 108);
    g.lineTo(92, 108);
    g.lineTo(100, 50);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(104, 74, 14, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.strokeStyle = PAL.paper;
    g.shadowColor = PAL.cyan;
    g.lineWidth = 3.5;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(46 + i * 18, 40);
      g.bezierCurveTo(38 + i * 18, 28, 56 + i * 18, 22, 48 + i * 18, 8);
      g.stroke();
    }
  });
  const eat = make(170, 90, (g) => {
    g.font = `900 64px ${displayFont}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 3.5;
    g.strokeStyle = PAL.pink;
    g.shadowColor = PAL.pink;
    g.strokeText("EAT", 85, 48);
  });
  return [stack, cup, eat];
}

/** The pancake (side A on top), 52×40 sprite centered. */
export function pancake(scale: number, underside: boolean): HTMLCanvasElement {
  const w = 52;
  const h = 40;
  const [c, g] = canvas(w, h, scale);
  const cx = w / 2;
  const cy = h / 2 + 3;
  // Rim (thickness).
  g.fillStyle = PAL.cakeEdge;
  g.beginPath();
  g.ellipse(cx, cy + 4, 23, 13, 0, 0, Math.PI * 2);
  g.fill();
  // Face.
  const face = g.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 24);
  face.addColorStop(0, underside ? "#E9AE5A" : "#FFD27A");
  face.addColorStop(1, underside ? PAL.cakeUnder : PAL.cake);
  g.fillStyle = face;
  g.beginPath();
  g.ellipse(cx, cy, 23, 13, 0, 0, Math.PI * 2);
  g.fill();
  if (underside) {
    // Griddle freckles.
    g.fillStyle = "rgba(122,58,14,0.45)";
    for (const [x, y, r] of [
      [-9, -2, 2.2],
      [4, 3, 1.8],
      [10, -4, 1.5],
      [-2, -6, 1.3],
      [-14, 4, 1.4],
    ] as const) {
      g.beginPath();
      g.arc(cx + x, cy + y, r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Syrup pool + drip, butter pat.
    g.fillStyle = PAL.syrup;
    g.beginPath();
    g.ellipse(cx + 1, cy - 1, 13, 7, 0.1, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(cx + 10, cy + 2);
    g.quadraticCurveTo(cx + 17, cy + 10, cx + 14, cy + 15);
    g.quadraticCurveTo(cx + 11, cy + 10, cx + 7, cy + 4);
    g.fill();
    g.fillStyle = PAL.butter;
    g.save();
    g.translate(cx - 1, cy - 4);
    g.rotate(-0.18);
    g.fillRect(-6, -4, 12, 8);
    g.fillStyle = "#FFF6CF";
    g.fillRect(-6, -4, 12, 2.5);
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.beginPath();
    g.ellipse(cx - 11, cy - 5, 4, 1.6, -0.4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}
