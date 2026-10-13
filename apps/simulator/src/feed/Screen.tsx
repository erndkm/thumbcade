import { useRef } from "react";
import { gestureConfigFor } from "@thumbcade/swipe-contract";
import { DEV_INDEX, type Simulator, type SimSnapshot } from "../lib/sim.ts";
import { Icon } from "../ui/Icon.tsx";
import { BottomBar } from "./BottomBar.tsx";
import { DevCard } from "./DevCard.tsx";
import { NeighborCard, NEIGHBORS } from "./NeighborCard.tsx";
import { useMountSim } from "./Phone.tsx";
import { Sheet } from "./Sheet.tsx";

export function Screen({ sim, snap }: { sim: Simulator; snap: SimSnapshot }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useMountSim(sim, { iframe: iframeRef, screen: screenRef, track: trackRef });

  const { device, index } = snap;
  const vp = sim.viewport;
  const currentPhase = index === DEV_INDEX ? snap.card.phase : "PREVIEW";
  const cfg = gestureConfigFor(currentPhase, sim.controls);
  const neighbors = [index - 1, index, index + 1].filter((i) => i >= 0 && i !== DEV_INDEX);

  return (
    <div ref={screenRef} className="screen" style={{ width: device.width, height: device.height, borderRadius: device.cornerRadius }} onWheel={(e) => sim.onChromeWheel(e.deltaY)}>
      <div className="feed" style={{ height: vp.height }}>
        <div ref={trackRef} className="feed__track">
          <DevCard sim={sim} snap={snap} iframeRef={iframeRef} top={DEV_INDEX * vp.height} />
          {neighbors.map((i) => (
            <NeighborCard key={i} sim={sim} snap={snap} index={i} neighbor={NEIGHBORS[i % NEIGHBORS.length]!} top={i * vp.height} active={i === index} />
          ))}
        </div>
      </div>
      <div className={`toptabs ${cfg.overlay === "hidden" ? "is-receded" : ""}`} style={{ top: device.statusBar }} aria-hidden="true">
        <span className="toptabs__tab">Following</span>
        <span className="toptabs__tab is-active">For You</span>
        <span className="toptabs__search">
          <Icon name="search" size={22} />
        </span>
      </div>
      <StatusBar platform={device.platform} height={device.statusBar} />
      <BottomBar sim={sim} snap={snap} mode={cfg.bottomBar} />
      {snap.sheet ? <Sheet sim={sim} kind={snap.sheet} score={snap.result?.score ?? null} /> : null}
      <span className="home-indicator" style={{ bottom: Math.max(6, device.homeIndicator / 2 - 3) }} />
    </div>
  );
}

function StatusBar({ platform, height }: { platform: "ios" | "android"; height: number }) {
  return (
    <div className={`statusbar statusbar--${platform}`} style={{ height }} aria-hidden="true">
      <span className="statusbar__time">9:41</span>
      {platform === "ios" ? <span className="statusbar__island" /> : <span className="statusbar__camera" />}
      <span className="statusbar__right">
        <svg width="18" height="11" viewBox="0 0 18 11">
          <rect x="0" y="7" width="3" height="4" rx="0.6" fill="currentColor" />
          <rect x="5" y="5" width="3" height="6" rx="0.6" fill="currentColor" />
          <rect x="10" y="2.5" width="3" height="8.5" rx="0.6" fill="currentColor" />
          <rect x="15" y="0" width="3" height="11" rx="0.6" fill="currentColor" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.5" />
          <rect x="2.5" y="2.5" width="16" height="7" rx="1.5" fill="currentColor" />
          <rect x="23.5" y="4" width="1.8" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
        </svg>
      </span>
    </div>
  );
}
