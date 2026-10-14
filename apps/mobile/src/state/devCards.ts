import { create } from "zustand";
import type { FeedCard } from "@thumbcade/protocol";

/** Games opened from the developer menu (LAN URL / QR). Shown first in the feed with a DEV badge. */
export const useDevCards = create<{ cards: FeedCard[]; add: (card: FeedCard) => void; clear: () => void }>((set, get) => ({
  cards: [],
  add: (card) => set({ cards: [card, ...get().cards.filter((c) => c.cardId !== card.cardId)].slice(0, 3) }),
  clear: () => set({ cards: [] }),
}));
