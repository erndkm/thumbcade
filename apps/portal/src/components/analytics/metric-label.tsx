"use client";
import { METRIC_DEFINITIONS, type MetricId } from "@thumbcade/protocol";
import { useId, useState, type ReactNode } from "react";
import { cx } from "../ui";

/**
 * A metric's name with an info control. The definition (the same sentence as /docs/analytics) opens inline
 * under the label, so it never overflows a narrow screen.
 */
export function MetricLabel({ metric, children, className }: { metric: MetricId; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const def = METRIC_DEFINITIONS[metric];
  return (
    <span className={cx("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-2">
        <span className="label">{children ?? def.label}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`What ${def.label.toLowerCase()} means`}
          onClick={() => setOpen((o) => !o)}
          className={cx(
            "relative inline-flex size-[16px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px] leading-none transition-colors",
            "before:absolute before:-inset-3.5 before:content-['']",
            open ? "border-text-dim text-text" : "border-line-strong text-text-mute hover:border-text-dim hover:text-text",
          )}
        >
          i
        </button>
      </span>
      <span id={id} hidden={!open} className="max-w-[34ch] text-[13px] leading-5 text-text-dim">
        {def.definition}
      </span>
    </span>
  );
}
