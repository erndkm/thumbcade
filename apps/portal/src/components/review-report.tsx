import { ReviewReportSchema, type ReviewCheck } from "@thumbcade/protocol";
import { Icon } from "./icon";
import { StatusDot } from "./ui";

const fmtValue = (c: ReviewCheck) => {
  if (c.value === undefined) return null;
  const unit = /bytes|size|heap|payload/i.test(c.id) ? "bytes" : /fps/.test(c.id) ? "fps" : "ms";
  const f = (n: number) => (unit === "bytes" ? `${(n / 1024 / 1024).toFixed(2)} MB` : unit === "fps" ? `${Math.round(n)} fps` : `${Math.round(n)} ms`);
  return c.budget !== undefined ? `${f(c.value)} / ${f(c.budget)}` : f(c.value);
};

/** Renders a reviewer report (shared by the creator version page and the admin review page). */
export function ReviewReportView({ report, status }: { report: unknown; status: string }) {
  const parsed = ReviewReportSchema.safeParse(report);
  if (!parsed.success) {
    return (
      <div className="rule-t rule-b flex items-center gap-3 py-6 text-[15px] text-text-dim">
        <StatusDot tone="pending" />
        {status === "auto_checking" || status === "uploaded" ? "Automated checks are running. This page updates when they finish." : "No automated report for this version."}
      </div>
    );
  }
  const r = parsed.data;
  const failed = r.checks.filter((c) => c.status === "fail");
  const warned = r.checks.filter((c) => c.status === "warn");
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-line py-5">
        <span className="flex items-center gap-2 font-semiwide text-[17px] font-bold" style={{ color: r.passed ? "var(--tc-success)" : "var(--tc-heat)" }}>
          <Icon name={r.passed ? "check" : "close"} size={20} />
          {r.passed ? "Automated checks passed" : `${failed.length} check${failed.length === 1 ? "" : "s"} failed`}
        </span>
        {warned.length ? <span className="font-mono text-[12px] text-warning">{warned.length} warning{warned.length === 1 ? "" : "s"}</span> : null}
        <span className="font-mono text-[12px] text-text-mute">
          reviewer {r.reviewerVersion} · {new Date(r.finishedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Ready", r.metrics.readyMs !== null ? `${Math.round(r.metrics.readyMs)} ms` : "—"],
          ["Initial gz", r.metrics.initialPayloadGzipBytes !== null ? `${(r.metrics.initialPayloadGzipBytes / 1024).toFixed(0)} KB` : "—"],
          ["Total", r.metrics.totalBytes !== null ? `${(r.metrics.totalBytes / 1024).toFixed(0)} KB` : "—"],
          ["FPS", r.metrics.fps !== null ? `${Math.round(r.metrics.fps)}` : "—"],
          ["Longest task", r.metrics.longestTaskMs !== null ? `${Math.round(r.metrics.longestTaskMs)} ms` : "—"],
          ["Heap", r.metrics.heapBytes !== null ? `${(r.metrics.heapBytes / 1024 / 1024).toFixed(0)} MB` : "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="label">{k}</div>
            <div className="mt-1 font-mono text-[22px] text-text tabular">{v}</div>
          </div>
        ))}
      </div>

      <ul className="rule-t">
        {r.checks.map((c) => (
          <li key={c.id} className="rule-b grid grid-cols-[20px_1fr_auto] items-start gap-4 py-3.5">
            <span className="mt-0.5" style={{ color: c.status === "pass" ? "var(--tc-success)" : c.status === "fail" ? "var(--tc-heat)" : c.status === "warn" ? "var(--tc-warning)" : "var(--tc-text-mute)" }}>
              <Icon name={c.status === "pass" ? "check" : c.status === "fail" ? "close" : c.status === "warn" ? "flag" : "more"} size={18} />
            </span>
            <span>
              <span className="block text-[15px] text-text">{c.label}</span>
              {c.detail ? <span className="mt-0.5 block text-[13px] leading-5 text-text-mute">{c.detail}</span> : null}
            </span>
            <span className="font-mono text-[12px] text-text-dim tabular">{fmtValue(c)}</span>
          </li>
        ))}
      </ul>

      {r.screenshots.length ? (
        <div className="flex flex-col gap-3">
          <span className="label">Screenshots</span>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {r.screenshots.map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={s} src={s} alt="" className="h-[360px] w-auto rounded-[18px] border border-line" />
            ))}
          </div>
        </div>
      ) : null}

      {r.console.length ? (
        <details className="rounded-[14px] border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[14px] text-text-dim">Console ({r.console.length})</summary>
          <pre className="max-h-80 overflow-auto border-t border-line px-4 py-3 font-mono text-[12px] leading-5 text-text-dim">
            {r.console.map((l) => `[${l.level}] ${l.text}`).join("\n")}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
