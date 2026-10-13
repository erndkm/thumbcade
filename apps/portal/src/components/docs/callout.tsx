import type { ReactNode } from "react";

export function Callout({ children, tone = "note" }: { children: ReactNode; tone?: "note" | "rule" | "warn" }) {
  const color = tone === "rule" ? "var(--tc-accent)" : tone === "warn" ? "var(--tc-heat)" : "var(--tc-line-strong)";
  const label = tone === "rule" ? "Rule" : tone === "warn" ? "Watch out" : "Note";
  return (
    <div className="my-6 rounded-[14px] border bg-surface px-5 py-4 text-[15px] text-text" style={{ borderColor: color }}>
      <span className="label mb-1.5 block" style={{ color }}>
        {label}
      </span>
      {children}
    </div>
  );
}
