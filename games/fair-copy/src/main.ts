import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { adjacent, CELLS, colOf, N, points, rowOf, spell, timeBack, type Rated } from "./board.ts";
import blocked from "./data/blocked.json";
import acceptUrl from "./data/accept.txt?url";
import commonUrl from "./data/common.txt?url";
import { dealBoard, lexicon, type Blocked } from "./deal.ts";
import { SortedWords } from "./lexicon.ts";
import { drawNib } from "./nib.ts";
import { SKILLS, WordPilot } from "./pilot.ts";
import { drawPrompt, drawRuns, drawSeal, drawTitleBlock, easeInOut, easeOut, fitText, handRule, inkStroke, makeSeal, type Seal, Smudges, titleBlockHeight, titlePx } from "./qm/ink.ts";
import { BLUE, GRAPHITE, INK, italic, PAPER, PENCIL, rgba, SEAL, serif } from "./qm/palette.ts";
import { createSurface } from "./qm/paper.ts";
import { createSound, scaleNote } from "./qm/sound.ts";
import { issueNumber, loadSerif, roman, words } from "./qm/type.ts";
import { Round, TUNE, type Verdict } from "./round.ts";

const TITLE = "Fair Copy";
/** Share of a tile's width around its centre that picks it up during a drag. The corners stay dead, so a diagonal
 * stroke never snags the two tiles beside it. */
const CORE = 0.42;
/** Seconds a result stays in the preview line. */
const SHOW = 1.3;

type PreviewState = "live" | "word" | "again" | "unknown" | "short" | "checking" | "none";

interface Fly {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  color: string;
  px: number;
  onLand?: () => void;
}

