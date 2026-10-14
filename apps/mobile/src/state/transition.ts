import { create } from "zustand";

/** Source rect of the cartridge for the cartridge -> game page shared-element transition. */
export interface IconTransition {
  slug: string;
  x: number;
  y: number;
  size: number;
  iconUrl: string | null;
  accent: string;
  at: number;
}

export const useIconTransition = create<{ t: IconTransition | null; set: (t: IconTransition | null) => void }>((set) => ({
  t: null,
  set: (t) => set({ t }),
}));
