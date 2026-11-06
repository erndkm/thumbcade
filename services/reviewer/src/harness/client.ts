/**
 * Harness page (runs in the browser): a minimal Thumbcade shell around one game iframe.
 * It uses the real iframe host (@thumbcade/sdk/host) and the real Swipe Contract state machine, so
 * what the reviewer observes is what the app would do.
 */
import { createIframeHost, createLaunchContext, DEVICES, feedInsets, gameViewport, memoryHandlers, type HostLogEntry } from "@thumbcade/sdk/host";
import { createCardState, transition, type CardState, type ContractEvent, type Effect } from "@thumbcade/swipe-contract";

export interface HarnessEntry extends HostLogEntry {
  /** performance.now() of the harness page. */
  t: number;
}

export interface HarnessApi {
  log: HarnessEntry[];
  violations: Array<{ code: string; detail: string; t: number }>;
  phases: Array<{ phase: string; t: number }>;
  state(): CardState;
  dispatch(ev: ContractEvent): void;
  send(type: string, payload?: unknown): void;
  connected(): boolean;
  viewport: { width: number; height: number };
  now(): number;
  /** performance.now() when the game iframe's src was set. */
  startedAt: number;
  setInsetsOverlay(on: boolean): void;
}

const q = new URLSearchParams(location.search);
const gameUrl = q.get("game") ?? "";
const device = DEVICES[(q.get("device") ?? "iphone") as keyof typeof DEVICES] ?? DEVICES.iphone;
const mode = q.get("mode") ?? "feed";
const muted = q.get("muted") !== "0";
/** The player's reduce-motion setting, as the app passes it (`?reducedMotion=1`). */
const reducedMotion = q.get("reducedMotion") === "1";
const statusBar = device.statusBar;
const vp = mode === "poster" ? { width: innerWidth, height: innerHeight } : gameViewport(device);

document.documentElement.style.cssText = "margin:0;background:#000;overflow:hidden";
document.body.style.cssText = "margin:0;background:#000;overflow:hidden";

const iframe = document.createElement("iframe");
iframe.setAttribute("allow", "autoplay");
iframe.style.cssText = `position:absolute;left:0;top:0;width:${vp.width}px;height:${vp.height}px;border:0;display:block;background:#000`;
document.body.appendChild(iframe);

if (mode !== "poster") {
  // The bottom bar (tab bar / Dock area) the phone reserves below the game viewport.
  const bar = document.createElement("div");
  bar.style.cssText = `position:absolute;left:0;top:${vp.height}px;width:${vp.width}px;height:${device.height - vp.height}px;background:#000;border-top:1px solid #24242B`;
  document.body.appendChild(bar);
}

// Outline what the feed overlay covers in preview, for human reviewers reading the screenshots.
const overlay = document.createElement("div");
overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;display:none";
{
  const i = feedInsets(statusBar).preview;
  const box = (css: string) => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;pointer-events:none;background:repeating-linear-gradient(135deg,rgba(212,255,61,.16) 0 6px,rgba(212,255,61,0) 6px 12px);outline:1px dashed rgba(212,255,61,.7);outline-offset:-1px;${css}`;
    overlay.appendChild(d);
  };
  box(`left:0;top:0;width:${vp.width}px;height:${i.top}px`);
  box(`left:${vp.width - i.right}px;top:${i.top}px;width:${i.right}px;height:${vp.height - i.top - i.bottom}px`);
  box(`left:0;top:${vp.height - i.bottom}px;width:${vp.width}px;height:${i.bottom}px`);
}
document.body.appendChild(overlay);
const setInsetsOverlay = (on: boolean) => {
  overlay.style.display = on ? "block" : "none";
};
setInsetsOverlay(q.get("insets") === "1");

const handlers = memoryHandlers();
let state = createCardState();
let insetsCurrent: "preview" | "play" = "preview";
const api: HarnessApi = {
  log: [],
  violations: [],
  phases: [],
  state: () => state,
  dispatch,
  send: (type, payload) => (host.send as (t: string, p?: unknown) => void)(type, payload),
  connected: () => host.connected,
  viewport: vp,
  now: () => performance.now(),
  startedAt: 0,
  setInsetsOverlay,
};
(window as unknown as { __harness: HarnessApi }).__harness = api;

const host = createIframeHost({
  iframe,
  gameOrigin: new URL(gameUrl, location.href).origin,
  context: () =>
    createLaunchContext({
      gameId: q.get("id") ?? "review",
      versionId: q.get("version") ?? "review",
      player: { id: "reviewer-0000-0001", name: "Reviewer", avatarUrl: null, guest: false },
      insets: feedInsets(statusBar, insetsCurrent),
      audio: { muted },
      reducedMotion,
      launchReason: "feed",
      host: "web",
      seed: 1234,
    }),
  handlers,
});
host.subscribe((e) => api.log.push({ ...e, t: performance.now() }));

function run(effect: Effect): void {
  if (effect.type === "send") {
    if (effect.message === "pause") host.send("pause", { reason: effect.reason });
    else host.send(effect.message);
  } else if (effect.type === "violation") {
    api.violations.push({ code: effect.code, detail: effect.detail, t: performance.now() });
  } else if (effect.type === "reload") {
    iframe.src = gameUrl;
  }
}

function dispatch(ev: ContractEvent): void {
  const r = transition(state, ev);
  state = r.state;
  if (api.phases.at(-1)?.phase !== state.phase) api.phases.push({ phase: state.phase, t: performance.now() });
  r.effects.forEach(run);
  const want = state.phase === "PLAYING" ? "play" : "preview";
  if (want !== insetsCurrent && state.ready) {
    insetsCurrent = want;
    host.send("insets", feedInsets(statusBar, want));
  }
}

host.on("ready", () => dispatch({ type: "READY" }));
host.on("gameplay.start", (p) => dispatch({ type: "GAMEPLAY_START", trigger: p?.trigger }));
host.on("gameplay.end", (p) => {
  handlers.recordScore(p.score);
  dispatch({ type: "GAMEPLAY_END", score: p.score });
});

dispatch({ type: "ACTIVATE" });
api.startedAt = performance.now();
iframe.src = gameUrl;
