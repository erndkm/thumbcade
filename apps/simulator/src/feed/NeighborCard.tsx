import { useEffect, useRef } from "react";
import type { Simulator, SimSnapshot } from "../lib/sim.ts";
import { Overlay } from "./Overlay.tsx";

/**
 * Neighbor cards: small live canvas toys standing in for other games in the feed, so swiping is real
 * and you can watch your game pause offscreen and come back.
 */
export interface Neighbor {
  handle: string;
  name: string;
  description: string;
  tags: string[];
  accent: string;
  bg: string;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

export const NEIGHBORS: Neighbor[] = [
  {
    handle: "thumbcade",
    name: "Static Bloom",
    description: "A neighbor card. Swipe back down to your game.",
    tags: ["chill", "loop"],
    accent: "#FF6FB5",
    bg: "#14060E",
    draw(g, w, h, t) {
      g.fillStyle = "#14060E";
      g.fillRect(0, 0, w, h);
      g.save();
      g.translate(w / 2, h * 0.42);
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2 + t * 0.25;
        const r = 120 + Math.sin(t * 1.6 + i * 0.5) * 34;
        g.strokeStyle = i % 2 ? "#FF6FB5" : "#FFD1E6";
        g.globalAlpha = 0.55;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * 26, Math.sin(a) * 26);
        g.quadraticCurveTo(Math.cos(a + 0.9) * r * 0.7, Math.sin(a + 0.9) * r * 0.7, Math.cos(a + 0.3) * r, Math.sin(a + 0.3) * r);
        g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;
    },
  },
  {
    handle: "bitbybit",
    name: "Night Shift",
    description: "Another creator's game would be here. Swipe down to get back to yours.",
    tags: ["reflex", "onetap"],
    accent: "#5CC8FF",
    bg: "#050E16",
    draw(g, w, h, t) {
      g.fillStyle = "#050E16";
      g.fillRect(0, 0, w, h);
      const s = 26;
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          const v = Math.sin(x * 0.03 + t * 2) + Math.cos(y * 0.025 - t * 1.4);
          const a = Math.max(0, v) * 0.45;
          if (a < 0.04) continue;
          g.fillStyle = `rgba(92,200,255,${a})`;
          g.fillRect(x + 4, y + 4, s - 8, s - 8);
        }
      }
    },
  },
  {
    handle: "lowpolyfox",
    name: "Orbitals",
    description: "A placeholder neighbor so the feed has somewhere to go.",
    tags: ["3d", "zen"],
    accent: "#FFB547",
    bg: "#120C02",
    draw(g, w, h, t) {
      g.fillStyle = "#120C02";
      g.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.42;
      g.fillStyle = "#FFB547";
      g.beginPath();
      g.arc(cx, cy, 22, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 5; i++) {
        const r = 52 + i * 30;
        g.strokeStyle = "rgba(255,181,71,0.18)";
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2);
        g.stroke();
        const a = t * (1.2 - i * 0.18) + i * 1.7;
        g.fillStyle = i % 2 ? "#FFE1A8" : "#FFB547";
        g.beginPath();
        g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.42, 6 + i, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
];

export function NeighborCard({ sim, neighbor, top, active }: { sim: Simulator; snap: SimSnapshot; index: number; neighbor: Neighbor; top: number; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vp = sim.viewport;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = vp.width * dpr;
    canvas.height = vp.height * dpr;
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    const t0 = performance.now();
    const frame = () => {
      neighbor.draw(g, vp.width, vp.height, (performance.now() - t0) / 1000);
      // Offscreen neighbors are paused, like any card that isn't current.
      if (active) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [neighbor, vp.width, vp.height, active]);

  return (
    <div className="card card--neighbor" style={{ top, height: vp.height, background: neighbor.bg }} onPointerDown={(e) => sim.onChromePointerDown(e, "chrome")}>
      <canvas ref={canvasRef} className="card__canvas" style={{ width: vp.width, height: vp.height }} />
      <Overlay
        interactive={false}
        hidden={false}
        data={{ handle: neighbor.handle, name: neighbor.name, description: neighbor.description, tags: neighbor.tags, accent: neighbor.accent, iconUrl: null, meta: "neighbor card", counts: { likes: 0, comments: 0, saves: 0, shares: 0 } }}
        actions={{
          liked: false,
          saved: false,
          following: false,
          onLike: () => undefined,
          onSave: () => undefined,
          onFollow: () => undefined,
          onComment: () => undefined,
          onShare: () => undefined,
          onPointerDown: () => undefined,
          suppressClick: () => true,
        }}
      />
    </div>
  );
}
