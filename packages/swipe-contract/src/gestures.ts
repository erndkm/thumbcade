import type { CardPhase, CardState, ContractControls } from "./machine.ts";

/**
 * Gesture ownership (§5.2) and thresholds (§5.4).
 *
 * The feed never delays a tap: the game receives every touch immediately, and the feed claims a
 * gesture retroactively once it passes the activation criteria below. At that moment the shell
 * dispatches FEED_GESTURE_BEGIN, which makes the machine send `input.cancel` and `pause`.
 */

export const THRESHOLDS = {
  /** Single-finger surface pan outside PLAYING. */
  idleActivation: 10,
  idleRatio: 1.2,
  /** Single-finger surface pan while PLAYING a game with controls.vertical = false. */
  playingActivation: 24,
  playingRatio: 2,
  /** Pan that starts on the Dock / bottom bar. */
  dockActivation: 6,
  /** Two-finger pan while PLAYING (escape hatch). */
  twoFingerActivation: 16,
  twoFingerRatio: 1.2,
  /** Release: commit when displacement passes this fraction of the card height... */
  commitDistanceRatio: 0.2,
  /** ...or when the fling velocity (pt/s) in the same direction passes this. */
  commitVelocity: 700,
} as const;

/** Snap spring (Reanimated `withSpring` config). Stiff and decisive; tune by feel on device. */
export const SNAP_SPRING = { damping: 26, stiffness: 260, mass: 1, overshootClamping: false } as const;

/** Number of times the Dock coach animation plays for vertical-claiming games. */
export const DOCK_COACH_MAX_SHOWS = 3;

export interface PanRule {
  enabled: boolean;
  /** Minimum |dy| in points before the feed claims the gesture. */
  activationDistance: number;
  /** |dy| must also be at least ratio * |dx|. */
  directionRatio: number;
}

export interface GestureConfig {
  /** Single-finger vertical pan on the game surface drives the feed. */
  surfacePan: PanRule;
  /** Pan that starts on the Dock / tab bar. Always available — the user always has a way out. */
  dockPan: PanRule;
  /** Two-finger vertical pan on the game surface drives the feed. */
  twoFingerPan: PanRule;
  /** True when the game owns every single-finger gesture on its surface. */
  gameOwnsSurface: boolean;
  /** Bottom bar presentation: the tab bar, or the Dock during play. */
  bottomBar: "tabbar" | "dock";
  /** Overlay (top tabs, action rail, caption) presentation. */
  overlay: "full" | "hidden";
  /** Which inset set the game should respect. */
  insets: "preview" | "play";
}

const OFF: PanRule = { enabled: false, activationDistance: Infinity, directionRatio: Infinity };

/**
 * The ownership table. Pure function of phase and controls, so it can be evaluated on the UI thread
 * (inside a Reanimated worklet) as well as in tests and the simulator.
 */
export function gestureConfigFor(phase: CardPhase, controls: ContractControls): GestureConfig {
  "worklet";
  const dockPan: PanRule = { enabled: true, activationDistance: THRESHOLDS.dockActivation, directionRatio: 1 };
  if (phase === "PLAYING") {
    const twoFingerPan: PanRule = controls.multitouch
      ? OFF
      : { enabled: true, activationDistance: THRESHOLDS.twoFingerActivation, directionRatio: THRESHOLDS.twoFingerRatio };
    if (controls.vertical) {
      return { surfacePan: OFF, dockPan, twoFingerPan, gameOwnsSurface: true, bottomBar: "dock", overlay: "hidden", insets: "play" };
    }
    return {
      surfacePan: { enabled: true, activationDistance: THRESHOLDS.playingActivation, directionRatio: THRESHOLDS.playingRatio },
      dockPan,
      twoFingerPan,
      gameOwnsSurface: false,
      bottomBar: "dock",
      overlay: "hidden",
      insets: "play",
    };
  }
  return {
    surfacePan: { enabled: true, activationDistance: THRESHOLDS.idleActivation, directionRatio: THRESHOLDS.idleRatio },
    dockPan,
    // Outside PLAYING any vertical pan already belongs to the feed; no separate two-finger rule needed.
    twoFingerPan: OFF,
    gameOwnsSurface: false,
    bottomBar: "tabbar",
    overlay: "full",
    insets: "preview",
  };
}

export function gestureConfig(state: CardState, controls: ContractControls): GestureConfig {
  return gestureConfigFor(state.phase, controls);
}

/** Does a pan translation satisfy a rule's activation criteria? */
export function claims(rule: PanRule, dx: number, dy: number): boolean {
  "worklet";
  if (!rule.enabled) return false;
  const ady = Math.abs(dy);
  return ady >= rule.activationDistance && ady >= rule.directionRatio * Math.abs(dx);
}

export type ReleaseDecision = "next" | "prev" | "stay";

/**
 * Where the feed goes when a claimed pan is released.
 * dy < 0 means the finger moved up (content follows the finger up) => next card.
 */
export function resolveRelease(
  dy: number,
  vy: number,
  cardHeight: number,
  opts: { canNext: boolean; canPrev: boolean } = { canNext: true, canPrev: true },
): ReleaseDecision {
  "worklet";
  const distance = THRESHOLDS.commitDistanceRatio * cardHeight;
  const up = dy < 0;
  const flingAgrees = up ? vy <= -THRESHOLDS.commitVelocity : vy >= THRESHOLDS.commitVelocity;
  const flingOpposes = up ? vy >= THRESHOLDS.commitVelocity : vy <= -THRESHOLDS.commitVelocity;
  const far = Math.abs(dy) >= distance;
  if (flingOpposes) return "stay";
  if (!(far || flingAgrees) || dy === 0) return "stay";
  if (up) return opts.canNext ? "next" : "stay";
  return opts.canPrev ? "prev" : "stay";
}

/** Should the Dock coach animation play for this card? */
export function shouldShowDockCoach(phase: CardPhase, controls: ContractControls, timesShown: number): boolean {
  return phase === "PLAYING" && controls.vertical && timesShown < DOCK_COACH_MAX_SHOWS;
}
