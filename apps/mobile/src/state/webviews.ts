import { create } from "zustand";

/**
 * WebView budget: only one pager (the focused one) mounts game WebViews, so the app never holds
 * more than three, even with a scoped feed pushed over the home feed.
 */
export const useWebViewOwner = create<{ owner: string | null; claim: (id: string) => void; release: (id: string) => void }>((set, get) => ({
  owner: null,
  claim: (id) => set({ owner: id }),
  release: (id) => {
    if (get().owner === id) set({ owner: null });
  },
}));

/** A hidden WebView warmed at app start (Android WebView cold init is slow). Dropped once a feed owns the budget. */
export const useWarmWebView = create<{ warm: boolean; done: () => void }>((set) => ({ warm: true, done: () => set({ warm: false }) }));
