import type { CardPhase, ContractEvent } from "@thumbcade/swipe-contract";
import type { WebCard } from "@/lib/data";

export type { WebCard };

export interface WebViewer {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CardApi {
  dispatch: (event: ContractEvent) => void;
  /** Forward a tap into the game (feed-owned capture layer, §5.6 fallback). Coordinates in game CSS px. */
  inject: (x: number, y: number) => void;
  phase: () => CardPhase;
}

export interface FeedGeometry {
  width: number;
  /** Height of the game viewport (screen minus the bottom bar). */
  height: number;
  /** Status bar / safe-area top inset inside the viewport. */
  statusTop: number;
  /** Bottom bar height including the home-indicator area. */
  bottomBar: number;
}
