import { CHANNEL, PROTOCOL_VERSION } from "./constants.ts";
import type { Transport } from "./transport.ts";
import type { Envelope, InsetSet, Json, LaunchContext, PauseReason } from "./types.ts";

/**
 * Standalone mode: the game was opened directly in a browser tab. An in-page mock host answers
 * every request (storage in localStorage, a local "leaderboard" of your best) and a small dev HUD
 * shows the card phase and lets you pause, mute and replay like the feed would.
 */

export interface StandaloneTransport extends Transport {
  /** The HUD root (null until hello). SDK input routing keeps its events away from the game. */
  readonly hud: HTMLElement | null;
  onHud(e: Event): void;
}

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

const HUD_CSS =
  ":host{all:initial;position:fixed;left:8px;bottom:8px;z-index:2147483647;font:500 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.04em;text-transform:uppercase;color:#F3F0E8}" +
  ".b{display:flex;align-items:center;gap:2px;background:rgba(13,13,16,.88);border:1px solid #34343D;border-radius:999px;padding:3px;opacity:.72}" +
  ".b:hover{opacity:1}i{width:8px;height:8px;border-radius:50%;background:#A7A3AE;margin:0 4px 0 7px;cursor:pointer}" +
  "span{padding:0 6px 0 2px;white-space:nowrap}button{all:unset;cursor:pointer;padding:6px 8px;border-radius:999px;color:#A7A3AE}" +
  "button:hover{background:#24242B;color:#F3F0E8}.c span,.c button{display:none}.c i{margin:0 3px}";

const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

