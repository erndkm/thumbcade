"use client";
import { formatCount } from "@thumbcade/protocol";
import { useState } from "react";

export interface DailyPoint {
  day: string; // YYYY-MM-DD
  value: number;
  /** Stacked parts, bottom first; they add up to `value`. */
  parts?: number[];
}

export interface ChartMarker {
  day: string;
  label: string;
  kind: "milestone" | "version";
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Bottom part grey, top part the accent: the top part is what the title is about. */
const PART_FILL = ["var(--tc-chart-2)", "var(--tc-chart-1)"];
const PART_HOVER = ["var(--tc-chart-2-hover)", "var(--tc-chart-1-hover)"];

function column(x: number, w: number, bottom: number, top: number, round: boolean): string {
  const h = bottom - top;
  if (h <= 0) return "";
  const r = round ? Math.min(4, h / 2, w / 2) : 0;
  return `M${x} ${bottom} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + w - r} Q${x + w} ${top} ${x + w} ${top + r} V${bottom} Z`;
}

function Diamond({ x, y, kind }: { x: number; y: number; kind: ChartMarker["kind"] }) {
  const d = `M${x} ${y - 4.5} L${x + 4.5} ${y} L${x} ${y + 4.5} L${x - 4.5} ${y} Z`;
  return kind === "milestone" ? <path d={d} fill="var(--tc-text)" /> : <path d={d} fill="none" stroke="var(--tc-text-dim)" strokeWidth={1.25} />;
}

/**
 * Daily column chart. One series by default; with `parts` the columns stack (bottom grey, top accent) and
 * `partLabels` names them in a legend. `markers` put a diamond over the days something happened (a filled
 * one for milestones, a hollow one for releases). Columns ≤ 24 px, 4 px rounded data end, square baseline,
 * hairline grid, per-column hover/focus tooltip, and a table view.
 */
export function DailyChart({
  title,
  points,
  unit,
  partLabels,
  markers = [],
}: {
  title: string;
  points: DailyPoint[];
  unit: string;
  partLabels?: string[];
  markers?: ChartMarker[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { top: markers.length ? 28 : 16, right: 8, bottom: 28, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ticks = [0, max / 2, max];
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.min(24, slot - 2);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const total = points.reduce((a, p) => a + p.value, 0);
  const hovered = hover !== null ? points[hover] : null;
  const markersOn = (day: string) => markers.filter((m) => m.day === day);
  const stacked = !!partLabels && points.some((p) => p.parts);

  return (
    <figure className="flex flex-col gap-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-semiwide text-[16px] font-bold text-text">{title}</span>
        <span className="font-mono text-[13px] text-text-mute">
          {formatCount(total)} {unit} · {points.length} days
        </span>
      </figcaption>
      {stacked || markers.length ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-text-dim">
          {stacked
            ? [...partLabels!].reverse().map((l, ri) => {
                const i = partLabels!.length - 1 - ri;
                return (
                  <span key={l} className="flex items-center gap-2">
                    <span className="inline-block size-2.5 rounded-[2px]" style={{ background: PART_FILL[i] }} />
                    {l}
                  </span>
                );
              })
            : null}
          {markers.some((m) => m.kind === "milestone") ? (
            <span className="flex items-center gap-2">
              <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden>
                <Diamond x={0} y={0} kind="milestone" />
              </svg>
              Milestone
            </span>
          ) : null}
          {markers.some((m) => m.kind === "version") ? (
            <span className="flex items-center gap-2">
              <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden>
                <Diamond x={0} y={0} kind="version" />
              </svg>
              New version
            </span>
          ) : null}
        </div>
      ) : null}
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
            const baseline = pad.top + innerH;
            const parts = stacked ? (p.parts ?? [p.value]) : [p.value];
            const topIndex = parts.reduce((last, v, k) => (v > 0 ? k : last), -1);
            let acc = 0;
            const segments = parts.map((v, k) => {
              const bottom = y(acc) - (k > 0 && acc > 0 ? 1 : 0);
              acc += v;
              const top = y(acc);
              const path = column(x, barW, bottom, top, k === topIndex);
              const fill = stacked ? (hover === i ? PART_HOVER[k] : PART_FILL[k]) : hover === i ? "var(--tc-chart-1-hover)" : "var(--tc-chart-1)";
              return path ? <path key={k} d={path} fill={fill} /> : null;
            });
            const dayMarkers = markersOn(p.day);
            return (
              <g key={p.day}>
                {segments}
                {dayMarkers.length ? <Diamond x={pad.left + i * slot + slot / 2} y={12} kind={dayMarkers.some((m) => m.kind === "milestone") ? "milestone" : "version"} /> : null}
                <rect
                  x={pad.left + i * slot}
                  y={0}
                  width={slot}
                  height={baseline}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${fmtDay(p.day)}: ${p.value} ${unit}${dayMarkers.length ? `, ${dayMarkers.map((m) => m.label).join(", ")}` : ""}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                />
                {(() => {
                  const every = Math.ceil(points.length / 7);
                  const last = points.length - 1;
                  return i === last || (i % every === 0 && last - i >= every);
                })() ? (
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
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[10px] border border-line-strong bg-raised px-3 py-2 shadow-lg"
            style={{
              left: `${Math.min(88, Math.max(12, ((pad.left + hover * slot + slot / 2) / W) * 100))}%`,
              top: `${(y(hovered.value) / H) * 100}%`,
            }}
          >
            <div className="font-mono text-[15px] font-semibold text-text tabular">{hovered.value.toLocaleString("en-US")}</div>
            <div className="text-[12px] text-text-mute">
              {unit} · {fmtDay(hovered.day)}
            </div>
            {stacked && hovered.parts
              ? hovered.parts.map((v, k) => (
                  <div key={k} className="mt-0.5 flex items-center gap-2 text-[12px] text-text-dim">
                    <span className="inline-block size-2 rounded-[2px]" style={{ background: PART_FILL[k] }} />
                    {partLabels![k]} {v.toLocaleString("en-US")}
                  </div>
                ))
              : null}
            {markersOn(hovered.day).map((m) => (
              <div key={m.label} className="mt-1 whitespace-nowrap text-[12px] text-text">
                {m.label}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <details className="text-[13px] text-text-dim">
        <summary className="cursor-pointer text-text-mute hover:text-text">Show as table</summary>
        <table className="mt-3 w-full max-w-md">
          <thead>
            <tr className="label text-left">
              <th className="py-1 font-normal">Day</th>
              {stacked ? partLabels!.map((l) => <th key={l} className="py-1 text-right font-normal">{l}</th>) : null}
              <th className="py-1 text-right font-normal">{unit}</th>
              {markers.length ? <th className="py-1 pl-4 text-left font-normal">Note</th> : null}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className="border-t border-line">
                <td className="py-1">{fmtDay(p.day)}</td>
                {stacked ? partLabels!.map((l, k) => <td key={l} className="py-1 text-right font-mono tabular">{p.parts?.[k] ?? 0}</td>) : null}
                <td className="py-1 text-right font-mono tabular">{p.value}</td>
                {markers.length ? <td className="py-1 pl-4">{markersOn(p.day).map((m) => m.label).join(", ")}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
