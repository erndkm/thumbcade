import type { ReactNode } from "react";
import { create } from "zustand";

export interface SheetSpec {
  key: string;
  /** Height as a fraction of the window (0-1). */
  snap?: number;
  /** Shift the sheet above the keyboard. */
  keyboard?: boolean;
  render: (close: () => void) => ReactNode;
  onClose?: () => void;
  accessibilityLabel?: string;
}

interface SheetStore {
  stack: (SheetSpec & { closing?: boolean })[];
  open: (spec: SheetSpec) => void;
  /** Starts the close animation; the host removes the sheet when it finishes. */
  close: (key?: string) => void;
  remove: (key: string) => void;
}

export const useSheets = create<SheetStore>((set, get) => ({
  stack: [],
  open: (spec) => set({ stack: [...get().stack.filter((s) => s.key !== spec.key), spec] }),
  close: (key) => {
    const stack = get().stack;
    const target = key ?? stack[stack.length - 1]?.key;
    if (!target) return;
    set({ stack: stack.map((s) => (s.key === target ? { ...s, closing: true } : s)) });
  },
  remove: (key) => {
    const spec = get().stack.find((s) => s.key === key);
    set({ stack: get().stack.filter((s) => s.key !== key) });
    spec?.onClose?.();
  },
}));

export const openSheet = (spec: SheetSpec) => useSheets.getState().open(spec);
export const closeSheet = (key?: string) => useSheets.getState().close(key);
