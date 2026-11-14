import { clamp } from "@thumbcade-games/kit/ease";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import { CARD_PAPER, clearSprites, drawCard, drawSlot } from "./art.ts";
import { card as cardOf, RANK_NAMES, rankOf, suitOf, SUITS, type Card, type Table } from "./cards.ts";
import { clearLine, dealLine, DEK, kicker, LINES, PROMPT, summaryLines, TEACH, tierLine, TITLE } from "./copy.ts";
import { attractLayout, cardY, colX, frameIn, homeX, hud, LANE_PX, playRect, SUMMARY_PAD, SUMMARY_PX, summaryPlate, upStep, type Frame } from "./layout.ts";
import { plays, type Target } from "./natural.ts";
import { drawNib } from "./nib.ts";
import { DEMO, Pilot, skillByName } from "./pilot.ts";
import { drawPrompt, drawSeal, drawTitleBlock, easeOut, fitText, handRule, makeSeal, type Seal } from "./qm/ink.ts";
import { BAIZE, GRAPHITE, INK, italic, PAPER, PENCIL, rgba, SEAL, serif } from "./qm/palette.ts";
import { createSurface } from "./qm/paper.ts";
import { createSound, scaleNote } from "./qm/sound.ts";
import { issueNumber, loadSerif } from "./qm/type.ts";
import { Run, TUNE, type RunListener } from "./run.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;
/** A press that wanders further than this (CSS px) is not a tap. */
const TAP_SLOP = 22;
/** Deals the attract demo plays before it starts over. */
const DEMO_DEALS = 2;

interface Anim {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
  up: boolean;
  flipAt: number;
}

interface Slot {
  x: number;
  y: number;
  up: boolean;
  /** Where the card lies: a column, a home pile, the pack or the drawn cards (`rank` orders a pile bottom to top). */
  pile: "col" | "home" | "stock" | "waste";
  order: number;
}

