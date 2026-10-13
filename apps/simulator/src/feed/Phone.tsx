import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Simulator, SimSnapshot } from "../lib/sim.ts";
import { Screen } from "./Screen.tsx";

const BEZEL = 12;

/** The device frame. Scales to fit the stage; inside, everything is in device points. */
export function Phone({ sim, snap }: { sim: Simulator; snap: SimSnapshot }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const { device } = snap;
  const outerW = device.width + BEZEL * 2;
  const outerH = device.height + BEZEL * 2;

  useLayoutEffect(() => {
    const stage = wrapRef.current?.parentElement;
    if (!stage) return;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const availH = r.height - 72;
      const availW = r.width - 48;
      setScale(Math.max(0.4, Math.min(1, availH / outerH, availW / outerW)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [outerH, outerW]);

  return (
    <div ref={wrapRef} className="phone-wrap" style={{ width: outerW * scale, height: outerH * scale }}>
      <div className={`phone phone--${device.platform}`} style={{ width: outerW, height: outerH, transform: `scale(${scale})`, borderRadius: device.cornerRadius + BEZEL }}>
        <span className="phone__button phone__button--a" />
        <span className="phone__button phone__button--b" />
        <span className="phone__button phone__button--c" />
        <Screen sim={sim} snap={snap} />
      </div>
    </div>
  );
}

/** Mounts the simulator controller once the DOM it drives exists. */
export function useMountSim(sim: Simulator, refs: { iframe: React.RefObject<HTMLIFrameElement | null>; screen: React.RefObject<HTMLDivElement | null>; track: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const iframe = refs.iframe.current;
    const screen = refs.screen.current;
    const track = refs.track.current;
    if (!iframe || !screen || !track) return;
    sim.mount({ iframe, screen, track });
    return () => sim.unmount();
  }, [sim, refs.iframe, refs.screen, refs.track]);
}
