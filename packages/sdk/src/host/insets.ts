import type { Insets, InsetSet } from "../types.ts";

/**
 * Feed chrome geometry (mirrors `layout` in @thumbcade/design-tokens; a test keeps them equal).
 * The game viewport spans the full width from the top edge of the screen to the top of the bottom
 * bar, and never resizes (Swipe Contract §5.3).
 */
export const FEED_LAYOUT = {
  topBarHeight: 44,
  actionRailWidth: 72,
  captionHeight: 148,
  bottomBarHeight: 56,
} as const;

export interface DeviceProfile {
  id: "iphone" | "promax" | "android";
  label: string;
  /** Screen size in CSS px / points. */
  width: number;
  height: number;
  /** Top safe area (status bar / Dynamic Island). */
  statusBar: number;
  /** Bottom safe area (home indicator / gesture navigation). */
  homeIndicator: number;
  /** Display corner radius, for drawing the frame. */
  cornerRadius: number;
  platform: "ios" | "android";
}

export const DEVICES: Record<DeviceProfile["id"], DeviceProfile> = {
  iphone: { id: "iphone", label: "iPhone 6.1″", width: 390, height: 844, statusBar: 47, homeIndicator: 34, cornerRadius: 47, platform: "ios" },
  promax: { id: "promax", label: "iPhone Pro Max", width: 430, height: 932, statusBar: 59, homeIndicator: 34, cornerRadius: 55, platform: "ios" },
  android: { id: "android", label: "Android mid-range", width: 360, height: 800, statusBar: 28, homeIndicator: 20, cornerRadius: 26, platform: "android" },
};

/** Size of the game viewport on a device. */
export function gameViewport(device: DeviceProfile): { width: number; height: number } {
  return { width: device.width, height: device.height - FEED_LAYOUT.bottomBarHeight - device.homeIndicator };
}

/**
 * The inset set a feed card reports. Preview: status bar + top tabs, the action rail on the right,
 * and the caption block at the bottom. Play: the status bar only (the Dock lives outside the viewport).
 */
export function feedInsets(statusBar: number, current: "preview" | "play" = "preview"): InsetSet {
  const preview: Insets = {
    top: statusBar + FEED_LAYOUT.topBarHeight,
    right: FEED_LAYOUT.actionRailWidth,
    bottom: FEED_LAYOUT.captionHeight,
    left: 0,
  };
  const play: Insets = { top: statusBar, right: 0, bottom: 0, left: 0 };
  return { preview, play, current };
}
