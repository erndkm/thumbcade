"use client";
import { formatCount } from "@thumbcade/protocol";
import { useEffect, useRef, useState } from "react";
import { useOdometer } from "@/lib/use-odometer";

export type CountUpStat = { label: string; value: number; prefix?: string; suffix?: string };

const STAGGER_MS = 110;
const COUNT_MS = 1200;

/**
 * A row of figures that fades in and counts up from 0 the first time it scrolls into view.
 * Screen readers and crawlers get the final values; the rolling digits are presentation only.
 */
export function CountUpStats({ stats, className = "" }: { stats: CountUpStat[]; className?: string }) {
  const ref = useRef<HTMLDListElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <dl ref={ref} className={`grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 ${className}`}>
      {stats.map((s, i) => (
        <Stat key={s.label} stat={s} active={seen} delay={i * STAGGER_MS} />
      ))}
    </dl>
  );
}

function Stat({ stat, active, delay }: { stat: CountUpStat; active: boolean; delay: number }) {
  const shown = useOdometer(stat.value, COUNT_MS, { active, delay });
  const text = (n: number) => `${stat.prefix ?? ""}${formatCount(n)}${stat.suffix ?? ""}`;
  return (
    <div
      className={`transition-[opacity,translate] duration-700 ease-out ${active ? "" : "motion-safe:translate-y-4 motion-safe:opacity-0"}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <dt className="label">{stat.label}</dt>
      <dd className="mt-1 font-mono text-[22px] text-text tabular">
        <span className="sr-only">{text(stat.value)}</span>
        <span aria-hidden>{text(Math.round(shown))}</span>
      </dd>
    </div>
  );
}
