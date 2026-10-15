import { formatCount, formatPlaytime, formatRelative, type VersionCompare } from "@thumbcade/protocol";
import { rateText, returnRate } from "@/lib/analytics-view";
import { MetricLabel } from "./metric-label";

/** One row per approved version, newest first, compared by the days each was live. */
export function VersionsTable({ versions }: { versions: VersionCompare }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[620px] text-left">
        <thead>
          <tr className="align-top">
            <th className="pb-3 pr-4 font-normal">
              <span className="label">Version</span>
            </th>
            <th className="pb-3 pr-4 text-right font-normal"><MetricLabel metric="plays" className="items-end" /></th>
            <th className="pb-3 pr-4 text-right font-normal"><MetricLabel metric="avgRun" className="items-end" /></th>
            <th className="pb-3 pr-4 text-right font-normal"><MetricLabel metric="d1Return" className="items-end" /></th>
            <th className="pb-3 text-right font-normal"><MetricLabel metric="leftInstantly" className="items-end">Swiped instantly</MetricLabel></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.versionId} className="border-t border-line">
              <td className="py-3 pr-4">
                <span className="font-mono text-[15px] text-text">v{v.semver}</span>
                {v.isLive ? <span className="ml-2 rounded-[5px] bg-success/15 px-1.5 font-mono text-[11px] uppercase text-success">live</span> : null}
                <div className="font-mono text-[12px] text-text-mute">
                  {v.releasedAt ? `released ${formatRelative(v.releasedAt)}` : "not released"} · {v.days} day{v.days === 1 ? "" : "s"} live
                </div>
              </td>
              <td className="py-3 pr-4 text-right font-mono text-[15px] text-text tabular">{formatCount(v.plays)}</td>
              <td className="py-3 pr-4 text-right font-mono text-[15px] text-text tabular">{v.plays >= 20 ? formatPlaytime(v.playMs / v.plays) : "—"}</td>
              <td className="py-3 pr-4 text-right font-mono text-[15px] text-text tabular">{returnRate(v.d1) ?? "—"}</td>
              <td className="py-3 text-right font-mono text-[15px] text-text tabular">{rateText(v.leftInstantly, v.views) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[13px] text-text-mute">A dash means fewer than 20 plays or card views for that version so far.</p>
    </div>
  );
}
