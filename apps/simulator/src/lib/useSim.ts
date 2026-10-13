import { useSyncExternalStore } from "react";
import type { Simulator, SimSnapshot } from "./sim.ts";

export function useSim(sim: Simulator): SimSnapshot {
  return useSyncExternalStore(sim.subscribe, sim.getSnapshot, sim.getSnapshot);
}
