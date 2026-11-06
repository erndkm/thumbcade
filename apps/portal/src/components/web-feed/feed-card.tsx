"use client";
import { layout } from "@thumbcade/design-tokens";
import {
  BUDGETS,
  CURRENT_SDK_MAJOR,
  dailySeedFor,
  formatCount,
  formatScore,
  safeAccent,
  type Challenge,
  type GameToShellPayload,
  type GameToShellType,
  type InsetSet,
  type LaunchContext,
  type LeaderboardEntry,
} from "@thumbcade/protocol";
import { createCardState, transition, type CardState, type ContractEvent, type Effect } from "@thumbcade/swipe-contract";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEventHandler, type WheelEventHandler } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Avatar } from "../avatar";
import { GameIcon } from "../game-icon";
import { Icon } from "../icon";
import { ResultCard } from "./result-card";
import type { CardApi, FeedGeometry, WebCard, WebViewer } from "./types";
import { useGameBridge, type Reply } from "./use-game-bridge";
import { useSocial } from "./use-social";

const SDK_VERSION = `${CURRENT_SDK_MAJOR}.0.0`;

function readBest(gameId: string): number | null {
  try {
    const v = localStorage.getItem(`tc:best:${gameId}`);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function writeBest(gameId: string, score: number, order: "asc" | "desc"): { best: number; isNew: boolean } {
  const prev = readBest(gameId);
  const isNew = prev === null || (order === "desc" ? score > prev : score < prev);
  const best = isNew ? score : (prev as number);
  try {
    if (isNew) localStorage.setItem(`tc:best:${gameId}`, String(score));
  } catch {
    // Storage unavailable (private mode): best stays in memory for this card.
  }
  return { best, isNew };
}

function kvKey(gameId: string, key: string) {
  return `tc:kv:${gameId}:${key}`;
}

function kvUsage(gameId: string, excludeKey: string): number {
  let total = 0;
  try {
    const prefix = `tc:kv:${gameId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== kvKey(gameId, excludeKey)) total += (localStorage.getItem(k) ?? "").length;
    }
  } catch {
    // ignore
  }
  return total;
}

export function FeedCard({
  cardKey,
  card,
  active,
  offsetY,
  animate,
  geometry,
  muted,
  challenge,
  viewer,
  register,
  onPhase,
  onNeedsAuth,
  onOpenComments,
  onShare,
  onToggleMute,
  capture,
}: {
  cardKey: string;
  card: WebCard;
  active: boolean;
  offsetY: number;
  animate: boolean;
  geometry: FeedGeometry;
  muted: boolean;
  challenge?: Challenge;
  viewer: WebViewer | null;
  register: (id: string, api: CardApi | null) => void;
  onPhase: (id: string, phase: CardState["phase"]) => void;
  onNeedsAuth: (action: string) => void;
  onOpenComments: (card: WebCard) => void;
  onShare: (card: WebCard, score?: number) => Promise<boolean>;
  onToggleMute: () => void;
  capture: {
    onPointerDown: PointerEventHandler<HTMLDivElement>;
    onPointerMove: PointerEventHandler<HTMLDivElement>;
    onPointerUp: PointerEventHandler<HTMLDivElement>;
    onPointerCancel: PointerEventHandler<HTMLDivElement>;
    onWheel: WheelEventHandler<HTMLDivElement>;
  };
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<CardState>(createCardState());
  const [state, setState] = useState<CardState>(stateRef.current);
  const [reloadKey, setReloadKey] = useState(0);
  // A game can navigate its own frame. The portal's frame-src refuses anything off the games origin before a
  // request leaves, and the frame then loads the browser's error page. A frame load and a frame-src violation
  // within a second of each other (either may come first) is this game trying to get out: drop the frame.
  const frameLoadAt = useRef(-Infinity);
  const frameViolationAt = useRef(-Infinity);
  const [escaped, setEscaped] = useState(false);
  const [result, setResult] = useState<{ score: number; best: number; isNew: boolean } | null>(null);
  const [frameVisible, setFrameVisible] = useState(false);
  const accent = safeAccent(card.accentColor);
  const social = useSocial(card, viewer, onNeedsAuth);
  const supabase = useMemo(() => createClient(), []);
  const playerId = useRef<string | null>(null);

  const insets = useMemo<InsetSet>(
    () => ({
      preview: { top: geometry.statusTop + layout.topBarHeight, right: layout.actionRailWidth, bottom: layout.captionHeight, left: 0 },
      play: { top: geometry.statusTop, right: 0, bottom: 0, left: 0 },
      current: state.phase === "PLAYING" ? "play" : "preview",
    }),
    [geometry.statusTop, state.phase],
  );

  useEffect(() => {
    if (!viewer) return;
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${viewer.id}:${card.id}`)).then((buf) => {
      playerId.current = Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
    });
  }, [viewer, card.id]);

  const getContext = useCallback(
    (): LaunchContext => ({
      sdkVersion: SDK_VERSION,
      gameId: card.id,
      versionId: card.version.id,
      player:
        viewer && playerId.current
          ? { id: playerId.current, name: viewer.displayName, avatarUrl: viewer.avatarUrl, guest: false }
          : null,
      locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
      reducedMotion: typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
      audio: { muted },
      insets,
      ...(challenge ? { challenge } : {}),
      launchReason: challenge ? "challenge" : "feed",
      seed: Math.floor(Math.random() * 2 ** 31),
      dailySeed: dailySeedFor(),
      best: readBest(card.id),
      host: "web",
    }),
    [card.id, card.version.id, viewer, muted, insets, challenge],
  );

  // ---- effects of the state machine -------------------------------------------------------
  const sendRef = useRef<(type: Parameters<ReturnType<typeof useGameBridge>["send"]>[0], payload?: unknown) => void>(() => {});
  const runEffects = useCallback((effects: Effect[]) => {
    for (const e of effects) {
      if (e.type === "send") {
        if (e.message === "pause") sendRef.current("pause", { reason: e.reason });
        else sendRef.current(e.message);
      } else if (e.type === "reload") {
        setFrameVisible(false);
        setResult(null);
        setReloadKey((k) => k + 1);
      } else if (e.type === "violation" && process.env.NODE_ENV !== "production") {
        console.warn(`[thumbcade] ${card.slug}: ${e.detail}`);
      }
    }
  }, [card.slug]);

  const dispatch = useCallback(
    (event: ContractEvent) => {
      const r = transition(stateRef.current, event);
      stateRef.current = r.state;
      setState(r.state);
      runEffects(r.effects);
    },
    [runEffects],
  );

  // ---- bridge -------------------------------------------------------------------------------
  const onMessage = useCallback(
    (type: GameToShellType, payload: unknown, reply: Reply | null) => {
      switch (type) {
        case "ready":
          dispatch({ type: "READY" });
          setFrameVisible(true);
          break;
        case "gameplay.start": {
          const p = payload as GameToShellPayload<"gameplay.start">;
          setResult(null);
          dispatch({ type: "GAMEPLAY_START", trigger: p?.trigger });
          break;
        }
        case "gameplay.end": {
          const p = payload as GameToShellPayload<"gameplay.end">;
          const { best, isNew } = writeBest(card.id, p.score, card.score.order);
          if (stateRef.current.phase === "PLAYING" || stateRef.current.phase === "PAUSED") setResult({ score: p.score, best, isNew });
          dispatch({ type: "GAMEPLAY_END", score: p.score });
          break;
        }
        case "storage.get": {
          const p = payload as GameToShellPayload<"storage.get">;
          let value: unknown;
          try {
            const raw = localStorage.getItem(kvKey(card.id, p.key));
            value = raw === null ? null : JSON.parse(raw);
          } catch {
            value = null;
          }
          reply?.({ ok: true, result: { value } });
          break;
        }
        case "storage.set": {
          const p = payload as GameToShellPayload<"storage.set">;
          const raw = JSON.stringify(p.value);
          if (raw.length > BUDGETS.storageValueBytes || kvUsage(card.id, p.key) + raw.length > BUDGETS.storageBytesPerGame) {
            reply?.({ ok: false, error: { code: "quota", message: "Storage quota exceeded (64 KB per game)" } });
            break;
          }
          try {
            localStorage.setItem(kvKey(card.id, p.key), raw);
            reply?.({ ok: true, result: { ok: true } });
          } catch {
            reply?.({ ok: false, error: { code: "unavailable", message: "Storage unavailable" } });
          }
          break;
        }
        case "leaderboard.top": {
          const p = payload as GameToShellPayload<"leaderboard.top">;
          if (p.scope === "friends") {
            reply?.({ ok: true, result: { entries: [] } });
            break;
          }
          const select = "best_score, user:profiles ( id, display_name, avatar_url )";
          const asc = card.score.order === "asc";
          const q =
            p.scope === "daily"
              ? supabase.from("daily_scores").select(select).eq("game_id", card.id).eq("day", new Date().toISOString().slice(0, 10)).order("best_score", { ascending: asc }).limit(p.limit)
              : supabase.from("best_scores").select(select).eq("game_id", card.id).order("best_score", { ascending: asc }).limit(p.limit);
          void q.then(({ data }) => {
            const rows = (data ?? []) as unknown as { best_score: number; user: { id: string; display_name: string; avatar_url: string | null } | null }[];
            const entries: LeaderboardEntry[] = rows.map((r, i) => ({
              rank: i + 1,
              name: r.user?.display_name ?? "Player",
              avatarUrl: r.user?.avatar_url ?? null,
              score: r.best_score,
              isMe: !!viewer && r.user?.id === viewer.id,
            }));
            reply?.({ ok: true, result: { entries } });
          });
          break;
        }
        case "leaderboard.me":
          reply?.({ ok: true, result: { best: readBest(card.id), rank: null, percentile: null } });
          break;
        case "feedback": {
          const p = payload as GameToShellPayload<"feedback">;
          const pattern = { tap: 8, impact: 14, success: [10, 40, 18], fail: [24, 30, 24] }[p.kind];
          if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
          break;
        }
        case "share.challenge": {
          const p = payload as GameToShellPayload<"share.challenge">;
          void onShare(card, p.score).then((shared) => reply?.({ ok: true, result: { shared } }));
          break;
        }
        case "log":
          if (process.env.NODE_ENV !== "production") {
            const p = payload as GameToShellPayload<"log">;
            console.log(`[${card.slug}]`, ...p.args);
          }
          break;
        default:
          break;
      }
    },
    [card, dispatch, supabase, viewer, onShare],
  );

  const { send } = useGameBridge({ iframe, origin: card.version.origin, getContext, onMessage });
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Keep the game informed about mute and inset changes.
  const firstMute = useRef(true);
  useEffect(() => {
    if (firstMute.current) {
      firstMute.current = false;
      return;
    }
    if (state.ready) send(muted ? "mute" : "unmute");
  }, [muted, send, state.ready]);
  useEffect(() => {
    if (state.ready) send("insets", insets);
  }, [insets, send, state.ready]);

  // Activation follows the pager.
  useEffect(() => {
    dispatch({ type: active ? "ACTIVATE" : "DEACTIVATE" });
  }, [active, dispatch]);

  // Report phase to the pager (gesture rules, bottom bar).
  useEffect(() => {
    onPhase(cardKey, state.phase);
  }, [cardKey, state.phase, onPhase]);

  useEffect(() => {
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (e.effectiveDirective !== "frame-src") return;
      frameViolationAt.current = performance.now();
      if (frameViolationAt.current - frameLoadAt.current < 1000) setEscaped(true);
    };
    document.addEventListener("securitypolicyviolation", onViolation);
    return () => document.removeEventListener("securitypolicyviolation", onViolation);
  }, []);

  // Load timeout.
  useEffect(() => {
    if (state.ready) return;
    const t = window.setTimeout(() => dispatch({ type: "LOAD_FAILED" }), BUDGETS.loadTimeoutMs);
    return () => window.clearTimeout(t);
  }, [state.ready, reloadKey, dispatch]);

  // Page visibility = environmental suspension.
  useEffect(() => {
    const onVis = () => dispatch({ type: document.hidden ? "SUSPEND" : "UNSUSPEND", reason: "background" });
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [dispatch]);

  useEffect(() => {
    register(cardKey, {
      dispatch,
      phase: () => stateRef.current.phase,
      inject: (x, y) => send("input.inject", { kind: "tap", x, y }),
    });
    return () => register(cardKey, null);
  }, [cardKey, dispatch, register, send]);

  const playing = state.phase === "PLAYING";
  const ownsSurface = !playing; // web: the feed captures input outside PLAYING and forwards taps.

  return (
    <section
      aria-roledescription="game card"
      aria-label={`${card.name} by @${card.creator.handle}`}
      className="absolute inset-x-0 top-0 overflow-hidden bg-black"
      style={{
        height: geometry.height,
        transform: `translate3d(0, ${offsetY}px, 0)`,
        transition: animate ? "transform 460ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        willChange: "transform",
      }}
    >
      {/* Poster underlay — never a blank frame, never a spinner. */}
      {card.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.posterUrl} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      ) : (
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 70% at 50% 30%, ${card.accentColor}55, #000 70%)` }} />
      )}
      {!frameVisible && state.phase !== "FAILED" ? (
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background: `linear-gradient(100deg, transparent 30%, ${accent}22 50%, transparent 70%)`,
            backgroundSize: "200% 100%",
            animation: "shimmer 1.8s linear infinite",
          }}
        />
      ) : null}

      {escaped ? null : (
        <iframe
          key={reloadKey}
          ref={iframe}
          src={card.version.entryUrl}
          onLoad={() => {
            frameLoadAt.current = performance.now();
            if (frameLoadAt.current - frameViolationAt.current < 1000) setEscaped(true);
          }}
          title={card.name}
          className="absolute inset-0 size-full border-0"
          style={{ opacity: frameVisible ? 1 : 0, transition: "opacity 260ms ease-out", colorScheme: "normal" }}
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          allow="autoplay; fullscreen; gamepad"
          referrerPolicy="no-referrer"
          loading="eager"
          tabIndex={active && playing ? 0 : -1}
        />
      )}

      {/* Scanline wipe on poster → live. */}
      {frameVisible ? (
        <div
          key={`wipe-${reloadKey}`}
          className="pointer-events-none absolute inset-x-0 h-24 motion-reduce:hidden"
          style={{
            top: 0,
            background: `linear-gradient(to bottom, transparent, ${card.accentColor}66 48%, ${card.accentColor} 50%, ${card.accentColor}66 52%, transparent)`,
            animation: "tc-scan 420ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
          }}
        />
      ) : null}

      {/* Feed-owned capture layer (outside PLAYING): claims vertical drags, forwards taps. */}
      {ownsSurface && active ? <div className="absolute inset-0 touch-none" {...capture} /> : null}

      {/* Overlay chrome */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-200"
        style={{ opacity: playing ? 0 : 1 }}
        aria-hidden={playing}
      >
        <div className="absolute inset-x-0 bottom-0 h-64" style={{ background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.6))" }} />
        <div className="absolute inset-x-0 top-0 h-28" style={{ background: "linear-gradient(to top, transparent, rgba(0,0,0,0.35))" }} />

        {/* Caption */}
        <div className="pointer-events-auto absolute bottom-0 left-0 flex flex-col gap-1.5 p-4 pr-0" style={{ right: layout.actionRailWidth, maxHeight: layout.captionHeight }}>
          <div className="flex items-center gap-1.5 text-[15px] font-semibold text-paper">
            @{card.creator.handle}
            {card.creator.verified ? <span className="inline-block size-3.5 rounded-full bg-accent" title="Verified creator" /> : null}
          </div>
          <div className="font-wide text-[19px] font-extrabold leading-[22px] tracking-tight text-paper">{card.name}</div>
          <p className="line-clamp-2 text-[14px] leading-[19px] text-paper/85">
            {card.description}{" "}
            {card.tags.map((t) => (
              <span key={t} className="font-semibold text-paper">
                #{t}{" "}
              </span>
            ))}
          </p>
          <div className="flex items-center gap-2 font-mono text-[12px] text-paper/70">
            <Icon name="play" size={12} active />
            {formatCount(card.stats.plays)} plays
            {card.topScore !== null ? <span>· best {formatScore(card.topScore, card.score)}</span> : null}
          </div>
        </div>

        {/* Action rail */}
        <div className="pointer-events-auto absolute bottom-3 right-0 flex flex-col items-center gap-4" style={{ width: layout.actionRailWidth }}>
          <div className="relative mb-2">
            <Avatar url={card.creator.avatarUrl} seed={card.creator.avatarSeed} size={46} className="ring-2 ring-paper" />
            {viewer?.id !== card.creator.id ? (
              <button
                type="button"
                onClick={social.toggleFollow}
                aria-label={social.following ? `Unfollow @${card.creator.handle}` : `Follow @${card.creator.handle}`}
                className="absolute -bottom-2.5 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full text-ink-1 transition-transform active:scale-90"
                style={{ background: social.following ? "var(--color-paper)" : "var(--color-heat)" }}
              >
                <Icon name={social.following ? "check" : "plus"} size={13} />
              </button>
            ) : null}
          </div>
          <RailButton icon="like" active={social.liked} activeColor="var(--color-heat)" label={formatCount(social.counts.likes)} onClick={social.toggleLike} aria={social.liked ? "Unlike" : "Like"} />
          <RailButton icon="comment" label={formatCount(card.stats.comments)} onClick={() => onOpenComments(card)} aria="Comments" />
          <RailButton icon="save" active={social.saved} activeColor="var(--color-accent)" label={formatCount(social.counts.saves)} onClick={social.toggleSave} aria={social.saved ? "Unsave" : "Save"} />
          <RailButton icon="share" label={formatCount(card.stats.shares)} onClick={() => void onShare(card)} aria="Share" />
          <Link href={`/g/${card.slug}`} aria-label={`Open ${card.name}`} className="mt-1 block rounded-[12px] p-[3px]" style={{ background: "#1b1b21" }}>
            <span className="block motion-safe:animate-[spin-slow_8s_linear_infinite]">
              <GameIcon url={card.iconUrl} name={card.name} accent={card.accentColor} size={layout.cartridgeSize - 6} />
            </span>
          </Link>
        </div>

        {/* Sound toggle (web autoplay policies start muted) */}
        <button
          type="button"
          onClick={onToggleMute}
          className="pointer-events-auto absolute right-4 flex size-9 items-center justify-center rounded-full bg-black/40 text-paper backdrop-blur-sm"
          style={{ top: geometry.statusTop + layout.topBarHeight + 8 }}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          <Icon name={muted ? "soundOff" : "soundOn"} size={18} />
        </button>
      </div>

      {/* Paused */}
      {state.phase === "PAUSED" && active ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
          <button
            type="button"
            onClick={() => dispatch({ type: "RESUME_PLAY" })}
            className="flex h-14 items-center gap-3 rounded-pill bg-paper pl-5 pr-6 font-semiwide text-[16px] font-bold text-ink-1 shadow-[0_10px_40px_rgba(0,0,0,0.5)] active:scale-95"
          >
            <Icon name="play" active size={18} /> Resume
          </button>
        </div>
      ) : null}

      {/* The game tried to leave its frame */}
      {escaped ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-10 text-center">
          <p className="font-wide text-[20px] font-extrabold text-paper">We stopped this game.</p>
          <p className="text-[14px] text-paper/70">It tried to leave the player. Swipe on to the next one.</p>
        </div>
      ) : null}

      {/* Failed */}
      {state.phase === "FAILED" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 px-10 text-center">
          <p className="font-wide text-[20px] font-extrabold text-paper">That game tripped over a cable.</p>
          <p className="text-[14px] text-paper/70">It didn&apos;t start in time. Give it another go, or swipe on.</p>
          <button type="button" onClick={() => dispatch({ type: "RETRY" })} className="h-11 rounded-pill bg-accent px-5 font-semiwide text-[15px] font-bold text-on-accent">
            Retry
          </button>
        </div>
      ) : null}

      {/* Result */}
      {state.phase === "ENDED" && result && !state.replayRequested ? (
        <ResultCard
          card={card}
          score={result.score}
          best={result.best}
          isNewBest={result.isNew}
          challenge={challenge}
          onReplay={() => dispatch({ type: "REPLAY" })}
          onChallenge={() => void onShare(card, result.score)}
        />
      ) : null}
    </section>
  );
}

function RailButton({
  icon,
  label,
  onClick,
  active,
  activeColor,
  aria,
}: {
  icon: "like" | "comment" | "save" | "share";
  label: string;
  onClick: () => void;
  active?: boolean;
  activeColor?: string;
  aria: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={aria} aria-pressed={active} className="group flex flex-col items-center gap-1 text-paper">
      <span className="transition-transform duration-150 group-active:scale-90" style={{ color: active ? activeColor : undefined, filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.35))" }}>
        <Icon name={icon} size={32} active={active} />
      </span>
      <span className="font-mono text-[12px] leading-none text-paper/90 tabular">{label}</span>
    </button>
  );
}
