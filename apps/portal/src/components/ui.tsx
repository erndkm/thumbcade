import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-semiwide font-bold whitespace-nowrap select-none transition-[transform,background-color,border-color,color,opacity] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-105",
  secondary: "border border-line-strong text-text hover:border-text-dim hover:bg-raised",
  ghost: "text-text-dim hover:text-text hover:bg-raised",
  danger: "bg-heat text-on-heat hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-pill",
  md: "h-11 px-5 text-[15px] rounded-pill",
  lg: "h-14 px-7 text-[17px] rounded-pill",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={cx(base, variants[variant], sizes[size], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cx(base, variants[variant], sizes[size], className)} {...props} />;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("label", className)}>{children}</span>;
}

export function Chip({ children, className, accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <span
      className={cx("inline-flex h-6 items-center rounded-chip border px-2 font-mono text-[12px] text-text-dim", className)}
      style={accent ? { borderColor: `${accent}55`, color: accent } : { borderColor: "var(--tc-line-strong)" }}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <span className="label mb-2 block">{label}</span>
      {children}
      {error ? <span className="mt-2 block text-[13px] text-heat">{error}</span> : hint ? <span className="mt-2 block text-[13px] text-text-mute">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  "w-full bg-surface border border-line text-text placeholder:text-text-mute rounded-input px-4 transition-colors focus:border-text-dim focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputBase, "h-12 text-[15px]", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputBase, "min-h-24 py-3 text-[15px] leading-6", className)} {...props} />;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span className="font-mono text-[28px] leading-8 text-text tabular">{value}</span>
      {sub ? <span className="text-[13px] text-text-mute">{sub}</span> : null}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "live" | "pending" | "failed" | "neutral" }) {
  const color = { live: "var(--tc-success)", pending: "var(--tc-warning)", failed: "var(--tc-heat)", neutral: "var(--tc-text-mute)" }[tone];
  return <span className="inline-block size-2 rounded-full" style={{ background: color, boxShadow: tone === "live" ? `0 0 0 3px color-mix(in srgb, ${color} 14%, transparent)` : undefined }} />;
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="rule-t rule-b flex flex-col items-start gap-3 py-12">
      <h3 className="font-wide text-[22px] font-extrabold tracking-tight text-text">{title}</h3>
      <p className="max-w-md text-[15px] leading-6 text-text-dim">{body}</p>
      {action}
    </div>
  );
}
