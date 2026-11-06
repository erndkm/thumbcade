import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { TRAY } from "./deal.ts";
import { drawMark, VIOLET } from "./glyphs.ts";
import { type Box, type Frame, type Geo, heapGeo, playFrame as layoutPlay, slipPos, slotPos, trayBox } from "./layout.ts";
import { drawNib } from "./nib.ts";
import { apply, type Choice, Pilot, skillByName, SKILLS } from "./pilot.ts";
import { drawPrompt, drawSeal, drawTitleBlock, easeInOut, easeOut, handRing, handRule, inkStroke, makeSeal, type Seal, Smudges, titleBlockHeight, titlePx } from "./qm/ink.ts";
import { GRAPHITE, INK, italic, PAPER, PENCIL, rgba, SEAL, serif } from "./qm/palette.ts";
import { createSurface } from "./qm/paper.ts";
import { createSound, scaleNote } from "./qm/sound.ts";
import { issueNumber, loadSerif, roman, words } from "./qm/type.ts";
import { Run, TUNE, type RunEvent } from "./run.ts";

const TITLE = "Overstamp";
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** A slip in the tray as drawn: it flies in from the heap, then settles in its slot. */
interface TrayItem {
  id: number;
  kind: number;
  x: number;
  y: number;
  /** Flight: start point and size, progress 0..1 (1 = landed). */
  fx: number;
  fy: number;
  fs: number;
  fly: number;
  landed: number;
}

/** Three alike, lifted into the lane above the tray and sealed there. */
interface SealGroup {
  items: TrayItem[];
  slots: Array<{ x: number; y: number }>;
  t: number;
  combo: number;
  mult: number;
  points: number;
  stamped: boolean;
}

/** A slip flying back from the tray to the heap (a full tray's grace, a paper clip). */
interface Return {
  id: number;
  kind: number;
  x0: number;
  y0: number;
  s0: number;
  t: number;
}

