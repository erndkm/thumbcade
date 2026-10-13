"use client";
import { formatCount } from "@thumbcade/protocol";
import { useState } from "react";

export interface DailyPoint {
  day: string; // YYYY-MM-DD
  value: number;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Single-series column chart (no legend: the title names the series). Columns ≤ 24px, 4px rounded
 * data-end, square baseline, 2px surface gap, hairline grid, per-column hover/focus tooltip, table view.
 */
export function DailyChart({ title, points, unit }: { title: string; points: DailyPoint[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { top: 16, right: 8, bottom: 28, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ticks = [0, max / 2, max];
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.min(24, slot - 2);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const total = points.reduce((a, p) => a + p.value, 0);
  const hovered = hover !== null ? points[hover] : null;

  return (
    <figure className="flex flex-col gap-4">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="font-semiwide text-[16px] font-bold text-text">{title}</span>
        <span className="font-mono text-[13px] text-text-mute">
          {formatCount(total)} {unit} · {points.length} days
        </span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${title}: ${points.map((p) => `${fmtDay(p.day)} ${p.value}`).join(", ")}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--tc-chart-grid)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--tc-text-mute)" fontFamily="var(--tc-font-mono)">
                {formatCount(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = pad.left + i * slot + (slot - barW) / 2;
            const h = Math.max(0, innerH - (y(p.value) - pad.top));
            const r = Math.min(4, h / 2, barW / 2);
            const top = pad.top + innerH - h;
            const path =
              h <= 0
                ? ""
                : `M${x} ${pad.top + innerH} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + barW - r} Q${x + barW} ${top} ${x + barW} ${top + r} V${pad.top + innerH} Z`;
            return (
              <g key={p.day}>
                {path ? <path d={path} fill={hover === i ? "var(--tc-chart-1-hover)" : "var(--tc-chart-1)"} /> : null}
                <rect
                  x={pad.left + i * slot}
                  y={pad.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${fmtDay(p.day)}: ${p.value} ${unit}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                />
                {i % Math.ceil(points.length / 7) === 0 || i === points.length - 1 ? (
                  <text x={pad.left + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--tc-text-mute)" fontFamily="var(--tc-font-mono)">
                    {fmtDay(p.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {hovered && hover !== null ? (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-[10px] border border-line-strong bg-raised px-3 py-2 shadow-lg"
            style={{ left: `${((pad.left + hover * slot + slot / 2) / W) * 100}%`, top: `${(y(hovered.value) / H) * 100}%` }}
          >
            <div className="font-mono text-[15px] font-semibold text-text tabular">{hovered.value.toLocaleString("en-US")}</div>
            <div className="text-[12px] text-text-mute">
              {unit} · {fmtDay(hovered.day)}
            </div>
          </div>
        ) : null}
      </div>
      <details className="text-[13px] text-text-dim">
        <summary className="cursor-pointer text-text-mute hover:text-text">Show as table</summary>
        <table className="mt-3 w-full max-w-sm">
          <thead>
            <tr className="label text-left">
              <th className="py-1 font-normal">Day</th>
              <th className="py-1 text-right font-normal">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className="border-t border-line">
                <td className="py-1">{fmtDay(p.day)}</td>
                <td className="py-1 text-right font-mono tabular">{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
