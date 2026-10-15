"use client";
import { layout } from "@thumbcade/design-tokens";
import { safeAccent, type Challenge } from "@thumbcade/protocol";
import { claims, gestureConfigFor, resolveRelease, type CardPhase } from "@thumbcade/swipe-contract";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Icon } from "../icon";
import { FeedCard } from "./feed-card";
import { AuthPrompt, CommentsSheet, Toast } from "./sheets";
import type { CardApi, FeedGeometry, WebCard, WebViewer } from "./types";

interface DragState {
  pointerId: number;
  x0: number;
  y0: number;
  t0: number;
  source: "surface" | "dock";
  claimed: boolean;
  samples: { y: number; t: number }[];
}

const WHEEL_THRESHOLD = 48;
const WHEEL_COOLDOWN_MS = 650;

/**
 * The web player: the same feed as the app, in a browser. Uses the shared Swipe Contract.
 * Cross-origin frames hide their pointer events, so outside PLAYING the feed owns a capture
 * layer and forwards taps into the game (`input.inject`, the §5.6 fallback). While PLAYING the
 * game receives input directly and the feed is reachable through the Dock, the keyboard and the wheel.
 */
export function WebFeed({
  cards,
  geometry,
  viewer,
  challenge,
  wheel = false,
  loop = true,
  className,
}: {
  cards: WebCard[];
  geometry: FeedGeometry;
  viewer: WebViewer | null;
  challenge?: Challenge;
  /** Hijack the mouse wheel for feed navigation (full-screen player only). */
  wheel?: boolean;
  loop?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [phases, setPhases] = useState<Record<string, CardPhase>>({});
  const [muted, setMuted] = useState(true);
  const [authAction, setAuthAction] = useState<string | null>(null);
  const [commentsFor, setCommentsFor] = useState<WebCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const registry = useRef(new Map<string, CardApi>());
  const drag = useRef<DragState | null>(null);
  const wheelAcc = useRef({ sum: 0, last: 0, lockedUntil: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const n = cards.length;

  const at = useCallback((i: number) => (loop ? cards[((i % n) + n) % n] : cards[i]) ?? null, [cards, n, loop]);
  const keyAt = useCallback((i: number) => `${at(i)?.id ?? "x"}~${Math.floor(i / Math.max(1, n))}`, [at, n]);
  const current = at(index);
  const currentKey = keyAt(index);
  const phase: CardPhase = phases[currentKey] ?? "LOADING";
  const controls = useMemo(() => current?.controls ?? { vertical: false, horizontal: false, multitouch: false, inputs: ["tap" as const] }, [current]);
  const config = gestureConfigFor(phase, controls);
  const canPrev = loop || index > 0;
  const canNext = loop || index < n - 1;
  const H = geometry.height;

  const register = useCallback((id: string, api: CardApi | null) => {
    if (api) registry.current.set(id, api);
    else registry.current.delete(id);
  }, []);
  const onPhase = useCallback((id: string, p: CardPhase) => setPhases((prev) => (prev[id] === p ? prev : { ...prev, [id]: p })), []);
  const currentApi = () => registry.current.get(currentKey);

  // Sheets suspend the current card (environmental suspension, §5.1).
  const sheetOpen = authAction !== null || commentsFor !== null;
  useEffect(() => {
    const api = registry.current.get(currentKey);
    if (!api) return;
    api.dispatch({ type: sheetOpen ? "SUSPEND" : "UNSUSPEND", reason: "sheet" });
  }, [sheetOpen, currentKey]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  const go = useCallback(
    (dir: 1 | -1) => {
      if ((dir === 1 && !canNext) || (dir === -1 && !canPrev)) return;
      setDragging(false);
      setOffset(0);
      setIndex((i) => i + dir);
    },
    [canNext, canPrev],
  );

  // ---- pointer gestures --------------------------------------------------------------------
  const begin = (e: ReactPointerEvent<HTMLElement>, source: DragState["source"]) => {
    if (drag.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), source, claimed: false, samples: [{ y: e.clientY, t: performance.now() }] };
  };

  const scaleOf = (el: HTMLElement) => el.getBoundingClientRect().height / el.offsetHeight || 1;

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const s = scaleOf(e.currentTarget);
    const dx = (e.clientX - d.x0) / s;
    const dy = (e.clientY - d.y0) / s;
    d.samples.push({ y: e.clientY / s, t: performance.now() });
    if (d.samples.length > 6) d.samples.shift();
    if (!d.claimed) {
      const rule = d.source === "dock" ? config.dockPan : config.surfacePan;
      if (!claims(rule, dx, dy)) return;
      d.claimed = true;
      setDragging(true);
      currentApi()?.dispatch({ type: "FEED_GESTURE_BEGIN" });
    }
    const atEdge = (dy > 0 && !canPrev) || (dy < 0 && !canNext);
    setOffset(atEdge ? dy * 0.3 : dy);
  };

  const end = (e: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const s = scaleOf(e.currentTarget);
    const dy = (e.clientY - d.y0) / s;
    const dx = (e.clientX - d.x0) / s;
    if (!d.claimed) {
      // A tap on the feed-owned layer goes to the game.
      const dt = performance.now() - d.t0;
      if (!cancelled && d.source === "surface" && Math.hypot(dx, dy) < 10 && dt < 600) {
        const rect = e.currentTarget.getBoundingClientRect();
        currentApi()?.inject((e.clientX - rect.left) / s, (e.clientY - rect.top) / s);
      }
      return;
    }
    const first = d.samples[0]!;
    const last = d.samples[d.samples.length - 1]!;
    const vy = last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
    const decision = cancelled ? "stay" : resolveRelease(dy, vy, H, { canNext, canPrev });
    currentApi()?.dispatch({ type: "FEED_GESTURE_END", committed: decision !== "stay" });
    setDragging(false);
    setOffset(0);
    if (decision === "next") setIndex((i) => i + 1);
    if (decision === "prev") setIndex((i) => i - 1);
  };

  const onWheel = (e: ReactWheelEvent<HTMLElement>) => {
    if (!wheel) return;
    const now = performance.now();
    const w = wheelAcc.current;
    if (now < w.lockedUntil) return;
    if (now - w.last > 200) w.sum = 0;
    w.last = now;
    w.sum += e.deltaY;
    if (Math.abs(w.sum) >= WHEEL_THRESHOLD) {
      const dir = w.sum > 0 ? 1 : -1;
      w.sum = 0;
      w.lockedUntil = now + WHEEL_COOLDOWN_MS;
      go(dir);
    }
  };

  // Keyboard: arrows / j k when the player has focus (or always in full-screen mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen) return;
      const root = rootRef.current;
      const focusInside = root?.contains(document.activeElement) && document.activeElement?.tagName !== "IFRAME";
      if (!wheel && !focusInside) return;
      if (["ArrowDown", "PageDown", "j"].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (["ArrowUp", "PageUp", "k"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === "m") {
        setMuted((m) => !m);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, wheel, sheetOpen]);

  const share = useCallback(
    async (card: WebCard, score?: number) => {
      const url = `${window.location.origin}/g/${card.slug}`;
      const text = score !== undefined ? `I scored ${Math.round(score).toLocaleString("en-US")} on ${card.name}. Your move.` : `${card.name} on Thumbcade`;
      try {
        if (navigator.share) {
          await navigator.share({ title: card.name, text, url });
          return true;
        }
        await navigator.clipboard.writeText(`${text} ${url}`);
        flash("Link copied");
        return true;
      } catch {
        return false;
      }
    },
    [flash],
  );

  const capture = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => begin(e, "surface"),
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => move(e),
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => end(e),
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => end(e, true),
    onWheel: (e: ReactWheelEvent<HTMLDivElement>) => onWheel(e),
  };

  if (!current) return null;
  const playing = phase === "PLAYING";
  const accent = safeAccent(current.accentColor);
  const windowIdx = [index - 1, index, index + 1].filter((i) => loop || (i >= 0 && i < n));

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      aria-roledescription="game feed"
      aria-label="Thumbcade feed. Use arrow keys to change games."
      className={`relative select-none overflow-hidden bg-black outline-none ${className ?? ""}`}
      style={{ width: geometry.width, height: geometry.height + geometry.bottomBar }}
      onWheel={onWheel}
    >
      {windowIdx.map((i) => {
        const card = at(i);
        if (!card) return null;
        const key = keyAt(i);
        return (
          <FeedCard
            key={key}
            cardKey={key}
            card={card}
            active={i === index}
            offsetY={(i - index) * H + offset}
            animate={!dragging}
            geometry={geometry}
            muted={muted}
            challenge={i === 0 ? challenge : undefined}
            viewer={viewer}
            register={register}
            onPhase={onPhase}
            onNeedsAuth={setAuthAction}
            onOpenComments={setCommentsFor}
            onShare={share}
            onToggleMute={() => setMuted((m) => !m)}
            capture={capture}
          />
        );
      })}

      {/* Top bar */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-end justify-center transition-opacity duration-200"
        style={{ height: geometry.statusTop + layout.topBarHeight, paddingBottom: 10, opacity: playing ? 0 : 1 }}
      >
        <span className="relative font-semiwide text-[16px] font-bold text-paper">
          For You
          <span className="absolute -bottom-1.5 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-paper" />
        </span>
      </div>

      {/* Bottom bar: tab bar outside play, the Dock while playing. The game viewport never resizes. */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 border-t border-white/8 bg-black"
        style={{ height: geometry.bottomBar }}
        onPointerDown={(e) => begin(e, "dock")}
        onPointerMove={move}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => end(e, true)}
      >
        <div className="relative h-14">
          {/* Tab bar */}
          <nav
            aria-label="Thumbcade"
            className="absolute inset-0 grid grid-cols-3 items-center transition-all duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ opacity: playing ? 0 : 1, transform: playing ? "translateY(10px) scale(0.96)" : "none", pointerEvents: playing ? "none" : "auto" }}
          >
            <span className="flex flex-col items-center gap-0.5 text-paper">
              <Icon name="home" size={24} active detailColor="#000" />
              <span className="text-[10px] font-semibold">For you</span>
            </span>
            <Link href="/docs" className="mx-auto flex h-8 w-12 items-center justify-center rounded-[10px] bg-accent text-on-accent" aria-label="Build a game">
              <Icon name="plus" size={20} />
            </Link>
            <Link href={viewer ? "/creator" : `/login?next=${encodeURIComponent(pathname ?? "/")}`} className="flex flex-col items-center gap-0.5 text-paper/60">
              <Icon name="profile" size={24} />
              <span className="text-[10px] font-semibold">{viewer ? "You" : "Sign in"}</span>
            </Link>
          </nav>
          {/* Dock */}
          <div
            className="absolute inset-0 flex items-center justify-between px-5 transition-all duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ opacity: playing ? 1 : 0, transform: playing ? "none" : "translateY(-10px) scale(0.96)", pointerEvents: playing ? "auto" : "none" }}
            aria-hidden={!playing}
          >
            <button type="button" onClick={() => currentApi()?.dispatch({ type: "PAUSE", reason: "user" })} className="flex size-10 items-center justify-center text-paper/80" aria-label="Pause">
              <Icon name="pause" size={20} />
            </button>
            <div className="flex flex-col items-center gap-1.5" aria-label="Swipe here for the next game">
              <span className="block h-[5px] w-11 rounded-full" style={{ background: accent }} />
              <span className="font-mono text-[10px] uppercase tracking-wider text-paper/45">swipe · next</span>
            </div>
            <button type="button" onClick={() => setMuted((m) => !m)} className="flex size-10 items-center justify-center text-paper/80" aria-label={muted ? "Unmute" : "Mute"}>
              <Icon name={muted ? "soundOff" : "soundOn"} size={20} />
            </button>
          </div>
        </div>
      </div>

      <AuthPrompt action={authAction} onClose={() => setAuthAction(null)} next={pathname ?? "/"} />
      <CommentsSheet card={commentsFor} onClose={() => setCommentsFor(null)} viewer={viewer} onNeedsAuth={(a) => setAuthAction(a)} />
      <Toast message={toast} />
    </div>
  );
}
