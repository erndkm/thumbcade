"use client";
import { useEffect, useState } from "react";

type OdometerOptions = {
  /** Holds at 0 until true, so the roll can wait for a trigger such as scrolling into view. */
  active?: boolean;
  /** Extra wait in ms after `active` turns true, for staggering several counters. */
  delay?: number;
};

/** Rolls a number up to `target` like an odometer (eased). Jumps straight there with Reduce Motion. */
export function useOdometer(target: number, ms = 700, { active = true, delay = 0 }: OdometerOptions = {}) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    if (!active) return;
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / ms));
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, active, delay]);
  return value;
}
