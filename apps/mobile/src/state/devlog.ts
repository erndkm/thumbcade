import { create } from "zustand";

/** Contract violations and developer notes surfaced in the developer menu. */
export const useDevLog = create<{ lines: string[]; push: (line: string) => void; clear: () => void }>((set, get) => ({
  lines: [],
  push: (line) => set({ lines: [...get().lines, `${new Date().toLocaleTimeString()}  ${line}`].slice(-200) }),
  clear: () => set({ lines: [] }),
}));