interface Message {
  text: string;
  t: number;
  life: number;
  color: string;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "overstamp" }), loadSerif()]);
  const view = createSurface();
  const { ctx } = view;
  const sound = createSound();
  const reduced = session.reducedMotion;
  const smudges = new Smudges();
  const ink = new Particles(320);
  const shake = new Shake(6, 0.01, 2.2, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const tint = light.flash({ alpha: 0.12, decay: 0.8 });
  const issue = issueNumber();
  let W = view.width;
  let H = view.height;
  const sprites = new Map<string, HTMLCanvasElement>();
  const seals = new Map<string, Seal>();
  const sealFor = (text: string, size: number) => {
    const k = `${text}:${Math.round(size)}`;
    let s = seals.get(k);
    if (!s) seals.set(k, (s = makeSeal(text, Math.round(size), view.dpr, text.length + 5)));
    return s;
  };
  view.onResize(() => {
    W = view.width;
    H = view.height;
    sprites.clear();
    seals.clear();
  });

  let taught = false;
  try {
    taught = (await tc.storage.get<boolean>("taught")) === true;
  } catch {
    /* guest or offline */
  }

  // ---------------------------------------------------------------------------
  // Slip faces, rendered once per kind, state and size.
  // ---------------------------------------------------------------------------
  const PAD = 4;
  function face(kind: number, covered: boolean, size: number): HTMLCanvasElement {
    const s = Math.round(size);
    const k = `${kind}:${covered ? 1 : 0}:${s}`;
    let c = sprites.get(k);
    if (c) return c;
    c = document.createElement("canvas");
    const dpr = view.dpr;
    c.width = c.height = Math.ceil((s + PAD * 2) * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const card = s - 3;
    const r = Math.max(1.5, s * 0.05);
    const rr = (x: number, y: number) => {
      g.beginPath();
      g.roundRect(x, y, card, card, r);
    };
    // The slip's edge, a hair of card thickness below and to the right.
    rr(PAD + 1.2, PAD + 2.4);
    g.fillStyle = covered ? "#CFC4AE" : "#D9CEB8";
    g.fill();
    rr(PAD, PAD);
    g.fillStyle = covered ? "#E4DAC6" : "#FBF7EE";
    g.fill();
    g.strokeStyle = rgba(INK, covered ? 0.16 : 0.26);
    g.lineWidth = 0.8;
    g.stroke();
    // A printer's rule inside the edge.
    const inset = card * 0.1;
    g.beginPath();
    g.roundRect(PAD + inset, PAD + inset, card - inset * 2, card - inset * 2, r * 0.6);
    g.strokeStyle = rgba(INK, covered ? 0.05 : 0.09);
    g.lineWidth = 0.7;
    g.stroke();
    g.translate(PAD + card / 2, PAD + card / 2);
    drawMark(g, kind, card * 0.58, covered ? 0.34 : 1);
    sprites.set(k, c);
    if (sprites.size > 260) sprites.clear();
    return c;
  }
  const blitFace = (kind: number, covered: boolean, x: number, y: number, size: number, alpha = 1) => {
    const f = face(kind, covered, size);
    const s = Math.round(size);
    ctx.globalAlpha = alpha;
    ctx.drawImage(f, x - PAD, y - PAD, s + PAD * 2, s + PAD * 2);
    ctx.globalAlpha = 1;
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let time = 0;
  /** 0 = the title page with the demo, 1 = the run's layout. */
  let layoutK = 0;
  let layoutTarget = 0;
  let run: Run | null = null;
  let demo = new Run((session.ctx.dailySeed ^ 0x0e57) >>> 0);
  const demoPilot = new Pilot({ ...SKILLS[2]!, think: [0.75, 1.15], careless: 0, fumble: 0 }, createRng(session.ctx.dailySeed ^ 0xbead));
  const qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ 0x9a)) : null;
  let trayItems: TrayItem[] = [];
  let sealing: SealGroup[] = [];
  let returns: Return[] = [];
  /** Per-slip animation times (by id), for the run or demo on screen. */
  let dealAt: Float32Array = new Float32Array(64);
  let revealAt: Float32Array = new Float32Array(64).fill(-10);
  let wiggleAt: Float32Array = new Float32Array(64).fill(-10);
  let flipAt: Float32Array = new Float32Array(64).fill(-10);
  let oldKind: Int16Array = new Int16Array(64);
  let msgs: Message[] = [];
  let shownScore = 0;
  let scoreBump = 0;
  let clockBump = 0;
  let clockAdd: { n: number; t: number } | null = null;
  let sheetMoment: { sheet: number; points: number; time: number; t: number } | null = null;
  let press: { pointer: number; id: number; x: number; y: number; t: number } | null = null;
  let lastInput = 0;
  let ended = false;
  let endT = 0;
  let endSent = false;
  let isBest = false;
  let passedBest = false;
  let summary: string[] = [];
  let bestRatio = 0;
  let lastWhole = 0;
  let heldRiffleUnused = 0;
  let geoCache: { run: Run; sheet: number; frame: string; geo: Geo } | null = null;

  const live = () => (session.runs > 0 && run ? run : demo);
  const inPlay = () => session.phase === "playing" && run !== null && run.live && !ended;

  function say(text: string, color = INK, life = 1.6) {
    // One message at a time: a newer one replaces the last (after a beat, so it can be read).
    const cur = msgs[msgs.length - 1];
    if (cur && cur.t < 0.35) msgs = [];
    msgs = [{ text, t: 0, life, color }];
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  function attractFrame(): Frame & { prompt: number } {
    const ins = session.preview();
    const L = ins.left + 20;
    const R = W - Math.max(ins.right + 8, 20);
    const top = ins.top + 14;
    const prompt = H - ins.bottom - 20;
    const t = trayBox(L, R, prompt - 30, 42);
    const lane: Box = { x: L, y: t.tray.y - 42, w: R - L, h: 40 };
    const by = top + titleBlockHeight(titlePx(ctx, TITLE, R - L)) + 8;
    return { L, R, top, rule: top, prompt, board: { x: L, y: by, w: R - L, h: Math.max(120, lane.y - 4 - by) }, lane, ...t, helpers: null, msg: null };
  }

  const playFrame = (): Frame => layoutPlay(W, H, session.play());

  const frame = (): Frame => (layoutTarget > 0.5 ? playFrame() : attractFrame());

  function geoFor(r: Run, f: Frame): Geo {
    const key = `${f.board.x},${f.board.y},${f.board.w},${f.board.h}`;
    if (geoCache && geoCache.run === r && geoCache.sheet === r.sheet && geoCache.frame === key) return geoCache.geo;
    const geo = heapGeo(r.slips, f.board);
    geoCache = { run: r, sheet: r.sheet, frame: key, geo };
    return geo;
  }

  /** The slip under (x, y): the topmost one drawn there, or a free one within reach of a near miss. */
  function slipAt(r: Run, x: number, y: number): number {
    const f = frame();
    const g = geoFor(r, f);
    let hit = -1;
    let hz = -1;
    for (const s of r.slips) {
      if (s.gone) continue;
      const [px, py] = slipPos(g, s);
      if (x >= px && x < px + g.S && y >= py && y < py + g.S && s.z > hz) {
        hit = s.id;
        hz = s.z;
      }
    }
    if (hit >= 0 && r.isFree(hit)) return hit;
    // Forgiving: the nearest free slip whose edge is within a fingertip.
    let best = -1;
    let bd = 16;
    for (const id of r.freeIds()) {
      const [px, py] = slipPos(g, r.slips[id]!);
      const dx = Math.max(px - x, 0, x - (px + g.S));
      const dy = Math.max(py - y, 0, y - (py + g.S));
      const d = Math.hypot(dx, dy);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best >= 0 ? best : hit;
  }

  function within(b: Box | null, x: number, y: number): boolean {
    return !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  function helperBoxes(f: Frame): { clip: Box; riffle: Box } | null {
    if (!f.helpers) return null;
    const w = Math.min(160, (f.tray.w - 12) / 2);
    return {
      clip: { x: f.tray.x, y: f.helpers.y, w, h: f.helpers.h },
      riffle: { x: f.tray.x + f.tray.w - w, y: f.helpers.y, w, h: f.helpers.h },
    };
  }

  // ---------------------------------------------------------------------------
  // Showing what the run did
  // ---------------------------------------------------------------------------
  function resetShow(r: Run) {
    const n = Math.max(64, r.slips.length);
    dealAt = new Float32Array(n);
    revealAt = new Float32Array(n).fill(-10);
    wiggleAt = new Float32Array(n).fill(-10);
    flipAt = new Float32Array(n).fill(-10);
    oldKind = new Int16Array(n);
    trayItems = [];
    sealing = [];
    returns = [];
    geoCache = null;
    dealIn(r, 0.1);
  }

  /** The heap drops onto the page layer by layer. */
  function dealIn(r: Run, delay: number) {
    const n = Math.max(64, r.slips.length);
    if (dealAt.length < n) {
      dealAt = new Float32Array(n);
      revealAt = new Float32Array(n).fill(-10);
      wiggleAt = new Float32Array(n).fill(-10);
      flipAt = new Float32Array(n).fill(-10);
      oldKind = new Int16Array(n);
    }
    revealAt.fill(-10);
    flipAt.fill(-10);
    const order = [...r.slips].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    order.forEach((s, i) => (dealAt[s.id] = time + delay + i * (reduced ? 0 : 0.028) + s.z * 0.06));
    geoCache = null;
  }

  function onEvents(evs: RunEvent[], r: Run, demoRun: boolean) {
    const f = frame();
    const g = geoFor(r, f);
    const vol = demoRun ? 0.55 : 1;
    for (const e of evs) {
      switch (e.type) {
        case "lift": {
          const s = r.slips[e.id]!;
          const [px, py] = slipPos(g, s);
          // Into the tray beside its kind; a seal in the same tap takes the trio out right after.
          trayItems.splice(e.slot, 0, { id: e.id, kind: e.kind, x: px, y: py, fx: px, fy: py, fs: g.S, fly: 0, landed: -10 });
          sound.rustle(0.45 * vol);
          break;
        }
        case "seal": {
          const items: TrayItem[] = [];
          const slots: Array<{ x: number; y: number }> = [];
          // Where the trio stood (or was headed) in the tray, lifted into the lane above it.
          const [mid] = slotPos(f, Math.min(TRAY - 2, Math.max(1, e.slot + 1)));
          e.ids.forEach((id, k) => {
            const it = trayItems.find((t) => t.id === id) ?? { id, kind: e.kind, x: 0, y: 0, fx: 0, fy: 0, fs: f.slot, fly: 1, landed: time };
            items.push(it);
            slots.push({ x: mid + (k - 1) * f.slot * 0.5, y: f.lane.y + (f.lane.h - f.slot * 0.8) / 2 - 5 });
          });
          trayItems = trayItems.filter((t) => !e.ids.includes(t.id));
          // An older seal still in the lane steps aside: it fades now, so two never stack up.
          for (const old of sealing) if (old.stamped) old.t = Math.max(old.t, 0.62);
          sealing.push({ items, slots, t: 0, combo: e.combo, mult: e.mult, points: e.points, stamped: false });
          if (!demoRun) {
            scoreBump = 1;
            if (!taught) {
              taught = true;
              tc.storage.set("taught", true).catch(() => undefined);
              tc.analytics.track("tutorial_complete");
              say("sealed · every triple buys a second", INK, 2.2);
            }
            if (e.tierUp && e.mult >= 2) {
              say(`${words(e.combo)} in a row · ×${e.mult}`, SEAL, 1.5);
              session.feedback("impact");
            }
            clockAdd = { n: (clockAdd && time - clockAdd.t < 0.8 ? clockAdd.n : 0) + TUNE.tripleTime, t: time };
            clockBump = 1;
          }
          break;
        }
        case "reveal":
          for (const id of e.ids) revealAt[id] = time + 0.12;
          window.setTimeout(() => sound.flip(0.8 * vol), 110);
          break;
        case "layer":
          if (!demoRun) say(`the ${["", "second", "third", "fourth", "fifth", "sixth"][e.z] ?? "top"} layer is lifted · +${e.points}`, INK, 1.6);
          sound.rustle(0.8 * vol);
          window.setTimeout(() => sound.bell(88), 120);
          break;
        case "covered":
          wiggleAt[e.id] = time;
          sound.tok(0.6 * vol, -7);
          if (!demoRun) say("that one is under another slip", GRAPHITE, 1.1);
          break;
        case "back": {
          for (const id of e.ids) {
            const it = trayItems.find((t) => t.id === id);
            const s = r.slips[id]!;
            returns.push({ id, kind: s.type, x0: it?.x ?? f.tray.x, y0: it?.y ?? f.tray.y, s0: f.slot, t: 0 });
          }
          trayItems = trayItems.filter((t) => !e.ids.includes(t.id));
          smudges.add(f.tray.x + f.tray.w / 2, f.tray.y + f.tray.h / 2, f.tray.h * 0.9);
          sound.smudge();
          window.setTimeout(() => sound.rustle(0.9 * vol), 90);
          if (!demoRun) {
            shake.add(0.25);
            session.feedback("fail");
            say(e.why === "grace" ? "the tray is full · three go back" : "a paper clip · three go back", SEAL, 1.8);
          }
          break;
        }
        case "riffle":
          if (e.ok) {
            for (const s of r.slips) if (!s.gone) flipAt[s.id] = time + ((s.x + s.y) / 24) * 0.35;
            for (let i = 0; i < 5; i++) window.setTimeout(() => sound.rustle(0.6), i * 70);
            say("riffled · the heap is dealt again", INK, 1.5);
          } else say("a riffle can't help this tray · try the clip", GRAPHITE, 1.6);
          break;
        case "earn":
          if (!demoRun) {
            window.setTimeout(() => sound.bell(93), 260);
            if (e.what === "riffle") say("four in a row earns a riffle", VIOLET, 1.8);
          }
          break;
        case "sheet": {
          sheetMoment = { sheet: e.sheet, points: e.points, time: e.time, t: 0 };
          sound.stamp(1.2 * vol);
          window.setTimeout(() => sound.bell(76), 80);
          window.setTimeout(() => sound.chord(7), 260);
          if (!demoRun) {
            hitStop.freeze(reduced ? 0 : 0.14);
            shake.add(0.4);
            tint.trigger(SEAL, 0.8);
            session.feedback("success");
            scoreBump = 1;
            clockAdd = { n: e.time, t: time };
            clockBump = 1;
            if (e.clip) window.setTimeout(() => say("a cleared sheet earns a paper clip", VIOLET, 1.8), 700);
          }
          const bx = f.board.x + f.board.w / 2;
          const by = f.board.y + f.board.h / 2;
          ink.emit(bx, by, { count: reduced ? 10 : 46, speed: [120, 420], life: [0.6, 1.3], size: [4, 9], colors: [PAPER, "#E8DFCC", PENCIL, SEAL], gravity: 520, drag: 1.4, spin: [-8, 8], spread: 30 });
          break;
        }
        case "deal":
          dealIn(r, TUNE.dealPause - 0.2);
          break;
        case "over":
          break;
      }
    }
    // The drawn tray always ends up in the model's order.
    if (trayItems.length !== r.tray.length || trayItems.some((t, i) => t.id !== r.tray[i]!.id)) {
      const byId = new Map(trayItems.map((t) => [t.id, t]));
      trayItems = r.tray.map((t, i) => {
        const [x, y] = slotPos(f, i);
        return byId.get(t.id) ?? { id: t.id, kind: t.kind, x, y, fx: x, fy: y, fs: f.slot, fly: 1, landed: time };
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Input: a slip lifts under the finger at once and goes to the tray on release, so a swipe the feed takes never
  // moves one. A covered slip shrugs and costs nothing.
  // ---------------------------------------------------------------------------
  /** Riffles the heap, remembering each slip's mark so the flip can show the old one turning over. */
  function riffle(r: Run) {
    for (const s of r.slips) oldKind[s.id] = s.type;
    onEvents(r.riffle(), r, false);
  }

  function act(r: Run, c: Choice) {
    if (c.kind === "riffle") riffle(r);
    else onEvents(apply(r, c), r, false);
  }

  function lift(id: number) {
    if (!run || !inPlay()) return;
    lastInput = time;
    const evs = run.tap(id);
    onEvents(evs, run, false);
  }

  window.addEventListener("pointerdown", (e) => {
    sound.unlock();
    if (!inPlay() || !run || press) return;
    const id = slipAt(run, e.clientX, e.clientY);
    press = { pointer: e.pointerId, id, x: e.clientX, y: e.clientY, t: time };
    lastInput = time;
  });
  window.addEventListener("pointerup", (e) => {
    if (!press || e.pointerId !== press.pointer) return;
    const p = press;
    press = null;
    if (!inPlay() || !run) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 26) return;
    const f = frame();
    const hb = helperBoxes(f);
    if (hb && within(hb.clip, p.x, p.y)) {
      lastInput = time;
      if (run.clips > 0 && run.tray.length > 0) onEvents(run.clip(), run, false);
      else say(run.clips > 0 ? "the tray is empty" : "clear a sheet to earn a paper clip", GRAPHITE, 1.6);
      return;
    }
    if (hb && within(hb.riffle, p.x, p.y)) {
      lastInput = time;
      if (run.riffles > 0) riffle(run);
      else say("four seals in a row earn a riffle", GRAPHITE, 1.6);
      return;
    }
    if (p.id >= 0) lift(p.id);
  });
  const cancel = () => {
    press = null;
  };
  window.addEventListener("pointercancel", cancel);
  session.on("cancel", cancel);
  session.startOnTap(window);

  // ---------------------------------------------------------------------------
  // The run
  // ---------------------------------------------------------------------------
  session.on("start", () => {
    run = new Run((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0);
    resetShow(run);
    msgs = [];
    shownScore = 0;
    ended = false;
    endT = 0;
    endSent = false;
    isBest = false;
    passedBest = false;
    summary = [];
    sheetMoment = null;
    clockAdd = null;
    lastInput = time;
    lastWhole = Math.ceil(run.clock);
    heldRiffleUnused = 0;
    layoutTarget = 1;
    smudges.clear();
    ink.clear();
    sound.rustle();
    if (!taught) say("tap a slip with nothing on it", INK, 99);
  });

  function finish(r: Run) {
    ended = true;
    endT = 0;
    press = null;
    const s = r.stats;
    const best = session.best;
    isBest = r.score > 0 && (best === null || r.score > best);
    bestRatio = best && best > 0 ? Math.min(1, r.score / best) : 0;
    if (r.over === "full") {
      sound.smudge();
      window.setTimeout(() => sound.bell(57), 120);
      say("the tray is full", SEAL, 99);
    } else {
      sound.bell(57);
      say("time", SEAL, 99);
    }
    const hint =
      r.over === "full" && s.scatter >= 2
        ? "finish a pair before you start a new kind."
        : r.over === "full"
          ? "when the tray tightens, the paper clip sends three back."
          : s.coveredTaps >= 3
            ? "only slips with nothing on them lift. the pale ones lie underneath."
            : s.sheets === 0
              ? "every triple buys a second, a cleared sheet buys nine."
              : s.bestCombo < 3
                ? "seal triples close together and the multiplier climbs."
                : heldRiffleUnused > 4
                  ? "a riffle deals the heap again when nothing matches."
                  : "the pale marks below tell you what comes next.";
    const pts = r.score;
    const line1 = pts <= 0
      ? "no points yet. three alike start the file."
      : isBest
      ? best === null || best <= 0
        ? `${pts.toLocaleString("en-US")} points. the first sheet in the file.`
        : `${pts.toLocaleString("en-US")} points. a new best, by ${(pts - best).toLocaleString("en-US")}.`
      : best !== null && pts === best
        ? `${pts.toLocaleString("en-US")} points. level with your best.`
        : `${pts.toLocaleString("en-US")} points. ${((best ?? 0) - pts).toLocaleString("en-US")} shy of your best.`;
    summary = [line1, `sheets cleared: ${words(s.sheets)}. triples: ${words(s.triples)}. longest run of seals: ${words(s.bestCombo)}.`, `next time: ${hint}`];
    if (isBest) window.setTimeout(() => sound.bell(81), 420);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function updateDemo(dt: number) {
    if (session.runs > 0) return;
    demo.clock = TUNE.clockMax;
    if (demo.pause <= 0 && demo.sheet > 3) {
      demo = new Run((demo.rng.int(1, 1 << 30) ^ 0x51) >>> 0);
      resetShow(demo);
    }
    demo.step(dt);
    const c = demoPilot.next(demo, dt);
    if (c) onEvents(apply(demo, c), demo, true);
    if (!demo.live) {
      demo = new Run((demo.rng.int(1, 1 << 30) ^ 0x52) >>> 0);
      resetShow(demo);
    }
  }

  function updateShow(r: Run, dt: number) {
    const f = frame();
    const fly = reduced ? 0.16 : 0.24;
    trayItems.forEach((it, i) => {
      const [tx, ty] = slotPos(f, i);
      if (it.fly < 1) {
        it.fly = Math.min(1, it.fly + dt / fly);
        if (it.fly >= 1) {
          it.landed = time;
          sound.tok(r === demo ? 0.5 : 0.9, i);
          const c = r.inTray(it.kind);
          sound.pluck(scaleNote(c * 2 + (it.kind % 3), 62), r === demo ? 0.3 : 0.5);
        }
        const k = easeOut(it.fly);
        it.x = lerp(it.fx, tx, k);
        it.y = lerp(it.fy, ty, k) - Math.sin(k * Math.PI) * 34;
      } else {
        it.x += (tx - it.x) * (1 - Math.exp(-20 * dt));
        it.y += (ty - it.y) * (1 - Math.exp(-20 * dt));
      }
    });
    for (const gr of sealing) {
      let allIn = true;
      gr.items.forEach((it, k) => {
        const to = gr.slots[k]!;
        if (it.fly < 1) {
          it.fly = Math.min(1, it.fly + dt / fly);
          const e = easeOut(it.fly);
          it.x = lerp(it.fx, to.x, e);
          it.y = lerp(it.fy, to.y, e) - Math.sin(e * Math.PI) * 30;
          if (it.fly >= 1) it.landed = time;
          allIn = false;
        } else {
          it.x += (to.x - it.x) * (1 - Math.exp(-26 * dt));
          it.y += (to.y - it.y) * (1 - Math.exp(-26 * dt));
          if (Math.abs(it.y - to.y) > 2) allIn = allIn && time - it.landed > 0.08;
        }
      });
      if (allIn || gr.t > 0) gr.t += dt;
      if (!gr.stamped && gr.t > 0.04) {
        gr.stamped = true;
        const cx = gr.slots[1]!.x + f.slot * 0.4;
        const cy = gr.slots[1]!.y + f.slot * 0.4;
        const demoRun = r === demo;
        sound.stamp(demoRun ? 0.5 : 0.85);
        sound.chord(Math.min(9, gr.combo - 1) + 2, demoRun ? 0.45 : 0.85);
        if (!demoRun) {
          hitStop.freeze(reduced ? 0 : 0.045);
          shake.add(Math.min(0.3, 0.12 + gr.combo * 0.02));
        }
        ink.emit(cx, cy, { count: reduced ? 4 : 12 + Math.min(14, gr.combo * 2), speed: [60, 210], life: [0.3, 0.7], size: [2, 5], colors: [SEAL, SEAL, INK], gravity: 300, drag: 2, shape: "circle", spread: 10 });
      }
    }
    sealing = sealing.filter((gr) => gr.t < 0.95);
    for (const b of returns) b.t += dt / (reduced ? 0.2 : 0.32);
    returns = returns.filter((b) => b.t < 1);
  }

  function update(rawDt: number) {
    const dt = hitStop.scale(Math.min(rawDt, 0.1));
    session.tick(rawDt);
    time += dt;
    smudges.update(dt);
    ink.update(dt);
    shake.update(dt);
    tint.update(dt);
    scoreBump = Math.max(0, scoreBump - dt * 4);
    clockBump = Math.max(0, clockBump - dt * 3);
    for (const m of msgs) m.t += dt;
    msgs = msgs.filter((m) => m.t < m.life);
    if (sheetMoment) {
      sheetMoment.t += dt;
      if (sheetMoment.t > TUNE.dealPause + 0.3) sheetMoment = null;
    }
    const lk = reduced ? 4 : 2.6;
    layoutK = layoutTarget > layoutK ? Math.min(layoutTarget, layoutK + dt * lk) : Math.max(layoutTarget, layoutK - dt * lk);

    updateDemo(dt);
    const r = live();
    updateShow(r, dt);
    shownScore = Math.abs(r.score - shownScore) < 0.5 ? r.score : shownScore + (r.score - shownScore) * (1 - Math.exp(-12 * dt));
    if (!run || session.runs === 0) return;
    if (ended) {
      endT += dt;
      if (!endSent && endT >= 0.6) {
        endSent = true;
        const s = run.stats;
        session.end(run.score, { outcome: "lose", stats: { sheets: s.sheets, triples: s.triples, combo: s.bestCombo, seconds: Math.round(s.seconds) } });
      }
      return;
    }
    if (session.phase !== "playing") return;
    if (!taught && run.tray.length > 0 && (msgs.length === 0 || msgs[0]!.text === "tap a slip with nothing on it")) say("three alike in the tray are sealed", INK, 99);
    const evs = run.step(rawDt);
    if (run.riffles > 0) heldRiffleUnused += rawDt;
    if (qaPilot) {
      const c = qaPilot.next(run, rawDt);
      if (c) {
        lastInput = time;
        act(run, c);
      }
    }
    onEvents(evs, run, false);
    // The last five seconds tick.
    const whole = Math.ceil(run.clock);
    if (whole < lastWhole && whole <= 5 && whole > 0 && run.pause <= 0) sound.tick();
    lastWhole = whole;
    const best = session.best;
    if (!passedBest && best !== null && best > 0 && run.score > best) {
      passedBest = true;
      say("past your best", SEAL, 1.8);
      session.feedback("success");
      window.setTimeout(() => sound.bell(84), 100);
      const f = frame();
      ink.emit(f.L + 50, f.board.y, { count: reduced ? 6 : 26, speed: [80, 260], life: [0.6, 1.1], size: [3, 7], colors: [SEAL, PAPER, PENCIL], gravity: 380, drag: 1.2, spin: [-6, 6], spread: 20 });
    }
    if (!run.live) finish(run);
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function drawHeap(r: Run, f: Frame, alpha: number) {
    const g = geoFor(r, f);
    const order = r.slips.filter((s) => !s.gone).sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    const returning = new Set(returns.map((b) => b.id));
    const hint = hintSlip(r);
    for (const s of order) {
      if (returning.has(s.id)) continue;
      const [px, py0] = slipPos(g, s);
      let py = py0;
      let a = alpha;
      const d = time - dealAt[s.id]!;
      if (d < 0) continue;
      if (d < 0.32 && !reduced) {
        const k = easeOut(d / 0.32);
        py -= (1 - k) * 46;
        a *= clamp01(d / 0.12);
      }
      const free = r.isFree(s.id);
      const pressed = press && press.id === s.id && free && r === run;
      const w = time - wiggleAt[s.id]!;
      const rv = time - revealAt[s.id]!;
      const fl = time - flipAt[s.id]!;
      let rot = 0;
      let sx = 1;
      let sc = 1;
      if (w >= 0 && w < 0.36) rot = Math.sin(w * 42) * 0.07 * (1 - w / 0.36) * (reduced ? 0.3 : 1);
      if (pressed) {
        sc = 1.06;
        py -= 2;
      }
      if (hint === s.id) {
        const k = light.pulse(time, 1.2, { still: 0.5 });
        py -= 2 + k * 2;
        rot += Math.sin(time * 5) * 0.025 * (reduced ? 0 : 1);
      }
      if (rv >= 0 && rv < 0.3 && !reduced) py -= Math.sin((rv / 0.3) * Math.PI) * 4;
      let kind = s.type;
      if (fl >= 0 && fl < 0.36) {
        const k = fl / 0.36;
        sx = Math.abs(Math.cos(k * Math.PI));
        if (k < 0.5) kind = oldKind[s.id]!;
      }
      const S = g.S;
      ctx.save();
      ctx.translate(px + S / 2, py + S / 2);
      if (rot) ctx.rotate(rot);
      ctx.scale(sc * Math.max(0.05, sx), sc);
      if (free && rv >= 0 && rv < 0.3) {
        blitFace(kind, false, -S / 2, -S / 2, S, a);
        blitFace(kind, true, -S / 2, -S / 2, S, a * (1 - rv / 0.3));
        if (!reduced) handRing(ctx, 0, 0, S * 0.36, rv / 0.22, s.id * 0.37, 1.1, VIOLET, 0.55 * (1 - rv / 0.3));
      } else blitFace(kind, !free || (rv < 0 && revealAt[s.id]! > -9), -S / 2, -S / 2, S, a);
      ctx.restore();
    }
  }

  /** Which slip the quiet hint points at: the teaching nib's pick, or after a few idle seconds the best lift. */
  let hintCache: { at: number; id: number } = { at: -1, id: -1 };
  function hintSlip(r: Run): number {
    if (r !== run || !inPlay() || r.pause > 0) return -1;
    if (taught && time - lastInput < 3.2) return -1;
    if (time - hintCache.at > 0.5 || !r.isFree(hintCache.id)) {
      const p = new Pilot({ ...SKILLS[3]!, careless: 0, fumble: 0, sight: 1 }, createRng(7));
      const c = p.choose(r);
      hintCache = { at: time, id: c && c.kind === "tap" ? c.id : -1 };
    }
    return hintCache.id;
  }

  function drawTray(r: Run, f: Frame, alpha: number) {
    const t = f.tray;
    ctx.globalAlpha = alpha;
    // A wooden composing tray: a ruled box with seven cells.
    ctx.fillStyle = rgba("#E6DCC8", 0.75);
    ctx.beginPath();
    ctx.roundRect(t.x, t.y, t.w, t.h, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(t.x, t.y, t.w, t.h, 4);
    inkStroke(ctx, 1.1, INK, 0.7 * alpha);
    const fill = r.tray.length;
    for (let i = 0; i < TRAY; i++) {
      const [sx, sy] = slotPos(f, i);
      const warn = i >= TRAY - 2 && fill >= TRAY - 2;
      ctx.beginPath();
      ctx.roundRect(sx + 0.5, sy + 0.5, f.slot - 1, f.slot - 1, 3);
      if (warn) {
        ctx.fillStyle = rgba(SEAL, 0.07 + 0.06 * light.pulse(time, 1.5, { still: 0.5 }));
        ctx.fill();
      }
      ctx.strokeStyle = rgba(warn ? SEAL : INK, warn ? 0.45 : 0.14);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const it of trayItems) drawItem(it, f.slot, alpha);
  }

  function drawItem(it: TrayItem, slot: number, alpha: number, extraScale = 1) {
    const s = it.fly < 1 ? lerp(it.fs, slot, easeOut(it.fly)) : slot;
    let sy = 1;
    const since = time - it.landed;
    if (it.fly >= 1 && since >= 0 && since < 0.22 && !reduced) sy = 1 - 0.14 * Math.sin((since / 0.22) * Math.PI) * (1 - since / 0.22);
    ctx.save();
    ctx.translate(it.x + s / 2, it.y + s);
    ctx.scale(extraScale * (2 - sy), extraScale * sy);
    blitFace(it.kind, false, -s / 2, -s, s, alpha);
    ctx.restore();
  }

  function drawSealing(f: Frame) {
    for (const gr of sealing) {
      const st = gr.t;
      const fade = st > 0.55 ? 1 - (st - 0.55) / 0.4 : 1;
      const shrink = st > 0.55 ? 1 - 0.35 * easeOut((st - 0.55) / 0.4) : 1;
      gr.items.forEach((it, k) => {
        ctx.save();
        const r = (k - 1) * 0.09 * (reduced ? 0 : 1);
        ctx.translate(it.x + f.slot / 2, it.y + f.slot);
        ctx.rotate(r);
        ctx.translate(-(it.x + f.slot / 2), -(it.y + f.slot));
        drawItem(it, f.slot, clamp01(fade), 0.8 * shrink);
        ctx.restore();
      });
      if (gr.stamped) {
        const cx = gr.slots[1]!.x + f.slot * 0.4;
        const cy = gr.slots[1]!.y + f.slot * 0.4;
        // A longer run of seals presses a bigger seal.
        const size = Math.min(f.lane.h, f.slot * (0.95 + 0.07 * (gr.mult - 1)));
        // The impression lands on a clean patch, so its knocked-out numeral reads.
        const k = reduced ? 1 : easeOut(clamp01((st - 0.04) / 0.2));
        ctx.globalAlpha = clamp01(fade + 0.2) * k;
        ctx.fillStyle = "#FBF7EE";
        ctx.beginPath();
        ctx.roundRect(cx - size * 0.44, cy - size * 0.44, size * 0.88, size * 0.88, 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        drawSeal(ctx, sealFor(gr.combo >= 2 ? roman(gr.combo) : "qm", size), cx, cy, size, st - 0.04, reduced, -0.08, clamp01(fade + 0.2));
        // Points to the right of the trio, in the lane.
        const tx = gr.slots[2]!.x + f.slot * 0.9;
        ctx.font = italic(19);
        const label = `+${gr.points}`;
        const w = ctx.measureText(label).width;
        const right = tx + w < f.R;
        ctx.textAlign = right ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = rgba(SEAL, st > 0.6 ? 0 : clamp01(fade) * clamp01(st / 0.12));
        ctx.fillText(label, right ? tx : gr.slots[0]!.x - 6, cy - (reduced ? 0 : easeOut(st / 0.5) * 4));
      }
    }
  }

  function drawReturns(r: Run, f: Frame) {
    const g = geoFor(r, f);
    for (const b of returns) {
      const s = r.slips[b.id]!;
      const [tx, ty] = slipPos(g, s);
      const k = easeInOut(clamp01(b.t));
      const size = lerp(b.s0, g.S, k);
      blitFace(b.kind, false, lerp(b.x0, tx, k), lerp(b.y0, ty, k) - Math.sin(k * Math.PI) * 40, size);
    }
  }

  function drawHelpers(r: Run, f: Frame, alpha: number) {
    const hb = helperBoxes(f);
    if (!hb) return;
    const draw = (b: Box, label: string, n: number, icon: (x: number, y: number, c: string) => void) => {
      const on = n > 0;
      const c = on ? INK : PENCIL;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y + 2, b.w, b.h - 4, 4);
      ctx.fillStyle = rgba(on ? "#FBF7EE" : "#E9E1D0", 0.9);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(b.x, b.y + 2, b.w, b.h - 4, 4);
      inkStroke(ctx, 0.9, c, on ? 0.75 : 0.5);
      icon(b.x + 22, b.y + b.h / 2, c);
      ctx.font = italic(17);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rgba(on ? INK : GRAPHITE, 1);
      ctx.fillText(label, b.x + 42, b.y + b.h / 2 + 1);
      ctx.font = serif(17);
      ctx.textAlign = "right";
      ctx.fillStyle = rgba(on ? VIOLET : GRAPHITE, 1);
      ctx.fillText(`×${n}`, b.x + b.w - 10, b.y + b.h / 2 + 1);
      ctx.globalAlpha = 1;
    };
    draw(hb.clip, "back three", r.clips, (x, y, c) => {
      // A paper clip.
      ctx.beginPath();
      ctx.moveTo(x + 3, y - 4);
      ctx.lineTo(x + 3, y + 7);
      ctx.arc(x, y + 7, 3, 0, Math.PI, false);
      ctx.lineTo(x - 3, y - 8);
      ctx.arc(x + 1, y - 8, 4, Math.PI, 0, false);
      ctx.lineTo(x + 5, y + 9);
      ctx.arc(x, y + 9, 5, 0, Math.PI, false);
      ctx.lineTo(x - 5, y - 3);
      inkStroke(ctx, 1.3, c, 0.9);
    });
    draw(hb.riffle, "riffle", r.riffles, (x, y, c) => {
      // Three slips fanned out.
      for (const a of [-0.35, 0, 0.35]) {
        ctx.save();
        ctx.translate(x, y + 7);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.rect(-5, -16, 10, 14);
        ctx.fillStyle = rgba("#FBF7EE", 1);
        ctx.fill();
        inkStroke(ctx, 1, c, 0.85);
        ctx.restore();
      }
    });
  }

  function drawHud(r: Run, f: Frame, alpha: number) {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const top = f.top;
    // Score, left.
    const bump = 1 + scoreBump * 0.08;
    ctx.save();
    ctx.translate(f.L, top + 32);
    ctx.scale(bump, bump);
    ctx.font = serif(34);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    ctx.fillText(Math.round(shownScore).toLocaleString("en-US"), 0, 0);
    ctx.restore();
    ctx.font = italic(14);
    ctx.fillStyle = GRAPHITE;
    ctx.textAlign = "left";
    const best = session.best;
    ctx.fillText(best ? `points · best ${best.toLocaleString("en-US")}` : "points", f.L + 1, top + 49);
    // The clock, right.
    const low = r.clock <= 5 && r.live;
    const secs = Math.max(0, Math.ceil(r.clock));
    const cb = 1 + clockBump * 0.1;
    ctx.save();
    ctx.translate(f.R, top + 32);
    ctx.scale(cb, cb);
    ctx.font = serif(34);
    ctx.textAlign = "right";
    ctx.fillStyle = low ? SEAL : INK;
    ctx.fillText(String(secs), 0, 0);
    ctx.restore();
    ctx.font = italic(14);
    ctx.textAlign = "right";
    ctx.fillStyle = GRAPHITE;
    ctx.fillText("seconds", f.R, top + 49);
    if (clockAdd && time - clockAdd.t < 1.1) {
      const k = (time - clockAdd.t) / 1.1;
      ctx.font = italic(19);
      ctx.fillStyle = rgba(VIOLET, k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      ctx.textAlign = "right";
      ctx.fillText(`+${clockAdd.n % 1 ? clockAdd.n.toFixed(1) : clockAdd.n}`, f.R - 52, top + 30 - k * 6);
    }
    // The sheet, centre.
    ctx.textAlign = "center";
    ctx.font = italic(18);
    ctx.fillStyle = INK;
    ctx.fillText(`sheet ${roman(r.sheet)}`, W / 2, top + 24);
    ctx.font = italic(14);
    ctx.fillStyle = GRAPHITE;
    const left = r.heapLeft;
    ctx.fillText(r.pause > 0 ? "dealing" : `${left} ${left === 1 ? "slip" : "slips"} left`, W / 2, top + 44);
    // The clock as an ink rule across the page, burning from the right.
    const frac = clamp01(r.clock / TUNE.clockMax);
    const x1 = lerp(f.L, f.R, frac);
    handRule(ctx, f.L, f.R, f.rule, 1, 0.6, PENCIL, 0.7, 2);
    const pulse = low ? 0.55 + 0.45 * light.pulse(time, 2, { still: 1 }) : 1;
    if (x1 > f.L + 1) handRule(ctx, f.L, x1, f.rule, 1, 2.4, low ? SEAL : INK, 0.85 * pulse, 2);
    ctx.globalAlpha = 1;
  }

  /** The message lane under the clock: one line on a paper backing. */
  function drawMessage(f: Frame) {
    const b = f.msg;
    const m = msgs[0];
    if (!b || !m) return;
    const a = Math.min(1, m.t / 0.12) * (m.life - m.t < 0.3 ? (m.life - m.t) / 0.3 : 1);
    ctx.font = italic(19);
    const w = Math.min(b.w, ctx.measureText(m.text).width + 28);
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba(PAPER, 0.94);
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, b.y, w, b.h, 4);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = m.color;
    let px = 19;
    while (ctx.measureText(m.text).width > b.w - 20 && px > 13) ctx.font = italic(--px);
    ctx.fillText(m.text, W / 2, b.y + b.h / 2 + 1);
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }

  function drawSheetMoment(f: Frame) {
    const m = sheetMoment;
    if (!m) return;
    const cx = f.board.x + f.board.w / 2;
    const cy = f.board.y + f.board.h * 0.42;
    const size = Math.min(132, f.board.w * 0.38);
    const fade = m.t > TUNE.dealPause - 0.45 ? clamp01(1 - (m.t - (TUNE.dealPause - 0.45)) / 0.35) : 1;
    drawSeal(ctx, sealFor(roman(m.sheet), size), cx, cy, size, m.t, reduced, -0.1, fade);
    // A slip of paper under the seal with what the sheet paid.
    const sy = cy + size * 0.62 + 8;
    const w = Math.min(f.board.w, 270);
    ctx.globalAlpha = fade * clamp01((m.t - 0.18) / 0.2);
    ctx.fillStyle = rgba("#FBF7EE", 0.96);
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, sy, w, 62, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, sy, w, 62, 3);
    inkStroke(ctx, 0.8, INK, 0.5);
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = italic(22);
    ctx.fillText(`sheet ${roman(m.sheet)}, cleared`, cx, sy + 26);
    ctx.font = italic(16);
    ctx.fillStyle = GRAPHITE;
    ctx.fillText(`+${m.points.toLocaleString("en-US")} points · +${m.time} seconds`, cx, sy + 48);
    ctx.globalAlpha = 1;
  }

  function drawTitle(f: ReturnType<typeof attractFrame>, alpha: number) {
    if (alpha <= 0) return;
    drawTitleBlock(ctx, { title: TITLE, kicker: `no. ${issue} · a heap of slips`, dek: "lift what lies on top. three alike are sealed." }, f.L, f.top, f.R - f.L, time, alpha, reduced);
    drawPrompt(ctx, "tap to begin", f.L + 2, f.prompt, time, reduced, alpha, 21);
    if ((session.best ?? 0) > 0) {
      ctx.globalAlpha = alpha;
      ctx.font = italic(16);
      ctx.textAlign = "right";
      ctx.fillStyle = GRAPHITE;
      ctx.fillText(`best ${session.best!.toLocaleString("en-US")}`, f.R, f.prompt);
      ctx.globalAlpha = 1;
    }
  }

  /** On the very first run, a pen nib shows which slip to lift. */
  function drawTeach(r: Run, f: Frame) {
    if (taught || r !== run || !inPlay() || r.pause > 0) return;
    const id = hintSlip(r);
    if (id < 0) return;
    const g = geoFor(r, f);
    const [px, py] = slipPos(g, r.slips[id]!);
    const cyc = (time % 1.3) / 1.3;
    const tap = reduced ? 0 : Math.max(0, Math.sin(cyc * Math.PI * 2)) * 6;
    drawNib(ctx, px + g.S * 0.62, py + g.S * 0.6 - tap, g.S * 0.9, 0.9);
    if (cyc > 0.2 && cyc < 0.45 && !reduced) {
      ctx.beginPath();
      ctx.arc(px + g.S * 0.5, py + g.S * 0.5, g.S * (0.3 + (cyc - 0.2) * 1.2), 0, Math.PI * 2);
      inkStroke(ctx, 1, VIOLET, 0.6 * (1 - (cyc - 0.2) / 0.25));
    }
  }

  /** After a run: a slip above the caption with how it went and one thing to try. */
  function drawSummary() {
    if (!ended || !summary.length) return;
    const a = clamp01((endT - 0.5) / 0.4);
    if (a <= 0) return;
    const ins = session.preview();
    const x = ins.left + 12;
    const w = W - ins.right - 8 - x;
    const lines = summary.length;
    const h = 24 * lines + 34;
    const bottom = session.standalone ? H - 64 : H - ins.bottom - 10;
    const y = bottom - h;
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba("#FBF7EE", 0.97);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    inkStroke(ctx, 0.9, INK, 0.55);
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    summary.forEach((line, i) => {
      let px = i === 0 ? 19 : 16;
      // The first line leaves room for the "best" seal in the corner.
      const room = w - 28 - (i === 0 && isBest ? 58 : 0);
      ctx.font = italic(px);
      while (ctx.measureText(line).width > room && px > 11) ctx.font = italic(--px);
      ctx.fillStyle = i === 0 ? INK : i === lines - 1 ? SEAL : GRAPHITE;
      ctx.fillText(line, x + 14, y + 26 + i * 24 + (i > 0 ? 10 : 0));
    });
    // A bar against the best, under the first line.
    const by = y + 36;
    handRule(ctx, x + 14, x + w - 14, by, 1, 0.6, PENCIL, 0.8, 1);
    const frac = isBest ? 1 : bestRatio;
    if (frac > 0) handRule(ctx, x + 14, lerp(x + 14, x + w - 14, frac), by, clamp01((endT - 0.6) / 0.6), 2.2, isBest ? SEAL : INK, 0.85, 1);
    if (isBest) {
      const size = 44;
      drawSeal(ctx, sealFor("best", size), x + w - 34, y - 6, size, endT - 0.9, reduced, -0.12);
    }
    ctx.globalAlpha = 1;
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.8) drawPrompt(ctx, "tap to begin again", x + 4, H - 26, session.phaseTime - 0.8, reduced, 1, 19);
  }

  function render() {
    view.begin();
    const o = shake.offset;
    const r = live();
    const pk = easeInOut(clamp01(layoutK));
    const af = attractFrame();
    const pf = playFrame();
    const f = layoutTarget > 0.5 ? pf : af;
    ctx.save();
    ctx.translate(o.x, o.y);
    const heapAlpha = ended ? 0.25 + 0.75 * (1 - clamp01(endT / 0.6)) : 1;
    drawHeap(r, f, heapAlpha);
    drawReturns(r, f);
    drawTray(r, f, ended ? heapAlpha : 1);
    drawSealing(f);
    smudges.draw(ctx);
    drawTeach(r, f);
    ink.draw(ctx);
    ctx.restore();
    if (layoutTarget > 0.5) {
      drawHud(r, pf, pk);
      drawHelpers(r, pf, pk * (ended ? 0.4 : 1));
      drawMessage(pf);
      drawSheetMoment(pf);
    } else drawTitle(af, 1);
    tint.draw(ctx, W, H);
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
      }
    },
    { maxDt: 1 },
  );
  resetShow(demo);
}

void main();
