"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const PHONE = { width: 390, height: 844, bezel: 12, statusTop: 47, homeIndicator: 34 } as const;

/** A device frame that renders its content at true phone size (390×844) and scales to fit. */
export function PhoneFrame({ children, className, maxWidth = 414 }: { children: ReactNode; className?: string; maxWidth?: number }) {
  const outerW = PHONE.width + PHONE.bezel * 2;
  const outerH = PHONE.height + PHONE.bezel * 2;
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / outerW));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [outerW]);

  return (
    <div ref={box} className={className} style={{ width: "100%", maxWidth, aspectRatio: `${outerW} / ${outerH}` }}>
      <div
        className="relative origin-top-left"
        style={{
          width: outerW,
          height: outerH,
          transform: `scale(${scale})`,
          borderRadius: 64,
          padding: PHONE.bezel,
          background: "linear-gradient(160deg, #2c2c33 0%, #121216 38%, #0a0a0c 100%)",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 0 2px #050506, 0 50px 120px -20px rgba(0,0,0,0.9), 0 30px 60px -30px rgba(212,255,61,0.18)",
        }}
      >
        <div className="relative overflow-hidden bg-black" style={{ width: PHONE.width, height: PHONE.height, borderRadius: 52 }}>
          {children}
          {/* Status bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-between px-8 pt-[15px] text-[16px] font-semibold text-paper" style={{ height: PHONE.statusTop }}>
            <span className="tabular w-14">9:41</span>
            <span className="h-[34px] w-[122px] rounded-full bg-black" />
            <span className="flex w-14 items-center justify-end gap-1.5">
              <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
                <rect x="0" y="8" width="3" height="4" rx="0.8" fill="currentColor" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" fill="currentColor" />
                <rect x="10" y="3" width="3" height="9" rx="0.8" fill="currentColor" />
                <rect x="15" y="0" width="3" height="12" rx="0.8" fill="currentColor" />
              </svg>
              <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
                <rect x="0.5" y="0.5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" opacity="0.45" />
                <rect x="2.2" y="2.2" width="16" height="7.6" rx="1.8" fill="currentColor" />
                <rect x="24" y="4" width="1.6" height="4" rx="0.8" fill="currentColor" opacity="0.45" />
              </svg>
            </span>
          </div>
          {/* Home indicator */}
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-50 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-paper/80" />
        </div>
      </div>
    </div>
  );
}
