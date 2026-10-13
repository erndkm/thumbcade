"use client";
import { layout } from "@thumbcade/design-tokens";
import type { Challenge } from "@thumbcade/protocol";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../icon";
import type { FeedGeometry, WebCard, WebViewer } from "./types";
import { WebFeed } from "./web-feed";

/** The feed filling the browser window: full-bleed on phones, a phone-shaped column on desktop. */
export function FullscreenFeed({ cards, viewer, challenge }: { cards: WebCard[]; viewer: WebViewer | null; challenge?: Challenge }) {
  const [geo, setGeo] = useState<FeedGeometry | null>(null);
  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const phoneLike = vw < 640;
      const width = phoneLike ? vw : Math.min(Math.round(vh * 0.4615), 460);
      const safeBottom = phoneLike ? Number(getComputedStyle(document.documentElement).getPropertyValue("--sab").replace("px", "")) || 0 : 0;
      const bottomBar = layout.bottomBarHeight + safeBottom;
      setGeo({ width, height: vh - bottomBar, statusTop: phoneLike ? 12 : 8, bottomBar });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const backdrop = cards[0]?.posterUrl;
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black [--sab:env(safe-area-inset-bottom)]">
      {backdrop ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backdrop} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-3xl" />
      ) : null}
      <Link href="/" className="absolute left-6 top-5 z-10 hidden items-center gap-2 text-[14px] text-paper/70 transition-colors hover:text-paper sm:flex">
        <Icon name="back" size={18} /> thumbcade.com
      </Link>
      <div className="absolute bottom-6 left-6 z-10 hidden flex-col gap-1 sm:flex">
        <span className="label">Keys</span>
        <span className="font-mono text-[12px] text-paper/60">↑ ↓ next / previous · M mute</span>
      </div>
      {geo && cards.length > 0 ? (
        <WebFeed cards={cards} geometry={geo} viewer={viewer} challenge={challenge} wheel className="sm:rounded-[28px] sm:shadow-[0_40px_120px_rgba(0,0,0,0.8)]" />
      ) : null}
      {cards.length === 0 ? (
        <div className="relative z-10 flex max-w-sm flex-col items-center gap-4 px-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.svg" alt="" width={96} height={96} />
          <p className="font-wide text-[24px] font-extrabold text-paper">The feed is warming up.</p>
          <p className="text-[15px] text-paper/60">No games are live yet. Check back in a minute.</p>
        </div>
      ) : null}
    </div>
  );
}