export function standaloneTransport(win: Window, receive: (env: Envelope) => void): StandaloneTransport {
  const doc = win.document;
  let n = 0;
  let gameId = "local";
  let order: "asc" | "desc" = "desc";
  let phase: "PREVIEW" | "PLAYING" | "ENDED" = "PREVIEW";
  let paused = false;
  let userPaused = false;
  let muted = false;
  let score: number | null = null;
  let hud: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let collapsed = false;

  const store = (() => {
    try {
      return win.localStorage;
    } catch {
      return null;
    }
  })();
  const key = (k: string) => `tc:${gameId}:${k}`;
  const read = (k: string): Json | null => {
    try {
      const raw = store?.getItem(key(k));
      return raw == null ? null : (JSON.parse(raw) as Json);
    } catch {
      return null;
    }
  };
  const write = (k: string, v: Json) => {
    try {
      store?.setItem(key(k), JSON.stringify(v));
    } catch {
      /* quota or privacy mode: storage is best effort in standalone */
    }
  };
  const best = () => {
    const b = read("__best");
    return typeof b === "number" ? b : null;
  };

  const deliver = (type: string, payload?: unknown, replyTo?: string) => {
    const env: Envelope = { ch: CHANNEL, v: PROTOCOL_VERSION, id: `s${++n}`, type };
    if (payload !== undefined) env.payload = payload;
    if (replyTo) env.replyTo = replyTo;
    win.setTimeout(() => receive(env), 0);
  };
  const reply = (req: Envelope, result: unknown) => deliver("reply", { ok: true, result }, req.id);

  const insets = (current: "preview" | "play"): InsetSet => ({ preview: ZERO, play: ZERO, current });

  const pause = (reason: PauseReason) => {
    if (paused) return;
    paused = true;
    deliver("pause", { reason });
    render();
  };
  const resume = () => {
    if (!paused) return;
    paused = false;
    deliver("resume");
    render();
  };

  function render() {
    if (!label || !hud) return;
    const b = best();
    label.textContent =
      (paused ? "Paused" : phase) + (phase === "ENDED" && score !== null ? ` ${score}` : "") + (b !== null ? ` · best ${b}` : "");
    const dot = hud.shadowRoot?.querySelector("i") as HTMLElement | null;
    if (dot) dot.style.background = paused ? "#FF4A3D" : phase === "PLAYING" ? "#D4FF3D" : "#A7A3AE";
    const btn = (a: string) => hud?.shadowRoot?.querySelector(`[data-a=${a}]`) as HTMLElement | null;
    const p = btn("pause");
    if (p) p.textContent = paused ? "Resume" : "Pause";
    const m = btn("mute");
    if (m) m.textContent = muted ? "Unmute" : "Mute";
    const r = btn("replay");
    if (r) r.style.display = phase === "ENDED" && !collapsed ? "" : "none";
    hud.shadowRoot?.firstElementChild?.nextElementSibling?.classList.toggle("c", collapsed);
  }

  function mountHud() {
    if (hud || !doc.body) return;
    hud = doc.createElement("div");
    hud.id = "tc-dev-hud";
    const root = hud.attachShadow({ mode: "open" });
    root.innerHTML =
      `<style>${HUD_CSS}</style><div class="b" title="Thumbcade standalone host"><i data-a="fold"></i><span></span>` +
      `<button data-a="pause"></button><button data-a="mute"></button><button data-a="replay">Replay</button></div>`;
    label = root.querySelector("span");
    doc.body.appendChild(hud);
    render();
  }

  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) pause("background");
    else if (!userPaused) resume();
  });

  try {
    win
      .fetch("thumbcade.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { id?: string; score?: { order?: string } } | null) => {
        if (m?.score?.order === "asc") order = "asc";
        if (typeof m?.id === "string" && gameId === "local") gameId = m.id;
      })
      .catch(() => undefined);
  } catch {
    /* fetch unavailable: defaults are fine */
  }

  return {
    kind: "standalone",
    get hud() {
      return hud;
    },
    onHud(e: Event) {
      if (e.type !== "pointerup") return;
      const a = (e.composedPath()[0] as HTMLElement | undefined)?.getAttribute?.("data-a");
      if (a === "fold") collapsed = !collapsed;
      else if (a === "pause") {
        userPaused = !paused;
        if (paused) resume();
        else pause("user");
      } else if (a === "mute") {
        muted = !muted;
        deliver(muted ? "mute" : "unmute");
      } else if (a === "replay") deliver("replay");
      render();
    },
    send(env: Envelope) {
      const p = (env.payload ?? {}) as Record<string, unknown>;
      switch (env.type) {
        case "hello": {
          if (typeof p.manifestId === "string") gameId = p.manifestId;
          const ctx: LaunchContext = {
            sdkVersion: String(p.sdkVersion ?? ""),
            gameId,
            versionId: "local",
            player: { id: "standalone-player", name: "You", avatarUrl: null, guest: true },
            locale: win.navigator.language || "en-US",
            reducedMotion: !!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
            audio: { muted },
            insets: insets("preview"),
            launchReason: "dev",
            seed: (Math.random() * 2 ** 31) | 0,
            dailySeed: hash32(new Date().toISOString().slice(0, 10)),
            best: best(),
            host: "standalone",
          };
          reply(env, ctx);
          mountHud();
          break;
        }
        case "gameplay.start":
          if (p.trigger === "swipe") console.warn("[thumbcade] A run was started by a swipe. Runs must start with a tap.");
          phase = "PLAYING";
          deliver("insets", insets("play"));
          break;
        case "gameplay.end": {
          const s = Number(p.score);
          const b = best();
          score = s;
          if (Number.isFinite(s) && (b === null || (order === "asc" ? s < b : s > b))) write("__best", s);
          phase = "ENDED";
          deliver("insets", insets("preview"));
          break;
        }
        case "storage.get":
          reply(env, { value: read(String(p.key)) });
          break;
        case "storage.set":
          write(String(p.key), p.value as Json);
          reply(env, { ok: true });
          break;
        case "leaderboard.top": {
          const b = best();
          reply(env, { entries: b === null ? [] : [{ rank: 1, name: "You", avatarUrl: null, score: b, isMe: true }] });
          break;
        }
        case "leaderboard.me": {
          const b = best();
          reply(env, { best: b, rank: b === null ? null : 1, percentile: null });
          break;
        }
        case "share.challenge":
          reply(env, { shared: false });
          break;
      }
      render();
    },
    close() {
      hud?.remove();
      hud = null;
    },
  };
}
