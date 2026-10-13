"use client";
import { layout } from "@thumbcade/design-tokens";
import type { Challenge } from "@thumbcade/protocol";
import { PHONE, PhoneFrame } from "../phone-frame";
import type { WebCard, WebViewer } from "./types";
import { WebFeed } from "./web-feed";

const GEOMETRY = {
  width: PHONE.width,
  height: PHONE.height - layout.bottomBarHeight - PHONE.homeIndicator,
  statusTop: PHONE.statusTop,
  bottomBar: layout.bottomBarHeight + PHONE.homeIndicator,
};

/** The live feed inside a device frame (landing hero, share pages). */
export function PhoneFeed({
  cards,
  viewer,
  challenge,
  className,
  maxWidth,
}: {
  cards: WebCard[];
  viewer: WebViewer | null;
  challenge?: Challenge;
  className?: string;
  maxWidth?: number;
}) {
  return (
    <PhoneFrame className={className} maxWidth={maxWidth}>
      {cards.length > 0 ? (
        <WebFeed cards={cards} geometry={GEOMETRY} viewer={viewer} challenge={challenge} />
      ) : (
        <EmptyFeed />
      )}
    </PhoneFrame>
  );
}

function EmptyFeed() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 px-10 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark.svg" alt="" width={88} height={88} className="opacity-90" />
      <p className="font-wide text-[22px] font-extrabold leading-6 text-paper">The feed is warming up.</p>
      <p className="text-[14px] leading-5 text-paper/60">No games are live on this server yet. Run <code className="font-mono text-paper">pnpm seed</code> and refresh.</p>
    </div>
  );
}
