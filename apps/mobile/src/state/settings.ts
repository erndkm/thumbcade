import { create } from "zustand";
import { kv } from "../lib/kv";

export interface Settings {
  /** Global sound. Games start muted in PREVIEW unless the user has unmuted globally. */
  soundOn: boolean;
  /** In-app Reduce Motion (on top of the system setting). */
  reduceMotion: boolean;
  /** Onboarding (age + interests) finished on this install. */
  onboarded: boolean;
  /** Dock coach count for guests (members persist it in profiles.dock_coach_shown). */
  dockCoachShown: number;
  /** Hidden developer menu unlocked (tap version 7x). */
  devMenu: boolean;
  /** Push notifications opt-in. */
  notifications: boolean;
  /** Feed tab last used. */
  lastTab: "foryou" | "following";
}

const KEY = "tc.settings.v1";
const defaults: Settings = {
  soundOn: false,
  reduceMotion: false,
  onboarded: false,
  dockCoachShown: 0,
  devMenu: false,
  notifications: true,
  lastTab: "foryou",
};

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...defaults,
  ...kv.getJSON<Partial<Settings>>(KEY, {}),
  set: (patch) => {
    set(patch);
    const { set: _omit, ...rest } = { ...get(), ...patch };
    kv.setJSON(KEY, rest);
  },
}));
