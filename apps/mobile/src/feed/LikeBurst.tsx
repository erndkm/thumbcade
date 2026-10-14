import { forwardRef, useImperativeHandle, useMemo } from "react";
import { Canvas, Picture, Skia, createPicture } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { c } from "../ui/theme";

export interface LikeBurstHandle {
  fire: () => void;
}

const HEART = [
  [0, 1, 1, 0, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 0, 0, 0],
];

interface Particle {
  angle: number;
  speed: number;
  size: number;
  spin: number;
  kind: 0 | 1 | 2; // 0 = pixel heart, 1 = square spark, 2 = ring
  color: string;
  delay: number;
}

function seededParticles(accent: string): Particle[] {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const list: Particle[] = [];
  for (let i = 0; i < 22; i++) {
    const kind = (i < 9 ? 0 : i < 19 ? 1 : 2) as Particle["kind"];
    list.push({
      angle: -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.7,
      speed: 34 + r() * 52,
      size: kind === 0 ? 1.6 + r() * 1.3 : kind === 1 ? 3 + r() * 3 : 0,
      spin: (r() - 0.5) * 2,
      kind,
      color: i % 3 === 0 ? accent : c.heat,
      delay: r() * 0.12,
    });
  }
  return list;
}

/**
 * Signature moment #1: a Skia particle burst in heat + the game's accent with a scatter of tiny
 * pixel hearts. One Picture is re-recorded per frame on the UI thread.
 */
export const LikeBurst = forwardRef<LikeBurstHandle, { accent: string; size?: number }>(function LikeBurst({ accent, size = 160 }, ref) {
  const t = useSharedValue(0);
  const particles = useMemo(() => seededParticles(accent), [accent]);
  useImperativeHandle(ref, () => ({
    fire: () => {
      t.value = 0;
      t.value = withTiming(1, { duration: 720, easing: Easing.out(Easing.quad) });
    },
  }));
  const cx = size / 2;
  const cy = size / 2;
  const picture = useDerivedValue(() =>
    createPicture((canvas) => {
      const p = t.value;
      if (p <= 0 || p >= 1) return;
      const paint = Skia.Paint();
      for (const q of particles) {
        const local = Math.max(0, Math.min(1, (p - q.delay) / (1 - q.delay)));
        if (local <= 0) continue;
        const dist = q.speed * (1 - (1 - local) * (1 - local));
        const x = cx + Math.cos(q.angle) * dist;
        const y = cy + Math.sin(q.angle) * dist + 26 * local * local;
        const a = 1 - local * local;
        paint.setColor(Skia.Color(q.color));
        paint.setAlphaf(a);
        if (q.kind === 0) {
          const s = q.size;
          for (let row = 0; row < HEART.length; row++) {
            const cols = HEART[row]!;
            for (let col = 0; col < cols.length; col++) {
              if (cols[col]) canvas.drawRect(Skia.XYWHRect(x + (col - 3.5) * s, y + (row - 3) * s, s, s), paint);
            }
          }
        } else if (q.kind === 1) {
          const s = q.size * (1 - local * 0.5);
          canvas.save();
          canvas.translate(x, y);
          canvas.rotate(q.spin * 180 * local, 0, 0);
          canvas.drawRect(Skia.XYWHRect(-s / 2, -s / 2, s, s), paint);
          canvas.restore();
        } else {
          paint.setStyle(1);
          paint.setStrokeWidth(2);
          canvas.drawCircle(cx, cy, 10 + 34 * local, paint);
          paint.setStyle(0);
        }
      }
    }),
  );
  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", width: size, height: size, left: -size / 2, top: -size / 2 }}>
      <Picture picture={picture} />
    </Canvas>
  );
});
