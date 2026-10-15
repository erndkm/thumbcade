/** 28-day trend, no axes: the shape is the point. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const W = 96;
  const H = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className="block overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--tc-text-dim)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
