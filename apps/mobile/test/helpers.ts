import { CHANNEL, PROTOCOL_VERSION, type FeedCard } from "@thumbcade/protocol";
import { CardController, type CardDeps } from "../src/feed/controller";

export const GAME_ID = "11111111-1111-4111-8111-111111111111";
export const VERSION_ID = "22222222-2222-4222-8222-222222222222";

export function card(vertical = false): FeedCard {
  return {
    cardId: "feed1:0",
    game: {
      id: GAME_ID,
      slug: "duskrail",
      name: "Duskrail",
      description: "Three lanes.",
      iconUrl: null,
      posterUrl: null,
      accentColor: "#FF6A1A",
      tags: ["runner"],
      ageRating: "9+",
      controls: { vertical, horizontal: false, multitouch: false, inputs: ["tap"] },
      session: "short",
      audio: true,
      score: { order: "desc", max: 1000, format: "integer" },
      stats: { plays: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
    },
    version: { id: VERSION_ID, semver: "1.0.0", entryUrl: "http://127.0.0.1:5555/duskrail/v/index.html", origin: "http://127.0.0.1:5555", sdkMajor: 1 },
    creator: { id: "33333333-3333-4333-8333-333333333333", handle: "kai", displayName: "Kai", avatarUrl: null, avatarSeed: "kai", verified: false },
    viewer: { liked: false, saved: false, followingCreator: false, best: null },
    topScore: null,
    rank: { source: "personal" },
  };
}

export interface Harness {
  ctl: CardController;
  sent: { type: string; payload?: unknown; replyTo?: string }[];
  tracked: { type: string; [k: string]: unknown }[];
  deps: CardDeps;
  now: { t: number };
  timers: { fn: () => void; at: number; id: number }[];
  advance: (ms: number) => void;
  game: (type: string, payload?: unknown, id?: string) => void;
  flush: () => Promise<void>;
}

export function harness(opts: { vertical?: boolean; best?: number | null; sessionEnd?: Partial<Awaited<ReturnType<CardDeps["sessionEnd"]>>> } = {}): Harness {
  const now = { t: 1_000_000 };
  const timers: Harness["timers"] = [];
  let nextId = 1;
  const sent: Harness["sent"] = [];
  const tracked: Harness["tracked"] = [];
  const c = card(opts.vertical);
  if (opts.best !== undefined) c.viewer.best = opts.best;
  const deps: CardDeps = {
    now: () => now.t,
    setTimer: (fn, ms) => {
      const t = { fn, at: now.t + ms, id: nextId++ };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    insets: () => ({ preview: { top: 103, right: 72, bottom: 148, left: 0 }, play: { top: 59, right: 0, bottom: 0, left: 0 } }),
    launch: async () => ({
      player: { id: "p_abcdefabcdefabcdefabcdef", name: "Guest", avatarUrl: null, guest: true },
      locale: "en-US",
      reducedMotion: false,
      muted: true,
      insets: { preview: { top: 103, right: 72, bottom: 148, left: 0 }, play: { top: 59, right: 0, bottom: 0, left: 0 } },
      host: "ios",
    }),
    sessionStart: jest.fn(async () => ({ sessionId: "44444444-4444-4444-8444-444444444444", token: "tok" })),
    sessionEnd: jest.fn(async () => ({ accepted: true, best: 120, isNewBest: true, percentile: 91, dailyRank: 3, ...opts.sessionEnd })),
    sessionProgress: jest.fn(async (req: { activeMs: number }) => ({ activeMs: req.activeMs, qualified: req.activeMs >= 3000 })),
    storageGet: jest.fn(async () => ({ best: 3 })),
    storageSet: jest.fn(async () => undefined),
    leaderboardTop: jest.fn(async () => []),
    leaderboardMe: jest.fn(async () => ({ best: null, rank: null, percentile: null })),
    feedback: jest.fn(),
    shareChallenge: jest.fn(async () => true),
    track: (e) => tracked.push(e as Harness["tracked"][number]),
    dev: false,
  };
  const ctl = new CardController(c, deps);
  ctl.attach((js) => {
    const m = /data:(.*)\}\)\);true;$/.exec(js);
    sent.push(JSON.parse(m![1]!));
  });
  let n = 0;
  return {
    ctl,
    sent,
    tracked,
    deps,
    now,
    timers,
    advance: (ms) => {
      now.t += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at <= now.t && timers.includes(t)) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
    game: (type, payload, id) => ctl.onMessage(JSON.stringify({ ch: CHANNEL, v: PROTOCOL_VERSION, id: id ?? `g${++n}`, type, ...(payload === undefined ? null : { payload }) })),
    flush: () => new Promise((r) => setTimeout(r, 0)),
  };
}

export async function boot(h: Harness, active = true) {
  h.ctl.loadStarted();
  if (active) h.ctl.activate();
  h.game("hello", { sdkVersion: "1.0.0" }, "hello1");
  await h.flush();
  h.game("ready");
}
