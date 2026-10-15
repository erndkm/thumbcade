import { safeAccent } from "@thumbcade/protocol";
import { layout } from "@thumbcade/design-tokens";
import { DEV_INDEX, type Simulator, type SimSnapshot } from "../lib/sim.ts";
import { Icon } from "../ui/Icon.tsx";

const TABS = [
  { icon: "home", label: "Home" },
  { icon: "discover", label: "Discover" },
  { icon: "create", label: "" },
  { icon: "inbox", label: "Inbox" },
  { icon: "profile", label: "Profile" },
] as const;

/**
 * Tab bar <-> Dock. One element morphs: the Home indicator slides to the center and becomes the
 * accent grabber (shared-element spring). Pans that start here always drive the feed (6 pt).
 */
export function BottomBar({ sim, snap, mode }: { sim: Simulator; snap: SimSnapshot; mode: "tabbar" | "dock" }) {
  const dock = mode === "dock";
  const accent = safeAccent(sim.manifest?.accentColor ?? "#FF4A3D");
  const guard = (fn: () => void) => () => {
    if (!sim.shouldSuppressClick()) fn();
  };
  return (
    <div
      className={`bottombar ${dock ? "is-dock" : ""}`}
      style={{ height: layout.bottomBarHeight + snap.device.homeIndicator, paddingBottom: snap.device.homeIndicator, "--accent": accent } as React.CSSProperties}
      onPointerDown={(e) => sim.onChromePointerDown(e, "dock")}
      onWheel={(e) => sim.onChromeWheel(e.deltaY)}
    >
      <div className="tabbar" aria-hidden={dock}>
        {TABS.map((t, i) => (
          <span key={t.icon} className={`tabbar__item ${i === 0 ? "is-active" : ""} ${t.icon === "create" ? "tabbar__item--create" : ""}`}>
            <Icon name={t.icon} size={t.icon === "create" ? 28 : 24} active={i === 0} bg="#000" />
            {t.label ? <span className="tabbar__label">{t.label}</span> : null}
          </span>
        ))}
      </div>
      <div className="dock" aria-hidden={!dock}>
        <button className={`dock__btn ${snap.liked ? "is-liked" : ""}`} onClick={guard(() => sim.toggle("liked"))} aria-label="Like" tabIndex={dock ? 0 : -1}>
          <Icon name="like" size={22} active={snap.liked} />
        </button>
        <span className="dock__spacer" />
        <button className="dock__btn" onClick={guard(() => sim.toggleMute())} aria-label={snap.muted ? "Unmute" : "Mute"} tabIndex={dock ? 0 : -1}>
          <Icon name={snap.muted ? "soundOff" : "soundOn"} size={22} />
        </button>
        <button className="dock__btn" onClick={guard(() => sim.openSheet("share"))} aria-label="More" tabIndex={dock ? 0 : -1}>
          <Icon name="more" size={22} />
        </button>
      </div>
      <span className="morph" aria-hidden="true" />
      {snap.coach && snap.index === DEV_INDEX ? (
        <div className="coach" role="status">
          <Icon name="swipeUp" size={16} />
          <span>Swipe here for the next game</span>
        </div>
      ) : null}
    </div>
  );
}