interface Line {
  text: string;
  color: string;
  t: number;
  life: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

async function main() {
  const [session] = await Promise.all([createSession({ id: "long-suit" }), loadSerif()]);
  const surface = createSurface();
  const { ctx } = surface;
  const sound = createSound();
  const reduced = session.reducedMotion;
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.12, decay: 0.5 });
  const issue = issueNumber();
  let W = surface.width;
  let H = surface.height;
  surface.onResize(() => {
    W = surface.width;
    H = surface.height;
    clearSprites();
  });

  // Player memory: how far the first-run lines got (0 nothing, 1 a card moved, 2 a card home, 3 a deal cleared).
  let taught = 0;
  try {
    const v = await tc.storage.get<number>("taught");
    if (typeof v === "number") taught = clamp(Math.floor(v), 0, 3);
  } catch {
    /* guest or offline: teach again */
  }
  const learn = (stage: number) => {
    if (stage <= taught || mode !== "play") return;
    taught = stage;
    tc.storage.set("taught", stage).catch(() => undefined);
    if (stage === 3) tc.analytics.track("tutorial_complete");
  };

  // ---- state -----------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let over: { t: number; isBest: boolean; ended: boolean; prev: number; lines: [string, string, string] } | null = null;
  let passedBest = false;
  let line: Line | null = null;
  let scoreShown = 0;
  let clockShown: number = TUNE.clock;
  let lastInput = 0;
  let lastTick = 0;
  let pressed: { target: Target; x: number; y: number } | null = null;
  let turnedSaid = false;
  let demoDeals = 0;
  let demoSeed = session.ctx.seed ^ 0x51ab;
  const anims = new Map<Card, Anim>();
  const delays = new Map<Card, number>();
  const shakes = new Map<Card, number>();
  const sealAt: number[] = [-9, -9, -9, -9];
  let seal: Seal | null = null;
  let sealKey = "";
  const later: { at: number; fn: () => void }[] = [];
  const schedule = (delay: number, fn: () => void) => later.push({ at: time + delay, fn });

  const demo = new Pilot(DEMO, createRng(session.ctx.seed ^ 0xd3));
  const qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ 0x9a)) : null;
  const loud = () => mode === "play";

  const say = (text: string, color: string = INK, life = 1.8) => {
    line = { text, color, t: 0, life };
  };

  /** The table's frame: the whole screen under the HUD in a run, what the feed leaves free outside one. */
  function frame(t: Table): Frame {
    if (mode === "attract") return frameIn(attractLayout(W, H, session.preview()).table, t.cols.length, t.ranks);
    return frameIn(playRect(W, H, session.play().top), t.cols.length, t.ranks);
  }

  /** Where every card of the table lies. */
  function slots(t: Table, f: Frame): Map<Card, Slot> {
    const out = new Map<Card, Slot>();
    t.cols.forEach((c, col) => {
      const x = colX(f, col);
      c.down.forEach((cd, i) => out.set(cd, { x, y: cardY(f, c.down.length, c.up.length, i), up: false, pile: "col", order: col * 100 + i }));
      c.up.forEach((cd, i) => out.set(cd, { x, y: cardY(f, c.down.length, c.up.length, c.down.length + i), up: true, pile: "col", order: col * 100 + c.down.length + i }));
    });
    for (let s = 0; s < SUITS; s++) for (let r = 0; r < t.home[s]!; r++) out.set(cardOf(s, r), { x: homeX(f, s), y: f.homeY, up: true, pile: "home", order: r });
    t.stock.forEach((cd, i) => out.set(cd, { x: f.stockX, y: f.packY, up: false, pile: "stock", order: i }));
    const n = t.waste.length;
    t.waste.forEach((cd, i) => out.set(cd, { x: f.wasteX - Math.min(2, n - 1 - i) * f.fan, y: f.packY, up: true, pile: "waste", order: i }));
    return out;
  }

  const listener: RunListener = {
    dealt(table, level, fresh) {
      clearSprites();
      anims.clear();
      delays.clear();
      shakes.clear();
      sealAt.fill(-9);
      // Dealt out from the pack, a card at a time.
      const f = frame(table);
      const all = slots(table, f);
      const onTable = [...all.entries()].filter(([, s]) => s.pile === "col").sort((a, b) => (a[1].order % 100) - (b[1].order % 100) || a[1].order - b[1].order);
      const gap = reduced ? 0 : Math.min(0.022, 0.42 / Math.max(1, onTable.length));
      onTable.forEach(([cd, s], i) => {
        anims.set(cd, { fx: f.stockX, fy: f.packY, tx: s.x, ty: s.y, t0: time + i * gap, dur: reduced ? 0.01 : 0.2, up: s.up, flipAt: s.up ? time + i * gap + 0.12 : -9 });
        if (loud() && i % 3 === 0) schedule(i * gap, () => sound.tok(0.35, (i % 5) - 2));
      });
      if (loud()) {
        if (!fresh) say(dealLine(level, table.ranks), GRAPHITE, 2.2);
        sound.rustle(0.6);
      }
    },
    steps(steps, cause) {
      const t = run.table;
      let homes = 0;
      for (const st of steps) {
        if (st.kind === "home") {
          homes++;
          const note = scaleNote(Math.min(14, Math.max(0, run.chain - 1)));
          const d = cause === "sweep" ? 0 : (homes - 1) * 0.07;
          delays.set(st.card, d);
          if (loud()) schedule(d + 0.1, () => sound.pluck(note, 0.5));
          if (t.home[suitOf(st.card)] === t.ranks && rankOf(st.card) === t.ranks - 1) {
            const suit = suitOf(st.card);
            schedule(d + 0.26, () => {
              sealAt[suit] = time;
              if (loud()) sound.stamp(0.7);
            });
          }
          learn(2);
        } else if (st.kind === "build") {
          st.cards.forEach((cd, i) => delays.set(cd, i * 0.018));
          if (loud()) sound.tok(0.6, st.cards.length > 1 ? -2 : 1);
          learn(1);
        } else if (st.kind === "flip") {
          if (loud()) schedule(0.12, () => sound.flip(0.8));
        } else if (st.kind === "draw") {
          if (loud()) sound.flip(0.5);
        } else {
          if (loud()) sound.rustle(0.8);
          if (loud() && !turnedSaid) {
            turnedSaid = true;
            say(LINES.turned, GRAPHITE, 1.4);
          }
        }
      }
    },
    dud(target) {
      const t = run.table;
      const cards = target.kind === "col" ? t.cols[target.col]!.up.slice(-1) : target.kind === "waste" ? t.waste.slice(-1) : [];
      for (const cd of cards) shakes.set(cd, time);
      if (loud()) sound.smudge();
    },
    tier(mult) {
      if (!loud()) return;
      say(tierLine(run.chain, mult), SEAL, 2);
      sound.chord(mult * 2, 0.6);
      session.feedback("success");
    },
    cleared(e) {
      if (!loud()) return;
      say(clearLine(e.points, e.refund), INK, TUNE.cheer + 0.6);
      schedule(0.2, () => {
        sound.bell(scaleNote(7));
        sound.chord(4, 0.7);
      });
      flash.trigger(BAIZE, 1);
      session.feedback("success");
      tc.analytics.track("level_complete", { level: e.level + 1 });
      learn(3);
    },
    dead() {
      if (!loud()) return;
      say(LINES.dead, GRAPHITE, TUNE.afresh + 1.2);
      sound.smudge();
      session.feedback("impact");
    },
  };

  let run = new Run(demoSeed, listener).start();

  function newRun(seed: number) {
    later.length = 0;
    line = null;
    pressed = null;
    turnedSaid = false;
    demo.reset();
    qaPilot?.reset();
    run = new Run(seed >>> 0, listener).start();
  }

  // ---- input -----------------------------------------------------------------------------------
  const playing = () => session.phase === "playing" && mode === "play" && !over && !session.paused;

  /** What a touch at (x, y) is on: a column's card, the drawn cards, the pack, or nothing. */
  function targetAt(x: number, y: number): Target | null {
    const t = run.table;
    const f = frame(t);
    if (y >= f.packY - 8) {
      if (x >= f.stockX - 6) return { kind: "stock" };
      if (t.waste.length && x >= f.wasteX - 2 * f.fan - 6) return { kind: "waste" };
      return null;
    }
    if (y < f.tableY - 4) return null;
    for (let col = 0; col < t.cols.length; col++) {
      const x0 = colX(f, col);
      if (x < x0 - f.gap / 2 || x > x0 + f.cw + f.gap / 2) continue;
      const c = t.cols[col]!;
      const n = c.up.length;
      if (n === 0) return null;
      const firstUp = cardY(f, c.down.length, n, c.down.length);
      const step = upStep(f, c.down.length, n);
      // Above the face-up run, or below its last card: the column's top card is meant.
      if (y < firstUp || y > firstUp + (n - 1) * step + f.ch + 10) return y < firstUp ? { kind: "col", col, index: n - 1 } : null;
      return { kind: "col", col, index: Math.min(n - 1, Math.floor((y - firstUp) / step)) };
    }
    return null;
  }

  window.addEventListener("pointerdown", (e) => {
    sound.unlock();
    if (!playing() || qaPilot || pressed || run.phase !== "play") return;
    lastInput = time;
    const target = targetAt(e.clientX, e.clientY);
    if (target) pressed = { target, x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointermove", (e) => {
    if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > TAP_SLOP) pressed = null;
  });
  window.addEventListener("pointerup", () => {
    const p = pressed;
    pressed = null;
    if (p && playing()) {
      lastInput = time;
      run.tap(p.target);
    }
  });
  window.addEventListener("pointercancel", () => (pressed = null));
  session.on("cancel", () => (pressed = null));
  session.on("pause", () => (pressed = null));
  session.startOnTap(window);

  session.on("start", () => {
    sound.unlock();
    mode = "play";
    over = null;
    passedBest = false;
    scoreShown = 0;
    clockShown = TUNE.clock;
    lastInput = time;
    newRun((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0);
    sound.chord(0, 0.6);
  });

  // ---- frame -----------------------------------------------------------------------------------
  function endRun() {
    if (over) return;
    const best = session.best;
    const isBest = run.score > 0 && (best === null || run.score > best);
    over = { t: 0, isBest, ended: false, prev: best ?? 0, lines: summaryLines(run.score, best, run.stats) };
    pressed = null;
    say(LINES.time, SEAL, 2.4);
    sound.bell(scaleNote(-3));
    if (isBest) {
      schedule(0.5, () => {
        sound.chord(5, 0.8);
        sound.stamp(0.8);
        flash.trigger(BAIZE, 1);
      });
    }
  }

  function update(dt: number) {
    session.tick(dt);
    time += dt;
    flash.update(dt);
    scoreShown += (run.score - scoreShown) * (1 - Math.exp(-12 * dt));
    if (Math.abs(run.score - scoreShown) < 0.5) scoreShown = run.score;

    if (mode === "attract") {
      run.clock = TUNE.max;
      const tap = demo.update(run, dt);
      if (tap) run.tap(tap);
      const level = run.level;
      run.step(dt);
      run.prepare(2);
      if (run.level !== level && ++demoDeals >= DEMO_DEALS) {
        demoDeals = 0;
        demoSeed = (demoSeed + 0x9e37) >>> 0;
        newRun(demoSeed);
      }
    } else if (!over) {
      if (qaPilot) {
        const tap = qaPilot.update(run, dt);
        if (tap) run.tap(tap);
      }
      // The pen comes out for a first run, and for anyone who has stopped to think.
      if (run.phase === "play" && !qaPilot && (taught < 3 || time - lastInput > 4)) run.wantHint();
      run.think(2);
      run.step(dt);
      run.prepare(2);
      if (run.over) endRun();
      const best = session.best;
      if (!passedBest && !run.over && best !== null && best > 0 && run.score > best) {
        passedBest = true;
        say(LINES.past, BAIZE, 2);
        sound.chord(6, 0.6);
        session.feedback("success");
      }
      if (!run.over && run.phase === "play" && run.clock < 5 && time - lastTick > 1) {
        lastTick = time;
        sound.tick();
      }
    }
    clockShown += (run.clock - clockShown) * (1 - Math.exp(-10 * dt));

    const due = later.filter((l) => l.at <= time);
    if (due.length) {
      for (const l of due) later.splice(later.indexOf(l), 1);
      for (const l of due) l.fn();
    }
    if (line) {
      line.t += dt;
      if (line.t >= line.life) line = null;
    }
    if (over) {
      over.t += dt;
      if (!over.ended && over.t > 0.6) {
        over.ended = true;
        const s = run.stats;
        session.end(run.score, { outcome: "lose", stats: { deals: s.deals, home: s.home, chain: s.bestChain, taps: s.taps, seconds: Math.round(s.seconds) } });
      }
    }
  }

  // ---- drawing ---------------------------------------------------------------------------------
  /** Where a card is right now on its way to where it lies. */
  function place(cd: Card, s: Slot): { x: number; y: number; moving: boolean; flip: number; t0: number } {
    let a = anims.get(cd);
    if (!a) anims.set(cd, (a = { fx: s.x, fy: s.y, tx: s.x, ty: s.y, t0: -9, dur: 0.01, up: s.up, flipAt: -9 }));
    if (a.tx !== s.x || a.ty !== s.y) {
      const k0 = easeOut(clamp((time - a.t0) / a.dur));
      a.fx += (a.tx - a.fx) * k0;
      a.fy += (a.ty - a.fy) * k0;
      a.tx = s.x;
      a.ty = s.y;
      a.t0 = time + (delays.get(cd) ?? 0);
      a.dur = reduced ? 0.01 : s.pile === "home" ? 0.26 : 0.17;
      delays.delete(cd);
    }
    if (a.up !== s.up) {
      a.up = s.up;
      a.flipAt = Math.max(time, a.t0);
    }
    const k = easeOut(clamp((time - a.t0) / a.dur));
    const flip = reduced ? 1 : clamp((time - a.flipAt) / 0.16);
    return { x: a.fx + (a.tx - a.fx) * k, y: a.fy + (a.ty - a.fy) * k, moving: k < 1, flip, t0: a.t0 };
  }

  function drawTable() {
    const t = run.table;
    const f = frame(t);
    const dpr = surface.dpr;
    // (At the end the whole table pales under a wash of paper; the cards themselves stay opaque.)
    const fade = 1;
    const all = slots(t, f);
    // Places for cards: the four homes, and any column with nothing in it.
    for (let s = 0; s < SUITS; s++) if (t.home[s] === 0) drawSlot(ctx, homeX(f, s), f.homeY, f.cw, f.ch, { suit: s, alpha: fade });
    t.cols.forEach((c, col) => {
      if (c.up.length + c.down.length === 0) drawSlot(ctx, colX(f, col), f.tableY, f.cw, f.ch, { label: RANK_NAMES[t.ranks - 1], alpha: fade });
    });
    if (t.stock.length === 0) drawSlot(ctx, f.stockX, f.packY, f.cw, f.ch, { turn: t.waste.length > 0, alpha: t.waste.length ? 1 : 0.5 });

    const resting: Array<[Card, Slot, ReturnType<typeof place>]> = [];
    const flying: Array<[Card, Slot, ReturnType<typeof place>]> = [];
    for (const [cd, s] of all) {
      const p = place(cd, s);
      // A pile shows its top cards only: the rest lie exactly under them.
      if (!p.moving && s.pile === "home" && s.order < t.home[suitOf(cd)]! - 2) continue;
      if (!p.moving && s.pile === "stock" && s.order < t.stock.length - 2) continue;
      if (!p.moving && s.pile === "waste" && s.order < t.waste.length - 3) continue;
      (p.moving ? flying : resting).push([cd, s, p]);
    }
    const rank = (s: Slot) => (s.pile === "home" ? 0 : s.pile === "col" ? 1 : s.pile === "stock" ? 2 : 3) * 10000 + s.order;
    resting.sort((a, b) => rank(a[1]) - rank(b[1]));
    flying.sort((a, b) => a[2].t0 - b[2].t0 || rank(a[1]) - rank(b[1]));
    const lifted = pressed?.target;
    for (const [cd, s, p] of [...resting, ...flying]) {
      let dx = 0;
      const sh = time - (shakes.get(cd) ?? -9);
      if (sh < 0.3 && !reduced) dx = Math.sin(sh * 42) * 3 * (1 - sh / 0.3);
      let lift = p.moving ? 1 : 0;
      if (lifted && s.pile === "col" && lifted.kind === "col") {
        const c = t.cols[lifted.col]!;
        if (c.up.indexOf(cd) >= lifted.index) lift = 0.6;
      } else if (lifted && lifted.kind === "waste" && s.pile === "waste" && s.order === t.waste.length - 1) lift = 0.6;
      drawCard(ctx, cd, Math.round(p.x), Math.round(p.y) + (s.pile === "stock" ? -(s.order - (t.stock.length - 1)) : 0), f.cw, f.ch, dpr, { up: s.up, flip: p.flip, lift, alpha: fade, dx });
    }
    // How many cards the pack still holds.
    if (t.stock.length > 0 && f.cw >= 40) {
      ctx.font = italic(12);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = rgba(GRAPHITE, 0.9 * fade);
      ctx.fillText(String(t.stock.length), f.stockX + f.cw / 2, f.packY - 5);
    }
    // A suit complete: the seal goes on its pile.
    for (let s = 0; s < SUITS; s++) {
      if (sealAt[s]! < 0 || t.home[s] !== t.ranks) continue;
      const size = Math.round(f.cw * 0.5);
      const key = `${size}|${dpr}`;
      if (!seal || sealKey !== key) {
        seal = makeSeal("qm", size, dpr);
        sealKey = key;
      }
      drawSeal(ctx, seal, homeX(f, s) + f.cw * 0.68, f.homeY + f.ch * 0.74, size, time - sealAt[s]!, reduced, -0.09, fade);
    }
    if (over) {
      ctx.fillStyle = rgba(PAPER, 0.5 * clamp(over.t / 0.6));
      ctx.fillRect(0, f.homeY - 6, W, H);
    }
    return f;
  }

  function drawHud(f: Frame) {
    if (mode !== "play") return;
    const h = hud(W, session.play().top);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = serif(30);
    ctx.fillStyle = INK;
    ctx.fillText(fmt(scoreShown), h.scoreX, h.scoreY);
    // The multiplier, with a rule under it that runs out with the chain.
    if (run.mult > 1 && !over) {
      ctx.textAlign = "right";
      ctx.font = serif(24);
      ctx.fillStyle = SEAL;
      const text = `×${run.mult}`;
      ctx.fillText(text, h.multX, h.scoreY);
      const w = ctx.measureText(text).width;
      const k = clamp(run.chainLeft / TUNE.chainGap);
      handRule(ctx, h.multX - w, h.multX - w + w * (run.phase === "play" ? k : 1), h.scoreY + 5, 1, 1.1, SEAL, 0.9, 4.2);
    }
    // The clock: an ink rule across the page that shortens; the last seconds in seal red.
    const low = run.clock < 5 && !over;
    const k = clamp(clockShown / TUNE.max);
    handRule(ctx, h.clockX0, h.clockX1, h.clockY, 1, 0.8, PENCIL, 0.7, 1.7);
    if (k > 0.004) handRule(ctx, h.clockX0, h.clockX0 + (h.clockX1 - h.clockX0) * k, h.clockY, 1, low ? 2.2 : 1.8, low ? SEAL : INK, low ? 0.65 + 0.35 * light.pulse(time, 2, { still: 1 }) : 0.95, 0.6);
    // One line of news at a time; a first run reads the rules there.
    const teach = taught < 3 && !over && !qaPilot ? TEACH[Math.min(2, taught)]! : null;
    ctx.textAlign = "left";
    if (line) {
      const a = clamp(line.t / 0.15) * clamp((line.life - line.t) / 0.3);
      ctx.fillStyle = rgba(line.color, a);
      fitText(ctx, line.text, h.scoreX, h.laneY, W - 24, LANE_PX);
    } else if (teach) {
      ctx.fillStyle = rgba(INK, 0.9);
      fitText(ctx, teach, h.scoreX, h.laneY, W - 24, LANE_PX);
    }
    // Bottom left, beside the drawn cards: which deal this is.
    const room = f.wasteX - 2 * f.fan - f.x0 - 10;
    if (room > 56 && !over) {
      ctx.fillStyle = rgba(GRAPHITE, 0.95);
      const [a, b] = dealLine(run.level, run.table.ranks).split(" · ");
      fitText(ctx, a!, f.x0 + 2, f.packY + f.ch - 22, room, 15);
      ctx.fillStyle = rgba(PENCIL, 1);
      fitText(ctx, b!, f.x0 + 2, f.packY + f.ch - 6, room, 13);
    }
  }

  /** The pen points at a tap that leads home: for a first run, and after a few idle seconds. */
  function drawPen(f: Frame) {
    if (mode !== "play" || over || qaPilot || run.phase !== "play") return;
    if (taught >= 3 && time - lastInput < 4) return;
    const t = run.table;
    const target = run.hint ?? plays(t)[0] ?? ({ kind: "stock" } as Target);
    let x = f.stockX + f.cw / 2;
    let y = f.packY + f.ch * 0.45;
    if (target.kind === "waste") x = f.wasteX + f.cw / 2;
    else if (target.kind === "col") {
      const c = t.cols[target.col]!;
      x = colX(f, target.col) + f.cw / 2;
      y = cardY(f, c.down.length, c.up.length, c.down.length + target.index) + (target.index === c.up.length - 1 ? f.ch * 0.5 : upStep(f, c.down.length, c.up.length) * 0.6);
    }
    const bob = reduced ? 0 : Math.abs(Math.sin(time * 3.2)) * 6;
    drawNib(ctx, x + 3, y - bob, Math.max(34, f.cw * 0.62), 0.92);
  }

  function drawAttract() {
    if (mode !== "attract") return;
    const L = attractLayout(W, H, session.preview());
    drawTitleBlock(ctx, { title: TITLE, kicker: kicker(issue), dek: DEK }, L.x, L.y, L.w, time, 1, reduced);
    drawPrompt(ctx, PROMPT, L.x, L.promptY, time, reduced);
    if (session.best !== null && session.best > 0) {
      ctx.font = italic(15);
      ctx.textAlign = "right";
      ctx.fillStyle = rgba(GRAPHITE, 1);
      ctx.fillText(`best ${fmt(session.best)}`, L.x + L.w, L.promptY);
    }
  }

  function drawSummary() {
    if (!over || over.t < 0.7) return;
    const p = summaryPlate(W, H, session.preview(), session.standalone);
    const a = clamp((over.t - 0.7) / 0.4);
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba(INK, 0.12);
    ctx.fillRect(p.x + 2, p.y + 3, p.w, p.h);
    ctx.fillStyle = CARD_PAPER;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = rgba(INK, 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    const x = p.x + SUMMARY_PAD;
    const w = p.w - SUMMARY_PAD * 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = over.isBest ? SEAL : INK;
    fitText(ctx, over.lines[0], x, p.y + 28, w, SUMMARY_PX[0]);
    ctx.fillStyle = GRAPHITE;
    fitText(ctx, over.lines[1], x, p.y + 49, w, SUMMARY_PX[1]);
    // This run against the best: a rule, and a tick where the best stands.
    const top = Math.max(run.score, over.prev, 1);
    const k = easeOut(clamp((over.t - 0.9) / 0.6));
    handRule(ctx, x, x + w, p.y + 62, 1, 0.8, PENCIL, 0.8, 2.3);
    if (run.score > 0) handRule(ctx, x, x + w * (run.score / top) * k, p.y + 62, 1, 2, over.isBest ? SEAL : BAIZE, 0.95, 0.9);
    if (over.prev > 0 && !over.isBest) {
      ctx.fillStyle = INK;
      ctx.fillRect(Math.round(x + w * (over.prev / top)) - 1, p.y + 57, 1.5, 10);
    }
    ctx.fillStyle = INK;
    fitText(ctx, over.lines[2], x, p.y + 88, w, SUMMARY_PX[2]);
    ctx.globalAlpha = 1;
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.8) drawPrompt(ctx, "tap to deal again", p.x, p.y + p.h + 22, time, reduced, a, 17);
  }

  function render() {
    surface.begin();
    const f = drawTable();
    drawPen(f);
    drawHud(f);
    drawAttract();
    drawSummary();
    flash.draw(ctx, W, H);
  }

  let readySent = false;
  tc.loop((dt) => {
    update(dt);
    render();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();
