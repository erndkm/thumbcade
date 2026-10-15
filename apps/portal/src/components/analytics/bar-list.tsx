import { formatCount, type MetricId } from "@thumbcade/protocol";
import type { ReactNode } from "react";
import { formatPct } from "@/lib/analytics-view";
import { MetricLabel } from "./metric-label";

export interface BarListRow {
  key: string;
  metric?: MetricId;
  label: string;
  count: number;
  /** 0..1, sets the bar length. */
  share: number;
  /** Printed beside the count, e.g. "62% kept". */
  note?: ReactNode;
}

/**
 * Horizontal bars measured from zero. One quiet grey for every row unless a row is the point (`emphasis`).
 */
export function BarList({ rows, emphasis, unit }: { rows: BarListRow[]; emphasis?: string; unit?: string }) {
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-2">
          {r.metric ? <MetricLabel metric={r.metric}>{r.label}</MetricLabel> : <span className="label">{r.label}</span>}
          <span className="text-right font-mono text-[13px] text-text tabular">
            {formatCount(r.count)}
            {unit ? ` ${unit}` : ""} <span className="text-text-mute">· {formatPct(r.share)}</span>
            {r.note ? <span className="block text-[12px] text-text-mute">{r.note}</span> : null}
          </span>
          <span className="col-span-2 block h-2 overflow-hidden rounded-[2px] bg-raised" aria-hidden>
            <span
              className="block h-full rounded-[2px]"
              style={{ width: `${Math.max(r.share > 0 ? 1 : 0, Math.min(100, r.share * 100))}%`, background: r.key === emphasis ? "var(--tc-chart-1)" : "var(--tc-chart-2)" }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
