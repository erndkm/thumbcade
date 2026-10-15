import { ANALYTICS_RANGES, type AnalyticsRange } from "@thumbcade/protocol";
import Link from "next/link";
import { cx } from "../ui";

export function RangeTabs({ current, hrefFor }: { current: AnalyticsRange; hrefFor: (r: AnalyticsRange) => string }) {
  return (
    <nav aria-label="Time range" className="inline-flex rounded-pill border border-line p-1">
      {ANALYTICS_RANGES.map((r) => (
        <Link
          key={r.id}
          href={hrefFor(r.id)}
          scroll={false}
          aria-current={r.id === current ? "page" : undefined}
          className={cx(
            "flex h-9 items-center rounded-pill px-3.5 text-[13px] font-semibold transition-colors sm:px-4",
            r.id === current ? "bg-raised text-text" : "text-text-dim hover:text-text",
          )}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}
