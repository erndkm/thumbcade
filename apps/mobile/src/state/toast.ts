import { create } from "zustand";

export interface ToastMsg {
  id: number;
  text: string;
  tone: "neutral" | "good" | "bad";
}

interface ToastStore {
  current: ToastMsg | null;
  show: (text: string, tone?: ToastMsg["tone"]) => void;
  clear: () => void;
}

let n = 0;
export const useToast = create<ToastStore>((set) => ({
  current: null,
  show: (text, tone = "neutral") => set({ current: { id: ++n, text, tone } }),
  clear: () => set({ current: null }),
}));

export const toast = (text: string, tone?: ToastMsg["tone"]) => useToast.getState().show(text, tone);
