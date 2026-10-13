import { safeAccent } from "@thumbcade/protocol";
import { feedInsets } from "@thumbcade/sdk/host";
import { useEffect, useState } from "react";
import type { Simulator, SimSnapshot } from "../lib/sim.ts";
import { DEV_INDEX } from "../lib/sim.ts";
import { Icon } from "../ui/Icon.tsx";
import { Overlay } from "./Overlay.tsx";
import { ResultCard } from "./ResultCard.tsx";

/** The card that hosts the game being developed: iframe + poster + overlay + result card + states. */
export function DevCard({ sim, snap, iframeRef, top }: { sim: Simulator; snap: SimSnapshot; iframeRef: React.RefObject<HTMLIFrameElement | null>; top: number }) {
  const vp = sim.viewport;
  const m = sim.manifest;
  const phase = snap.card.phase;
  const effective = phase === "OFFSCREEN" ? snap.card.resumeTo : phase;
  const accent = safeAccent(m?.accentColor ?? "#D4FF3D");
  const live = snap.card.ready;
  const [wiped, setWiped] = useState(false);
  useEffect(() => {
    if (!live) {
      setWiped(false);
      return;
    }
    const t = window.setTimeout(() => setWiped(true), 420);
    return () => window.clearTimeout(t);
  }, [live, snap.reloadKey]);

  const insets = feedInsets(snap.device.statusBar, effective === "PLAYING" ? "play" : "preview");
  const shown = insets[insets.current];
  const best = snap.result?.best ?? null;
  const meta = `${snap.card.runs} ${snap.card.runs === 1 ? "run" : "runs"} here${best !== null ? ` · best ${best.toLocaleString("en-US")}` : ""}`;

  return (
    <div className="card" style={{ top, height: vp.height, "--accent": accent } as React.CSSProperties} data-phase={effective}>
      <iframe ref={iframeRef} className="card__game" title={m?.name ?? "Game"} allow="autoplay; fullscreen" style={{ width: vp.width, height: vp.height }} />
      {!wiped ? (
        <div className={`poster ${live ? "is-live" : ""}`} aria-hidden="true">
          {sim.game.source.posterUrl ? (
            <img className="poster__img" src={sim.game.source.posterUrl} alt="" />
          ) : (
            <div className="poster__gen">
              {sim.game.source.iconUrl ? <img src={sim.game.source.iconUrl} alt="" className="poster__icon" /> : null}
              <span className="poster__name">{m?.name ?? sim.game.source.name}</span>
            </div>
          )}
          {!live ? <span className="poster__shimmer" /> : <span className="poster__scanline" />}
        </div>
      ) : null}
      {snap.showInsets ? (
        <div className="insets" aria-hidden="true">
          <span className="insets__box" style={{ left: 0, top: 0, width: vp.width, height: shown.top }} />
          {shown.right ? <span className="insets__box" style={{ right: 0, top: shown.top, width: shown.right, height: vp.height - shown.top - shown.bottom }} /> : null}
          {shown.bottom ? <span className="insets__box" style={{ left: 0, bottom: 0, width: vp.width, height: shown.bottom }} /> : null}
          <span className="insets__label tc-mono-label" style={{ top: shown.top + 8, right: shown.right + 8 }}>
            insets.{insets.current}
          </span>
        </div>
      ) : null}
      <Overlay
        hidden={effective === "PLAYING"}
        data={{
          handle: "you",
          dev: true,
          name: m?.name ?? sim.game.source.name,
          description: m?.description ?? "Add a description to thumbcade.json.",
          tags: m?.tags ?? [],
          accent: m?.accentColor ?? "#D4FF3D",
          iconUrl: sim.game.source.iconUrl,
          meta,
          counts: { likes: 0, comments: 0, saves: 0, shares: 0 },
        }}
        actions={{
          liked: snap.liked,
          saved: snap.saved,
          following: snap.following,
          onLike: () => sim.toggle("liked"),
          onSave: () => sim.toggle("saved"),
          onFollow: () => sim.toggle("following"),
          onComment: () => sim.openSheet("comments"),
          onShare: () => sim.openSheet("share"),
          onPointerDown: (e) => sim.onChromePointerDown(e, "chrome"),
          suppressClick: () => sim.shouldSuppressClick(),
        }}
      />
      {effective === "ENDED" && snap.result && snap.index === DEV_INDEX ? <ResultCard sim={sim} result={snap.result} manifest={m} top={snap.device.statusBar + 44} /> : null}
      {effective === "PAUSED" ? (
        <div className="paused" onPointerDown={(e) => sim.onChromePointerDown(e, "chrome")} onClick={() => !sim.shouldSuppressClick() && sim.resume()}>
          <button className="pill pill--resume" disabled={snap.card.suspended.length > 0}>
            <Icon name="play" size={18} active />
            <span>{snap.card.suspended.includes("background") ? "Paused in the background" : "Tap to resume"}</span>
          </button>
        </div>
      ) : null}
      {effective === "FAILED" ? (
        <div className="failed" onPointerDown={(e) => sim.onChromePointerDown(e, "chrome")}>
          <p className="tc-title">That game tripped over a cable.</p>
          <p className="failed__body">ready() didn't arrive within 8 s.</p>
          <button className="btn btn--primary" onClick={() => !sim.shouldSuppressClick() && sim.retry()}>
            <Icon name="replay" size={18} />
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
