import { useReducedMotion } from "react-native-reanimated";
import { useSettings } from "../state/settings";

/** True when springs must be swapped for 120 ms fades (system or in-app Reduce Motion). */
export function useReduceMotion(): boolean {
  const system = useReducedMotion();
  const app = useSettings((s) => s.reduceMotion);
  return system || app;
}
