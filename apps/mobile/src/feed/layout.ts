import { layout } from "@thumbcade/design-tokens";
import type { Insets } from "@thumbcade/protocol";

export interface FeedLayout {
  /** Card viewport height: top of the screen to the top of the bottom bar. */
  cardHeight: number;
  width: number;
  safeTop: number;
  safeBottom: number;
}

/**
 * Inset sets reported to games (CSS px = pt), relative to the game viewport.
 * PREVIEW: top tabs, the right action rail and the bottom-left caption are covered.
 * PLAYING: only the status bar (the Dock lives below the viewport).
 */
export function insetsFor(l: Pick<FeedLayout, "safeTop">): { preview: Insets; play: Insets } {
  return {
    preview: {
      top: Math.round(l.safeTop + layout.topBarHeight),
      right: layout.actionRailWidth,
      bottom: layout.captionHeight,
      left: 0,
    },
    play: { top: Math.round(l.safeTop), right: 0, bottom: 0, left: 0 },
  };
}

export function bottomBarHeight(safeBottom: number): number {
  return layout.bottomBarHeight + safeBottom;
}

let current: FeedLayout = { cardHeight: 0, width: 0, safeTop: 0, safeBottom: 0 };
export function setFeedLayout(l: FeedLayout): void {
  current = l;
}
export function getFeedLayout(): FeedLayout {
  return current;
}