interface Rect {
  x: number;
  y: number;
  s: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** A score that rolls up to its target. */
class Roll {
  shown = 0;
  target = 0;
  update(dt: number) {
    const d = this.target - this.shown;
    this.shown = Math.abs(d) < 0.5 ? this.target : this.shown + d * (1 - Math.exp(-12 * dt));
  }
}

async function main() {
  const [session, , commonText] = await Promise.all([
    createSession({ id: "fair-copy" }),
    loadSerif(),
    fetch(commonUrl).then((r) => r.text()),
  ]);
  const lex = lexicon(commonText, blocked as Blocked);
  const view = createSurface();
  const { ctx } = view;
  const sound = createSound();
  const reduced = session.reducedMotion;
  const smudges = new Smudges();
  const ink = new Particles(260);
  const shake = new Shake(5, 0.008, 2.2, reduced);
  /** A held breath on the big moments: the ink and the stamp stop for a few frames (the clock never does). */
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const tint = light.flash({ alpha: 0.12, decay: 0.9 });
  const issue = issueNumber();
  let W = view.width;
  let H = view.height;
  const seals = new Map<string, Seal>();
  const sealFor = (text: string, size = 64) => {
    const key = `${text}:${size}`;
    let s = seals.get(key);
    if (!s) seals.set(key, (s = makeSeal(text, size, view.dpr, text.length + 7)));
    return s;
  };
  view.onResize(() => {
    W = view.width;
    H = view.height;
    seals.clear();
  });

  // The broad list loads after the first frame. Until it is in, the common list answers, and a word it doesn't know
  // is never turned away: it waits ("checking the dictionary") and is judged the moment the list arrives. The load
  // retries for as long as it takes.
  let accept: SortedWords | null = null;
  let pending: number[][] = [];
  const loadAccept = (wait = 2000) =>
    fetch(acceptUrl)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((t) => {
        accept = new SortedWords(t);
        const p = pending;
        pending = [];
        for (const path of p) resolve(path, true);
      })
      .catch(() => window.setTimeout(() => void loadAccept(Math.min(10_000, wait * 2)), wait));
  const isWord = (w: string) => (accept ? accept.has(w) : lex.trie.has(w));

  let taught = false;
  try {
    taught = (await tc.storage.get<boolean>("taught")) === true;
  } catch {
    /* guest or offline */
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let time = 0;
  let layoutK = 0;
  let layoutTarget = 0;
  let rated: Rated = dealBoard(lex, createRng(session.ctx.dailySeed ^ 0xfa1c));
  let round: Round | null = null;
  let path: number[] = [];
  let dragging = false;
  let finger: [number, number] = [0, 0];
  let lastPt: [number, number] = [0, 0];
  let peekState: PreviewState = "none";
  let preview: { word: string; state: PreviewState; t: number; points: number; secs: number; longest?: boolean } = { word: "", state: "none", t: -10, points: 0, secs: 0 };
  const shakeT = { t: -10 };
  const selectedAt = new Float32Array(CELLS).fill(-10);
  const dryAt = new Float32Array(CELLS).fill(-10);
  const inkedAt = new Float32Array(CELLS).fill(-10);
  let flies: Fly[] = [];
  const score = new Roll();
  let scoreBump = 0;
  let clockBump = 0;
  let lastSeal: { text: string; t: number } | null = null;
  let againAt: { word: string; t: number } | null = null;
  let ended = false;
  let endT = 0;
  let endSent = false;
  let isBest = false;
  let summary: string[] = [];
  let missed: Array<{ word: string; path: number[] }> = [];
  let lastWhole = 0;
  let firstWordDone = false;
  let usedDiagonal = false;
  let startT = 0;

  // The demo: the pen finds words on today's board by itself.
  const demo = {
    pilot: new WordPilot({ ...SKILLS.skilled, every: [1.1, 1.8], byLength: [0, 0, 0, 0.3, 1, 1, 0.8, 0.5, 0.2] }, createRng(session.ctx.dailySeed ^ 0xbead)),
    found: new Set<string>(),
    trace: null as null | { word: string; path: number[]; k: number },
    score: 0,
  };

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  function attractFrame(): Rect & { L: number; R: number; top: number } {
    const ins = session.preview();
    const L = ins.left + 26;
    const R = W - Math.max(ins.right + 8, 24);
    const top = ins.top + 20;
    const y = top + titleBlockHeight(titlePx(ctx, TITLE, R - L)) + 22;
    const s = Math.max(150, Math.min(R - L - 30, H - ins.bottom - y - 110, 292));
    return { x: L, y, s, L, R, top };
  }

  function playFrame(): Rect & { L: number; R: number; top: number; rule: number } {
    const ins = session.play();
    const L = ins.left + 22;
    const R = W - ins.right - 22;
    const top = ins.top + 12;
    const rule = top + 70;
    const y = rule + 96;
    const s = Math.max(200, Math.min(R - L, H - y - 196));
    return { x: (W - s) / 2, y, s, L, R, top, rule };
  }

  /** The summary slip after a run: just above the caption in the feed (the result card covers the upper half). */
  const SLIP_LINE = 21;
  function slipRect(lines = 4): { x: number; y: number; w: number; h: number } {
    const ins = session.preview();
    const x = ins.left + 12;
    const w = W - ins.right - 8 - x;
    const h = SLIP_LINE * lines + 22;
    const bottom = session.standalone ? H - 64 : H - ins.bottom - 10;
    return { x, y: bottom - h, w, h };
  }

  /** After the bell the board shrinks in place until it clears the slip, so the missed-word traces stay whole. */
  function overFrame(p: Rect): Rect {
    const s = Math.max(150, Math.min(p.s, slipRect().y - 12 - p.y));
    return { x: (W - s) / 2, y: p.y, s };
  }

  function frame(): Rect {
    const a = attractFrame();
    let p: Rect = playFrame();
    if (ended) {
      const o = overFrame(p);
      const e = reduced ? 1 : easeInOut(clamp01(endT / 0.35));
      p = { x: lerp(p.x, o.x, e), y: lerp(p.y, o.y, e), s: lerp(p.s, o.s, e) };
    }
    const k = reduced ? (layoutK > 0.5 ? 1 : 0) : easeInOut(layoutK);
    return { x: lerp(a.x, p.x, k), y: lerp(a.y, p.y, k), s: lerp(a.s, p.s, k) };
  }

  /** Tile geometry inside the frame: origin and cell size. */
  function grid(f: Rect = frame()): { x: number; y: number; c: number } {
    const pad = f.s * 0.045;
    return { x: f.x + pad, y: f.y + pad, c: (f.s - pad * 2) / N };
  }
  const centre = (g: { x: number; y: number; c: number }, i: number): [number, number] => [g.x + (colOf(i) + 0.5) * g.c, g.y + (rowOf(i) + 0.5) * g.c];

  // ---------------------------------------------------------------------------
  // Input: press on a tile and drag through its neighbours; let go to write the word.
  // ---------------------------------------------------------------------------
  const canTrace = () => session.phase === "playing" && round !== null && !ended;

  function tileAtStart(x: number, y: number): number {
    const g = grid();
    const pad = g.c * 0.2;
    if (x < g.x - pad || y < g.y - pad || x > g.x + g.c * N + pad || y > g.y + g.c * N + pad) return -1;
    const c = Math.max(0, Math.min(N - 1, Math.floor((x - g.x) / g.c)));
    const r = Math.max(0, Math.min(N - 1, Math.floor((y - g.y) / g.c)));
    return r * N + c;
  }

  function tileAtCore(x: number, y: number): number {
    const g = grid();
    const c = Math.floor((x - g.x) / g.c);
    const r = Math.floor((y - g.y) / g.c);
    if (c < 0 || r < 0 || c >= N || r >= N) return -1;
    const i = r * N + c;
    const [cx, cy] = centre(g, i);
    return Math.hypot(x - cx, y - cy) <= g.c * CORE ? i : -1;
  }

  function tick() {
    sound.pluck(scaleNote(Math.min(14, path.length - 1), 62), 0.55 + Math.min(0.4, path.length * 0.04));
  }

  function onPath() {
    peekState = path.length && round ? (round.peek(path) === "word" ? "word" : round.peek(path) === "again" ? "again" : "live") : "none";
  }

  function consider(x: number, y: number) {
    const t = tileAtCore(x, y);
    if (t < 0 || !path.length) return;
    const head = path[path.length - 1]!;
    if (t === head) return;
    if (path.length >= 2 && t === path[path.length - 2]) {
      // Back over the last tile: the stroke lifts off the head.
      path.pop();
      sound.rustle(0.35);
      onPath();
      return;
    }
    if (path.includes(t) || !adjacent(head, t)) return;
    path.push(t);
    selectedAt[t] = time;
    tick();
    onPath();
  }

  /** Walks the finger's way from the last sample, so a fast stroke can't skip a tile. */
  function track(x: number, y: number) {
    const g = grid();
    const d = Math.hypot(x - lastPt[0], y - lastPt[1]);
    const n = Math.max(1, Math.ceil(d / (g.c * 0.12)));
    for (let k = 1; k <= n; k++) consider(lerp(lastPt[0], x, k / n), lerp(lastPt[1], y, k / n));
    lastPt = [x, y];
    finger = [x, y];
  }

  let pointer = -1;
  window.addEventListener("pointerdown", (e) => {
    sound.unlock();
    if (pointer >= 0 || !canTrace()) return;
    const t = tileAtStart(e.clientX, e.clientY);
    if (t < 0) return;
    pointer = e.pointerId;
    dragging = true;
    path = [t];
    selectedAt[t] = time;
    finger = lastPt = [e.clientX, e.clientY];
    tick();
    onPath();
  });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointer || !dragging) return;
    track(e.clientX, e.clientY);
  });
  window.addEventListener("pointerup", (e) => {
    if (e.pointerId !== pointer) return;
    pointer = -1;
    if (!dragging) return;
    dragging = false;
    track(e.clientX, e.clientY);
    submit();
  });
  const cancel = () => {
    pointer = -1;
    dragging = false;
    path = [];
    peekState = "none";
  };
  window.addEventListener("pointercancel", cancel);
  session.on("cancel", cancel);
  session.startOnTap(window);

  function show(word: string, state: PreviewState, pts = 0, secs = 0) {
    preview = { word, state, t: time, points: pts, secs };
  }

  function submit() {
    const p = path;
    path = [];
    peekState = "none";
    if (!round || ended) return;
    if (p.length < 3) {
      if (p.length === 2) show(spell(round.board, p), "short");
      return;
    }
    const w = spell(round.board, p);
    if (!accept && !lex.trie.has(w) && !round.found.has(w)) {
      pending.push(p);
      show(w, "checking");
      return;
    }
    resolve(p);
  }

  /** Judges a path. A word that waited for the dictionary still counts after the bell, until the round is reported. */
  function resolve(p: number[], late = false) {
    if (!round || endSent || (ended && !late)) return;
    react(round.submit(p, { late }), p);
  }

  // ---------------------------------------------------------------------------
  // What a verdict looks and sounds like
  // ---------------------------------------------------------------------------
  const scorePos = () => {
    const f = playFrame();
    return { x: f.R - 12, y: f.top + 26 };
  };
  const previewPos = () => {
    const f = playFrame();
    return { x: W / 2, y: f.rule + 46 };
  };
  const clockPos = () => {
    const f = frame();
    return { x: playFrame().L + 18, y: f.y + f.s + 34 };
  };

  function fly(text: string, from: { x: number; y: number }, to: { x: number; y: number }, color: string, px: number, onLand?: () => void, delay = 0) {
    flies.push({ text, x0: from.x, y0: from.y, x1: to.x, y1: to.y, t: -delay, dur: reduced ? 0.5 : 0.7, color, px, onLand });
  }

  function react(v: Verdict, p: number[]) {
    const g = grid();
    const [hx, hy] = centre(g, p[p.length - 1]!);
    if (v.kind === "unknown") {
      show(v.word, "unknown");
      shakeT.t = time;
      smudges.add(hx, hy, g.c * 0.32);
      sound.smudge();
      return;
    }
    if (v.kind === "again") {
      show(v.word, "again");
      againAt = { word: v.word, t: time };
      sound.rustle(0.6);
      return;
    }
    if (v.kind === "short") return;
    // A word: stamp it, ink its tiles, send the points to the score.
    show(v.word, "word", v.points, v.seconds);
    for (const i of p) {
      dryAt[i] = time;
      if (inkedAt[i]! < 0) inkedAt[i] = time + 0.15;
    }
    for (let k = 1; k < p.length; k++) if (rowOf(p[k]!) !== rowOf(p[k - 1]!) && colOf(p[k]!) !== colOf(p[k - 1]!)) usedDiagonal = true;
    const len = v.word.length;
    sound.stamp(0.8 + Math.min(0.5, len * 0.05));
    window.setTimeout(() => sound.pluck(scaleNote(Math.min(14, len + 2), 62), 0.9), 60);
    if (len >= 6) sound.bell(76 + Math.min(8, (len - 6) * 2));
    // The longest word the page holds gets a line of its own.
    const longest = rated.words.has(v.word) && v.word.length >= rated.longest.length;
    if (longest) {
      preview.longest = true;
      window.setTimeout(() => sound.bell(88), 180);
    }
    if (!reduced && (len >= 7 || longest || v.inked)) hitStop.freeze(len >= 8 || v.inked ? 0.09 : 0.06);
    const pv = previewPos();
    fly(`+${v.points}`, { x: pv.x + 70, y: pv.y - 4 }, scorePos(), SEAL, 22 + Math.min(10, v.points), () => {
      score.target = Math.min(round?.score ?? 0, score.target + v.points);
      scoreBump = 1;
    });
    if (v.seconds > 0) fly(`+${v.seconds}s`, { x: pv.x - 70, y: pv.y - 4 }, clockPos(), BLUE, 18, () => (clockBump = 1), 0.12);
    session.feedback(len >= 6 ? "success" : "tap");
    if (len >= 6) {
      shake.add(0.25 + Math.min(0.25, (len - 6) * 0.08));
      for (const i of p) {
        const [x, y] = centre(g, i);
        ink.emit(x, y, { count: reduced ? 2 : 5, speed: [30, 140], life: [0.3, 0.7], size: [2, 5], colors: [BLUE, INK], drag: 4, shape: "circle", gravity: 160 });
      }
    }
    if (v.seal) {
      lastSeal = { text: roman(v.seal), t: time + 0.35 };
      window.setTimeout(() => sound.bell(72 + ((v.seal! / TUNE.sealEvery) % 4) * 2), 350);
    }
    if (v.inked) {
      tint.trigger(BLUE, 1);
      shake.add(0.3);
      window.setTimeout(() => sound.bell(84), 200);
      for (let i = 0; i < CELLS; i++) inkedAt[i] = time + 0.05 * (rowOf(i) + colOf(i));
      tc.analytics.track("milestone", { inked: 1 });
    }
    if (!firstWordDone) {
      firstWordDone = true;
      if (!taught) {
        taught = true;
        tc.storage.set("taught", true).catch(() => undefined);
        tc.analytics.track("tutorial_complete");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The run
  // ---------------------------------------------------------------------------
  session.on("start", () => {
    rated = dealBoard(lex, createRng((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0));
    round = new Round(rated.board, isWord);
    path = [];
    dragging = false;
    pending = [];
    flies = [];
    score.shown = score.target = 0;
    selectedAt.fill(-10);
    dryAt.fill(-10);
    inkedAt.fill(-10);
    lastSeal = null;
    againAt = null;
    ended = false;
    endT = 0;
    endSent = false;
    isBest = false;
    summary = [];
    missed = [];
    lastWhole = Math.ceil(round.clock);
    firstWordDone = false;
    usedDiagonal = false;
    startT = 0;
    show("", "none");
    smudges.clear();
    layoutTarget = 1;
    sound.rustle();
  });

  function finish() {
    if (!round) return;
    ended = true;
    endT = 0;
    cancel();
    sound.bell(57);
    const s = round.stats;
    const best = session.best;
    isBest = round.score > 0 && (best === null || round.score > best);
    // Missed: everyday words first, longest first. Never anything outside the common list.
    const left = [...rated.words].filter(([w]) => !round!.found.has(w));
    left.sort((a, b) => Number(lex.everyday.has(b[0])) - Number(lex.everyday.has(a[0])) || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));
    missed = left.slice(0, 3).map(([word, p]) => ({ word, path: p }));
    const plurals = [...round.found.keys()].filter((w) => w.endsWith("s")).length;
    const hint =
      s.words < 6
        ? "three letters are enough. the small words add up."
        : s.longest < 5
          ? "look for -ing, -er and -ed. long words buy back time."
          : !usedDiagonal
            ? "letters join corner to corner, too."
            : plurals < 2 && s.words >= 8
              ? "an s on the end is often a second word."
              : round.allInked
                ? `the longest word on this page was ${rated.longest}.`
                : "use every letter once and the page gives you three seconds.";
    const pts = round.score;
    const ptsWord = `${words(pts)} ${pts === 1 ? "point" : "points"}`;
    const line1 = isBest
      ? best === null || best <= 0
        ? `${ptsWord}. the first page in the book.`
        : `${ptsWord}. a new best, by ${words(pts - best)}.`
      : best === null || best <= 0
        ? "no points yet. one word starts the page."
        : pts === best
          ? `${ptsWord}. level with your best.`
          : `${ptsWord}. ${words(best - pts)} shy of your best.`;
    summary = [
      line1,
      s.bestWord ? `best word: ${s.bestWord}, ${words(s.bestPoints)} ${s.bestPoints === 1 ? "point" : "points"}.` : "no words this time.",
      missed.length ? `missed: ${missed.map((m) => m.word).join(", ")}.` : "you missed nothing we know.",
      `next time: ${hint}`,
    ];
    if (isBest) window.setTimeout(() => sound.bell(81), 300);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function updateDemo(dt: number) {
    const d = demo;
    if (!d.trace) {
      if (d.pilot.tick(dt)) {
        if (d.found.size >= 9) d.found.clear();
        const pick = d.pilot.choose(rated, lex.everyday, d.found, (w) => w.length >= 4);
        if (pick) d.trace = { word: pick.word, path: pick.path, k: 0 };
      }
      return;
    }
    const before = Math.floor(d.trace.k);
    d.trace.k += dt * 5.2;
    const now = Math.floor(d.trace.k);
    if (now > before && now < d.trace.path.length) {
      selectedAt[d.trace.path[now]!] = time;
      sound.pluck(scaleNote(Math.min(14, now), 62), 0.4);
    }
    if (d.trace.k >= d.trace.path.length - 1 + 0.35) {
      const w = d.trace.word;
      d.found.add(w);
      d.score += points(w.length);
      show(w, "word", points(w.length), timeBack(w.length));
      for (const i of d.trace.path) dryAt[i] = time;
      sound.stamp(0.6);
      d.trace = null;
    }
  }

  function update(rawDt: number) {
    const dt = hitStop.scale(Math.min(rawDt, 0.1));
    session.tick(rawDt);
    time += dt;
    smudges.update(dt);
    ink.update(dt);
    shake.update(dt);
    tint.update(dt);
    score.update(dt);
    scoreBump = Math.max(0, scoreBump - dt * 4);
    clockBump = Math.max(0, clockBump - dt * 3);
    const lk = reduced ? 3 : 1.6;
    layoutK = layoutTarget > layoutK ? Math.min(layoutTarget, layoutK + dt * lk) : Math.max(layoutTarget, layoutK - dt * lk);
    for (const f of flies) {
      const before = f.t;
      f.t += dt;
      if (before < f.dur && f.t >= f.dur) f.onLand?.();
    }
    flies = flies.filter((f) => f.t < f.dur + 0.05);

    if (session.runs === 0) updateDemo(dt);
    if (session.phase !== "playing" || !round) {
      if (ended) endT += dt;
      return;
    }
    startT += dt;
    if (ended) {
      endT += dt;
      if (!endSent && endT >= 0.95) {
        // Words still waiting for a dictionary that hasn't arrived by now get the benefit of the doubt.
        if (pending.length) {
          const p = pending;
          pending = [];
          for (const path of p) react(round.submit(path, { late: true, trust: true }), path);
          score.target = round.score;
        }
        endSent = true;
        const s = round.stats;
        session.end(round.score, { outcome: "lose", stats: { words: s.words, longest: s.longest, seconds: Math.round(s.seconds) } });
      }
      return;
    }
    // A real word still under the finger when the bell goes is written down, not lost.
    if (dragging && round.clock - rawDt <= 0 && path.length >= 3 && round.peek(path) === "word") {
      dragging = false;
      pointer = -1;
      submit();
    }
    if (round.step(rawDt)) {
      score.target = round.score;
      finish();
      return;
    }
    const whole = Math.ceil(round.clock);
    if (whole !== lastWhole) {
      lastWhole = whole;
      if (whole <= 10 && whole > 0) sound.tick();
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function perimeterPoint(f: Rect, t: number): [number, number] {
    let d = clamp01(t) * f.s * 4;
    if (d <= f.s) return [f.x + d, f.y];
    d -= f.s;
    if (d <= f.s) return [f.x + f.s, f.y + d];
    d -= f.s;
    if (d <= f.s) return [f.x + f.s - d, f.y + f.s];
    d -= f.s;
    return [f.x, f.y + f.s - d];
  }

  /** The frame burns down as the clock does, an ember travelling round its edge. */
  function drawFrame(f: Rect, frac: number, burning: boolean) {
    if (frac < 1) {
      ctx.save();
      ctx.setLineDash([1, 4]);
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.s, f.s);
      ctx.strokeStyle = rgba(PENCIL, 0.55);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
    if (frac <= 0) return;
    const corners: Array<[number, number]> = [
      [f.x + f.s, f.y],
      [f.x + f.s, f.y + f.s],
      [f.x, f.y + f.s],
      [f.x, f.y],
    ];
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    let left = Math.min(1, frac) * f.s * 4;
    let px = f.x;
    let py = f.y;
    for (const [cx, cy] of corners) {
      const seg = Math.hypot(cx - px, cy - py);
      if (left >= seg) {
        ctx.lineTo(cx, cy);
        left -= seg;
        px = cx;
        py = cy;
      } else {
        ctx.lineTo(px + ((cx - px) * left) / seg, py + ((cy - py) * left) / seg);
        break;
      }
    }
    inkStroke(ctx, 1.7 + clockBump * 1.2, INK, 0.92);
    if (!burning || frac >= 1) return;
    const [ex, ey] = perimeterPoint(f, frac);
    ctx.fillStyle = rgba(SEAL, 0.95);
    ctx.beginPath();
    ctx.arc(ex, ey, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    const sway = reduced ? 0 : Math.sin(time * 1.7) * 3;
    ctx.moveTo(ex, ey - 3);
    ctx.bezierCurveTo(ex + 3 + sway, ey - 8, ex - 4 + sway, ey - 13, ex + 1 + sway * 1.4, ey - 19);
    ctx.strokeStyle = rgba(GRAPHITE, 0.22);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  /** An ink blot behind a tile's letter: a few overlapping discs so the edge isn't a perfect circle. */
  function blot(x: number, y: number, r: number, seed: number, color: string, alpha: number) {
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      const a = seed * 2.3 + k * 2.1;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.22, y + Math.sin(a) * r * 0.2, r * (0.78 + 0.06 * k), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function letter(t: string, x: number, y: number, px: number, color: string) {
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (t === "qu") {
      ctx.font = serif(px);
      const qw = ctx.measureText("Q").width;
      ctx.font = serif(px * 0.62);
      const uw = ctx.measureText("u").width;
      const x0 = x - (qw + uw) / 2;
      ctx.textAlign = "left";
      ctx.font = serif(px);
      ctx.fillText("Q", x0, y + px * 0.34);
      ctx.font = serif(px * 0.62);
      ctx.fillText("u", x0 + qw, y + px * 0.34);
      return;
    }
    ctx.font = serif(px);
    ctx.fillText(t.toUpperCase(), x, y + px * 0.34);
  }

  /** A letter in ink, knocked out to paper wherever the blot (radius r) lies under it. */
  function knockout(t: string, x: number, y: number, px: number, r: number) {
    letter(t, x, y, px, INK);
    if (r < 1) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.96, 0, Math.PI * 2);
    ctx.clip();
    letter(t, x, y, px, PAPER);
    ctx.restore();
  }

  function drawBoard(alpha: number, trace: number[], tail: [number, number] | null, valid: boolean) {
    const g = grid();
    const b = rated.board;
    const px = g.c * 0.56;
    ctx.globalAlpha = alpha;
    // Tiles: softly ruled squares, like type in a tray.
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = centre(g, i);
      const s = g.c * 0.88;
      ctx.fillStyle = rgba(INK, 0.03);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeStyle = rgba(GRAPHITE, 0.3);
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x - s / 2 + 0.5, y - s / 2 + 0.5, s - 1, s - 1);
      // A letter used in a word is underlined in ink: what's left unused is easy to see (all sixteen pay a bonus).
      const ik = time - inkedAt[i]!;
      if (round && inkedAt[i]! > -5 && ik >= 0) handRule(ctx, x - g.c * 0.19, x + g.c * 0.19, y + g.c * 0.31, reduced ? 1 : easeOut(ik / 0.3), Math.max(1.4, g.c * 0.022), BLUE, 0.7, i * 1.7);
    }
    // The stroke: blue-black ink through the chosen tiles, out to the finger.
    const pts = trace.map((i) => centre(g, i));
    if (tail && pts.length) {
      const [hx, hy] = pts[pts.length - 1]!;
      const dx = tail[0] - hx;
      const dy = tail[1] - hy;
      const d = Math.hypot(dx, dy);
      const max = g.c * 0.55;
      pts.push(d > max ? [hx + (dx / d) * max, hy + (dy / d) * max] : tail);
    }
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]![0], pts[k]![1]);
      inkStroke(ctx, g.c * 0.15, valid ? INK : BLUE, 0.85);
    }
    const chosen = new Set(trace);
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = centre(g, i);
      const sel = chosen.has(i);
      const dry = time - dryAt[i]!;
      if (sel) {
        const k = reduced ? 1 : 0.75 + 0.25 * easeOut((time - selectedAt[i]!) / 0.09);
        blot(x, y, g.c * 0.36 * k, i, valid ? INK : BLUE, 0.93);
        knockout(b[i]!, x, y, px, g.c * 0.36 * k);
      } else if (dry < 0.32) {
        // Ink that was just stamped soaks back into the page: the blot draws in quickly, then lets go.
        const k = 1 - easeOut(dry / 0.32);
        blot(x, y, g.c * 0.36 * k, i, INK, 0.93 * (0.35 + 0.65 * k));
        knockout(b[i]!, x, y, px, g.c * 0.36 * k);
      } else letter(b[i]!, x, y, px, INK);
    }
    ctx.globalAlpha = 1;
  }

  /** The word being traced, or the verdict on the last one. */
  function drawPreview(alpha: number) {
    if (alpha <= 0 || !round) return;
    const pv = previewPos();
    // The line the word is written on.
    handRule(ctx, pv.x - W * 0.3, pv.x + W * 0.3, pv.y + 9, 1, 0.7, PENCIL, 0.55 * alpha, 7.3);
    // After the bell this line belongs to the missed words.
    if (ended && endT > 0.3) return;
    const live = dragging && path.length > 0;
    const word = live ? spell(round.board, path) : preview.word;
    const state: PreviewState = live ? peekState : preview.state;
    const age = time - preview.t;
    if (!live && (state === "none" || age > SHOW + 0.4)) return;
    const fade = live ? 1 : 1 - clamp01((age - SHOW) / 0.4);
    const text = word.toUpperCase();
    let px = 40;
    ctx.font = serif(px);
    const maxW = W - 60;
    const tw = ctx.measureText(text).width * 1.06;
    if (tw > maxW) px = Math.max(22, (px * maxW) / tw);
    let dx = 0;
    if (!live && state === "unknown" && !reduced) dx = Math.sin(age * 38) * 7 * Math.max(0, 1 - age / 0.45);
    let scale = 1;
    if (!live && state === "word" && !reduced) scale = 1 + 0.16 * (1 - easeOut(age / 0.22));
    ctx.save();
    ctx.globalAlpha = alpha * fade;
    ctx.translate(pv.x + dx, pv.y);
    ctx.scale(scale, scale);
    ctx.font = serif(px);
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px * 0.06}px`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const color = state === "word" ? INK : state === "again" || state === "short" ? PENCIL : state === "unknown" ? GRAPHITE : BLUE;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
    const w = ctx.measureText(text).width;
    if (state === "word") {
      // A vermilion rule under a real word, stamped for a finished one.
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha * fade;
      handRule(ctx, pv.x - w / 2 - 6, pv.x + w / 2 + 6, pv.y + 9, live ? 1 : reduced ? 1 : easeOut(age / 0.25), 1.6, SEAL, 0.9, 3.1);
    }
    ctx.restore();
    // The caption: length and value while tracing, then the verdict.
    const n = word.length;
    let cap = "";
    if (live) cap = n < 3 ? `${words(n)} ${n === 1 ? "letter" : "letters"}` : state === "word" ? `${words(n)} letters · ${words(points(n))} ${points(n) === 1 ? "point" : "points"}${timeBack(n) ? ` · ${words(timeBack(n))} back` : ""}` : state === "again" ? "already found" : `${words(n)} letters`;
    else if (state === "word" && preview.longest) cap = `the longest word on this page. ${words(preview.points)} points.`;
    else if (state === "word") cap = `${words(preview.points)} ${preview.points === 1 ? "point" : "points"}${preview.secs ? `, and ${words(preview.secs)} ${preview.secs === 1 ? "second" : "seconds"} back` : ""}.`;
    else if (state === "again") cap = "already found. it counts once.";
    else if (state === "unknown") cap = "not one we know.";
    else if (state === "short") cap = "three letters at least.";
    else if (state === "checking") cap = "checking the dictionary.";
    ctx.globalAlpha = alpha * fade;
    ctx.font = italic(16);
    ctx.textAlign = "center";
    ctx.fillStyle = rgba(state === "word" ? SEAL : GRAPHITE, 0.95);
    ctx.fillText(cap, pv.x, pv.y + 30);
    ctx.globalAlpha = 1;
  }

  function drawTitle(alpha: number) {
    if (alpha <= 0) return;
    const f = attractFrame();
    const block = { title: TITLE, kicker: `no. ${issue} · the ninety-second word`, dek: "trace the letters. the long words go further." };
    drawTitleBlock(ctx, block, f.L, f.top, f.R - f.L, time, alpha, reduced);
    const fr = frame();
    const by = fr.y + fr.s + 44;
    ctx.globalAlpha = alpha * clamp01((time - 0.9) / 0.8);
    ctx.fillStyle = GRAPHITE;
    ctx.font = italic(15);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const dw = demo.trace ? demo.trace.word : preview.word;
    ctx.fillText(dw ? `fig. the pen finds “${dw}”. ${words(demo.score)} points so far.` : "fig. the pen goes first, this once.", f.L, by);
    ctx.globalAlpha = 1;
    drawPrompt(ctx, "tap to begin", f.L, by + 40, time - 1.2, reduced, alpha * clamp01((time - 1) / 0.6), 21);
    if ((session.best ?? 0) > 0) {
      ctx.fillStyle = rgba(GRAPHITE, alpha);
      drawRuns(ctx, [["best ", italic(16)], [String(session.best), serif(17)]], f.R, by + 40, "right");
    }
    // The demo's word, stamped under the title.
    const age = time - preview.t;
    if (session.runs === 0 && preview.state === "word" && age < 1.4) {
      const a = alpha * (1 - clamp01((age - 1) / 0.4));
      drawSeal(ctx, sealFor(`+${preview.points}`, 44), fr.x + fr.s - 4, fr.y + fr.s + 2, 40, age, reduced, -0.08, a);
    }
  }

  function usedLetters(): number {
    let n = 0;
    for (let v = round?.inked ?? 0; v; v &= v - 1) n++;
    return n;
  }

  function statusLine(): string {
    if (!round) return "";
    if (ended) return round.found.size ? `time. ${words(round.found.size)} ${round.found.size === 1 ? "word" : "words"} on the page.` : "time. the page stays blank, for now.";
    if (startT < 5) return taught ? "find the long ones first." : "drag through the letters. let go to write it.";
    if (round.clock < 10) return "the last few seconds.";
    if (round.allInked) return "every letter used. three seconds back.";
    const used = usedLetters();
    if (used >= 10) return used === 15 ? "one letter left unused: use it for three seconds." : `use the last ${words(16 - used)} letters for three seconds.`;
    const n = round.found.size;
    return n ? `${words(n)} ${n === 1 ? "word" : "words"} so far.` : "any three letters in a row will do.";
  }

  function drawFound(x: number, y: number, maxW: number, maxY: number, alpha: number) {
    if (!round) return;
    const list = [...round.order].reverse();
    let cx = x;
    let cy = y;
    const lh = 24;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let shown = 0;
    for (const w of list) {
      const long = w.length >= 6;
      const font = long ? serif(19) : italic(18);
      ctx.font = font;
      const ww = ctx.measureText(w).width;
      const sep = shown ? 16 : 0;
      if (cx + sep + ww > x + maxW) {
        cx = x;
        cy += lh;
        if (cy > maxY) break;
      } else cx += sep;
      if (shown && cx !== x) {
        ctx.fillStyle = rgba(PENCIL, alpha);
        ctx.font = italic(16);
        ctx.fillText("·", cx - 11, cy);
        ctx.font = font;
      }
      ctx.fillStyle = rgba(long ? INK : GRAPHITE, alpha);
      ctx.fillText(w, cx, cy);
      if (againAt && againAt.word === w && time - againAt.t < 1.2) handRule(ctx, cx, cx + ww, cy + 5, reduced ? 1 : easeOut((time - againAt.t) / 0.3), 1, PENCIL, alpha * (1 - clamp01((time - againAt.t - 0.8) / 0.4)), 2);
      cx += ww;
      shown++;
    }
    const rest = list.length - shown;
    if (rest > 0 && cy <= maxY + lh) {
      ctx.fillStyle = rgba(GRAPHITE, alpha);
      ctx.font = italic(15);
      ctx.fillText(`and ${words(rest)} more`, x, Math.min(cy + lh, maxY + lh));
    }
  }

  function drawHud(alpha: number) {
    if (alpha <= 0 || !round) return;
    const f = playFrame();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.font = italic(28);
    ctx.fillText(TITLE, f.L, f.top + 32);
    ctx.fillStyle = GRAPHITE;
    ctx.font = italic(14);
    const best = Math.max(session.best ?? 0, ended ? round.score : 0);
    ctx.fillText(`no. ${issue} · four by four${best > 0 ? ` · best ${best}` : ""}`, f.L + 1, f.top + 54);
    ctx.textAlign = "right";
    ctx.fillStyle = INK;
    const sc = Math.round(score.shown);
    const s = 1 + scoreBump * 0.1;
    ctx.save();
    ctx.translate(f.R, f.top + 40);
    ctx.scale(s, s);
    ctx.font = serif(46);
    ctx.fillText(String(sc), 0, 0);
    ctx.restore();
    ctx.font = italic(14);
    ctx.fillStyle = GRAPHITE;
    ctx.fillText(sc === 1 ? "point" : "points", f.R, f.top + 58);
    handRule(ctx, f.L, f.R, f.rule, 1, 0.8, INK, 0.75 * alpha, 0.4);

    const fr = frame();
    const by = fr.y + fr.s + 40;
    const secs = Math.max(0, Math.ceil(round.clock));
    // After the bell the summary slip takes this space: the clock and the notes under it step aside.
    alpha *= ended ? 1 - clamp01((endT - 0.6) / 0.4) : 1;
    ctx.globalAlpha = alpha;
    ctx.textAlign = "left";
    ctx.font = serif(28);
    ctx.fillStyle = rgba(secs <= 10 && !ended ? SEAL : INK, alpha);
    ctx.fillText(String(secs), f.L, by);
    const nw = ctx.measureText(String(secs)).width;
    ctx.font = italic(16);
    ctx.fillStyle = rgba(GRAPHITE, alpha);
    ctx.fillText(secs === 1 ? "second" : "seconds", f.L + nw + 6, by);
    // How many of the sixteen letters have been used in a word (the underlined ones); all sixteen pay a bonus.
    const used = usedLetters();
    ctx.fillStyle = rgba(round.allInked ? SEAL : GRAPHITE, alpha);
    drawRuns(ctx, round.allInked ? [["all ", italic(16)], ["16", serif(18)], [" letters used", italic(16)]] : [["letters used ", italic(16)], [String(used), serif(18)], [" of 16", italic(16)]], f.R, by, "right");
    ctx.textAlign = "left";
    ctx.fillStyle = rgba(INK, 0.8 * alpha);
    fitText(ctx, statusLine(), f.L, by + 30, f.R - f.L, 17);
    if (!ended) drawFound(f.L, by + 62, f.R - f.L, H - 24, alpha);
    // The latest word-count seal sits on the frame's corner.
    if (lastSeal && !ended) drawSeal(ctx, sealFor(lastSeal.text, 56), fr.x + fr.s - 10, fr.y - 4, 42, time - lastSeal.t, reduced, -0.09, alpha);
    ctx.globalAlpha = 1;
  }

  /** The first-run hint: the pen traces a short word in pencil until the player writes one. */
  function drawTeach() {
    if (taught || firstWordDone || !round || ended || dragging || startT < 0.6) return;
    const pick = [...rated.words].filter(([w]) => w.length === 3 && lex.everyday.has(w)).sort((a, b) => (a[0] < b[0] ? -1 : 1))[0] ?? [...rated.words][0];
    if (!pick) return;
    const g = grid();
    const cyc = (startT * 0.6) % 1;
    const p = pick[1];
    const k = reduced ? 1 : easeInOut(clamp01(cyc / 0.7)) * (p.length - 1);
    const pts = p.map((i) => centre(g, i));
    const n = Math.floor(k);
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i <= n && i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
    let tip = pts[n]!;
    if (n < pts.length - 1) {
      const a = pts[n]!;
      const b = pts[n + 1]!;
      tip = [lerp(a[0], b[0], k - n), lerp(a[1], b[1], k - n)];
      ctx.lineTo(tip[0], tip[1]);
    }
    ctx.strokeStyle = rgba(GRAPHITE, 0.7);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    const fadeOut = cyc > 0.85 ? 1 - (cyc - 0.85) / 0.15 : 1;
    drawNib(ctx, tip[0], tip[1], g.c * 0.8, 0.55 * fadeOut, 0.52);
  }

  /** After the bell: the missed words, traced in pencil one after another. */
  function drawReveal() {
    const T0 = 0.35;
    if (!ended || !missed.length || endT < T0) return;
    const g = grid();
    const i = Math.floor((endT - T0) / 1.6) % missed.length;
    const m = missed[i]!;
    const k = reduced ? 1 : easeInOut(clamp01(((endT - T0) % 1.6) / 0.9));
    // The word itself, in pencil, on the writing line above the board.
    const pv = previewPos();
    const fade = clamp01((endT - T0) / 0.3);
    ctx.globalAlpha = fade;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = serif(34);
    ctx.fillStyle = GRAPHITE;
    ctx.fillText(m.word.toUpperCase(), pv.x, pv.y);
    ctx.font = italic(15);
    ctx.fillText(`missed: ${words(m.word.length)} letters, ${words(points(m.word.length))} ${points(m.word.length) === 1 ? "point" : "points"}.`, pv.x, pv.y + 28);
    ctx.globalAlpha = 1;
    const pts = m.path.map((t) => centre(g, t));
    const len = k * (pts.length - 1);
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    const n = Math.floor(len);
    for (let j = 1; j <= n && j < pts.length; j++) ctx.lineTo(pts[j]![0], pts[j]![1]);
    if (n < pts.length - 1) ctx.lineTo(lerp(pts[n]![0], pts[n + 1]![0], len - n), lerp(pts[n]![1], pts[n + 1]![1], len - n));
    ctx.strokeStyle = rgba(GRAPHITE, 0.85);
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
    for (const [x, y] of pts.slice(0, n + 1)) {
      ctx.strokeStyle = rgba(GRAPHITE, 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, g.c * 0.33, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * The run's summary, on a slip of paper laid over the page. In the feed the result card covers the upper half
   * after a run, so the slip sits just above the caption, clear of the action rail; in a bare tab it sits low.
   */
  function drawSummary() {
    if (!ended || endT < 0.6 || !summary.length) return;
    const a = clamp01((endT - 0.6) / 0.45);
    const { x: x0, y: y0, w, h } = slipRect(summary.length);
    const lh = SLIP_LINE;
    const slide = reduced ? 0 : 14 * (1 - easeOut(a));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x0 + w / 2, y0 + h / 2 + slide);
    ctx.rotate(-0.012);
    ctx.fillStyle = rgba(INK, 0.07);
    ctx.fillRect(-w / 2 + 2, -h / 2 + 4, w, h);
    ctx.fillStyle = "#F8F3E9";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = rgba(PENCIL, 0.6);
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const tx = -w / 2 + 12;
    const tw = w - 24 - (isBest ? 44 : 0);
    summary.forEach((line, i) => {
      ctx.fillStyle = i === 0 && isBest ? SEAL : i === summary.length - 1 ? GRAPHITE : INK;
      fitText(ctx, line, tx, -h / 2 + 24 + i * lh, i === 0 ? tw : w - 24, 16);
    });
    ctx.restore();
    if (isBest && endT > 0.8) drawSeal(ctx, sealFor("best", 56), x0 + w - 24, y0 + 20, 42, endT - 0.8, reduced, -0.14, 0.95);
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.8) drawPrompt(ctx, "tap to begin again", x0 + 4, H - 26, session.phaseTime - 0.8, reduced, 1, 19);
  }

  function drawFlies() {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const f of flies) {
      if (f.t < 0) continue;
      const k = clamp01(f.t / f.dur);
      const hold = 0.3;
      let x = f.x0;
      let y = f.y0;
      let s: number;
      if (k < hold) {
        y -= 10 * easeOut(k / hold);
        s = 0.8 + 0.3 * easeOut(k / hold);
      } else {
        const q = easeInOut((k - hold) / (1 - hold));
        x = lerp(f.x0, f.x1, q);
        y = lerp(f.y0 - 10, f.y1, q) - Math.sin(q * Math.PI) * 24;
        s = lerp(1.1, 0.7, q);
      }
      ctx.globalAlpha = k > 0.9 ? (1 - k) / 0.1 : 1;
      ctx.font = italic(f.px * s);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    view.begin();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    const f = frame();
    const k = easeInOut(layoutK);
    const playing = session.runs > 0 && round;
    drawFrame(f, playing ? round!.clock / TUNE.clock : 1, !!playing && session.phase === "playing" && !ended);
    if (playing) {
      const live = dragging ? path : [];
      drawBoard(ended ? 0.4 + 0.6 * (1 - clamp01(endT / 0.6)) : 1, live, dragging ? finger : null, peekState === "word");
      drawTeach();
      drawReveal();
    } else {
      const tr = demo.trace;
      const n = tr ? Math.min(tr.path.length - 1, Math.floor(tr.k)) : -1;
      const line = tr ? tr.path.slice(0, n + 1) : [];
      let tail: [number, number] | null = null;
      const g = grid();
      if (tr && n < tr.path.length - 1) {
        const a = centre(g, tr.path[n]!);
        const b = centre(g, tr.path[n + 1]!);
        tail = [lerp(a[0], b[0], tr.k - n), lerp(a[1], b[1], tr.k - n)];
      }
      drawBoard(1, line, tail, !!tr && n === tr.path.length - 1);
      const tip = tail ?? (line.length ? centre(g, line[line.length - 1]!) : centre(g, 5));
      drawNib(ctx, tip[0], tip[1], g.c * 0.85, tr ? 0.95 : 0.5, reduced ? 0.52 : 0.52 + Math.sin(time * 1.3) * 0.03);
    }
    smudges.draw(ctx);
    ink.draw(ctx);
    ctx.restore();
    tint.draw(ctx, W, H);
    drawTitle(1 - clamp01(k * 1.8));
    drawHud(clamp01((k - 0.45) / 0.55));
    drawPreview(clamp01((k - 0.45) / 0.55));
    drawFlies();
    drawSummary();
  }

  let readySent = false;
  tc.loop(
    (dt) => {
      update(dt);
      render();
      if (!readySent) {
        readySent = true;
        session.ready();
        void loadAccept();
      }
    },
    { maxDt: 1 },
  );
}

void main();
