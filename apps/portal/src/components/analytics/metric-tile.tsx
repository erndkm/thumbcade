import type { MetricId } from "@thumbcade/protocol";
import type { ReactNode } from "react";
import type { Delta } from "@/lib/analytics-view";
import { MetricLabel } from "./metric-label";

/**
 * One headline number. Rises read in the success color; drops stay neutral (no alarms on a creator's
 * own dashboard). A missing value explains itself instead of showing a noisy percentage.
 */
export function MetricTile({
  metric,
  value,
  emptyText = "Not enough plays yet",
  sub,
  delta,
  compareLabel,
  benchmark,
}: {
  metric: MetricId;
  value: string | null;
  emptyText?: string;
  sub?: ReactNode;
  delta?: Delta;
  compareLabel?: string;
  benchmark?: number | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <MetricLabel metric={metric} />
      {value === null ? (
        <span className="pt-1.5 text-[14px] leading-6 text-text-mute">{emptyText}</span>
      ) : (
        <span className="font-mono text-[28px] leading-8 text-text tabular">{value}</span>
      )}
      {delta?.text ? (
        <span className={delta.direction === "up" ? "font-mono text-[12px] text-success" : "font-mono text-[12px] text-text-mute"}>
          {delta.text}
          {compareLabel ? <span className="text-text-mute"> {compareLabel}</span> : null}
        </span>
      ) : null}
      {sub ? <span className="text-[13px] text-text-mute">{sub}</span> : null}
      {benchmark !== null && benchmark !== undefined ? (
        <span className="text-[13px] text-text-dim">Better than {Math.round(benchmark)}% of live games</span>
      ) : null}
    </div>
  );
}
