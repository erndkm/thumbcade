import { onTap } from "@thumbcade-games/kit/input";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import acceptUrl from "./data/accept.txt?url";
import answersText from "./data/answers.txt?raw";
import { dailyWord } from "./daily.ts";
import { type Box, attractFrame, type Frame, keyAt, type KeyBox, LINES, playFrame as layoutPlay, type Slip as SlipGeo, SUMMARY_PX, summaryPlate } from "./layout.ts";
import { PackedWords, parseAnswers } from "./lexicon.ts";
import { LETTERS, type Mark, RING, RULE, STRUCK } from "./marks.ts";
import { drawNib } from "./nib.ts";
import { Pilot, skillByName, SKILLS } from "./pilot.ts";
import { drawPrompt, drawSeal, drawTitleBlock, easeInOut, easeOut, handRing, handRule, inkStroke, makeSeal, type Seal, brushCurve, titleBlockHeight, titlePx } from "./qm/ink.ts";
import { GRAPHITE, INK, italic, PAPER, PENCIL, rgba, SEAL, serif, WALNUT } from "./qm/palette.ts";
import { createSurface } from "./qm/paper.ts";
import { createSound, scaleNote } from "./qm/sound.ts";
import { issueNumber, loadSerif, roman, words } from "./qm/type.ts";
import { type Key, Run, type RunEvent, type Slip, SOLVE_NAMES, TIER_NAMES, TUNE } from "./run.ts";
import { dailyLine, hintFor, pointsLine, statsLine } from "./copy.ts";

const TITLE = "Galley Proof";
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const CARD = "#FBF7EE";
/** Ink to seal red, 0..1, for a solved line being set again in vermilion. */
const mixInk = (k: number) => {
  const a = [0x1e, 0x1a, 0x17];
  const b = [0xb9, 0x43, 0x2c];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(",")})`;
};
const CARD_EDGE = "#D9CEB8";

/** When each mark of a written line starts drawing, and how long it takes. */
const MARK_STEP = 0.09;
const markDur = (m: Mark) => (m === RING ? 0.24 : m === RULE ? 0.16 : 0.13);
const LINE_DONE = 0.05 + MARK_STEP * 4 + 0.24;

interface Leaving {
  slip: Slip;
  kind: "solved" | "missed";
  t0: number;
  lines: number;
  daily: boolean;
  /** When it slides away (and the next slip drops in). */
  out: number;
}

interface Message {
  text: string;
  t: number;
  life: number;
  color: string;
}

/** Today's slip once filed: kept so later runs start on a fresh slip and the summary can show the marks. */
type DailyRecord = {
  day: number;
  lines: number;
  marks: Mark[][];
};

async function main() {
  const [session] = await Promise.all([createSession({ id: "galley-proof" }), loadSerif()]);
  const answers = parseAnswers(answersText);
  const answerSet = new Set(answers);
  // The accepted list loads after the first frame. Until it lands the answers answer, and a line they don't know waits
  // ("checking the dictionary") and is judged the moment the list arrives. The load retries for as long as it takes.
  let accept: PackedWords | null = null;
  const isWord = (w: string): boolean | null => (accept ? accept.has(w) : answerSet.has(w) ? true : null);
  const loadAccept = (wait = 1500) =>
    fetch(acceptUrl)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((t) => {
        accept = new PackedWords(t);
        if (pending && run && inPlay()) {
          pending = false;
          onEvents(run.write(), run, false);
        }
      })
      .catch(() => window.setTimeout(() => void loadAccept(Math.min(10_000, wait * 2)), wait));

  const view = createSurface();
  const { ctx } = view;
  const sound = createSound();
  const reduced = session.reducedMotion;
  const ink = new Particles(320);
  const shake = new Shake(6, 0.01, 2.2, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const tint = light.flash({ alpha: 0.12, decay: 0.8 });
  const issue = issueNumber();
  const today = dailyWord(answers, session.ctx.dailySeed);
  const todayKey = today.day ?? session.ctx.dailySeed;
  let W = view.width;
  let H = view.height;
  const seals = new Map<string, Seal>();
  const sealFor = (text: string, size: number) => {
    const k = `${text}:${Math.round(size)}`;
    let s = seals.get(k);
    if (!s) seals.set(k, (s = makeSeal(text, Math.round(size), view.dpr, text.length + 3)));
    return s;
  };
  view.onResize(() => {
    W = view.width;
    H = view.height;
    seals.clear();
  });

  let taught = false;
  let filed: DailyRecord | null = null;
  try {
    const [t, d] = await Promise.all([tc.storage.get<boolean>("taught"), tc.storage.get<DailyRecord>("daily")]);
    taught = t === true;
    if (d && typeof d === "object" && d.day === todayKey && Array.isArray(d.marks)) filed = d;
  } catch {
    /* guest or offline */
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let time = 0;
  /** 0 = the title page with the demo, 1 = the run's layout. */
  let layoutK = 0;
  let layoutTarget = 0;
  let run: Run | null = null;
  const demoAnswers = answers.filter((w) => w !== today.word);
  const demoAvoid = new Set([today.word]);
  const demoSkill = { ...SKILLS[2]!, typo: 0, think: [1.5, 2.4] as [number, number], key: [0.2, 0.3] as [number, number] };
  let demoSeed = (session.ctx.dailySeed ^ 0xd3a7) >>> 0;
  const newDemo = () => {
    demoSeed = (Math.imul(demoSeed, 0x9e3779b1) + 0x51) >>> 0;
    return new Run({ seed: demoSeed, answers: demoAnswers, daily: null, isWord: (w) => isWord(w) ?? true });
  };
  let demo = newDemo();
  let demoPilot = new Pilot(demoSkill, createRng(demoSeed ^ 0xbead), demoAnswers, demoAvoid);
  let qaPilot: Pilot | null = null;
  let msgs: Message[] = [];
  let shownScore = 0;
  let scoreBump = 0;
  let clockBump = 0;
  let clockAdd: { text: string; t: number; color: string } | null = null;
  let lastInput = 0;
  let ended = false;
  let endT = 0;
  let endSent = false;
  let isBest = false;
  let passedBest = false;
  let summary: string[] = [];
  let bestRatio = 0;
  let lastWhole = 0;
  let pending = false;
  let shared: "no" | "asking" | "yes" = "no";
  let nudged = false;
  let multShown = 1;
  let tierAt = -10;

  /** The slip on screen and how its lines are being drawn. */
  const lineAt = new WeakMap<Slip, number[]>();
  let leaving: Leaving | null = null;
  let arriveAt = -10;
  let shakeAt = -10;
  let note: { text: string; color: string; t: number; life: number } | null = null;
  let typedAt = new Float32Array(LETTERS).fill(-10);
  let pencilAt = { at: -1, t: -10 };
  let sealMoment: { slip: Slip; text: string; t0: number; daily: boolean; size: number } | null = null;
  const cues: Array<{ at: number; fn: () => void }> = [];
  const presses = new Map<number, { key: KeyBox; x: number; y: number }>();
  const keyFlash = new Map<Key, number>();

  const live = () => (session.runs > 0 && run ? run : demo);
  const inPlay = () => session.phase === "playing" && run !== null && run.live && !ended;

  function say(text: string, color = INK, life = 1.6) {
    const cur = msgs[msgs.length - 1];
    if (cur && cur.t < 0.35 && cur.life < 50) msgs = [];
    msgs = [{ text, t: 0, life, color }];
  }
  const cue = (delay: number, fn: () => void) => cues.push({ at: time + delay, fn });
  const setNote = (text: string, color = GRAPHITE, life = 1.8) => (note = { text, color, t: time, life });

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  const titleBottom = () => {
    const ins = session.preview();
    const L = ins.left + 20;
    const R = W - Math.max(ins.right + 8, 20);
    return ins.top + 14 + titleBlockHeight(titlePx(ctx, TITLE, R - L)) + 8;
  };
  const attract = () => attractFrame(W, H, session.preview(), titleBottom());
  const playFrame = (): Frame => layoutPlay(W, H, session.play());
  /** The slip's geometry right now: sliding from the title page into the run's place as the run begins. */
  function slipGeo(): SlipGeo {
    const k = easeInOut(clamp01(layoutK));
    if (k <= 0) return attract().slip;
    if (k >= 1) return playFrame().slip;
    const a = attract().slip;
    const b = playFrame().slip;
    const mix = (x: Box, y: Box): Box => ({ x: lerp(x.x, y.x, k), y: lerp(x.y, y.y, k), w: lerp(x.w, y.w, k), h: lerp(x.h, y.h, k) });
    return {
      card: mix(a.card, b.card),
      head: mix(a.head, b.head),
      note: mix(a.note, b.note),
      cx: a.cx.map((x, i) => lerp(x, b.cx[i]!, k)),
      base0: lerp(a.base0, b.base0, k),
      line: lerp(a.line, b.line, k),
      cell: lerp(a.cell, b.cell, k),
      type: lerp(a.type, b.type, k),
    };
  }

  // ---------------------------------------------------------------------------
  // What the run did, shown
  // ---------------------------------------------------------------------------
  function resetShow(r: Run) {
    leaving = null;
    arriveAt = time;
    sealMoment = null;
    typedAt = new Float32Array(LETTERS).fill(-10);
    note = null;
    cues.length = 0;
    void r;
  }

  function onEvents(evs: RunEvent[], r: Run, demoRun: boolean) {
    const vol = demoRun ? 0.5 : 1;
    for (const e of evs) {
      switch (e.type) {
        case "type":
        case "confirm":
          if (!demoRun && msgs[0]?.text === "type any five-letter word") msgs = [];
          // A key that turns the line into a whole word typed over the pencil sets every letter again.
          if (e.type === "type" && e.whole) typedAt.fill(time);
          typedAt[e.at] = time;
          sound.key(0.8 * vol, (e.letter.charCodeAt(0) % 5) - 2);
          break;
        case "erase":
          typedAt[e.at] = -10;
          sound.rustle(0.3 * vol);
          break;
        case "full":
          keyFlash.set("write", time);
          if (!demoRun) setNote("the line is full · write it", GRAPHITE, 1.4);
          break;
        case "short":
          shakeAt = time;
          sound.tok(0.5 * vol, -5);
          if (!demoRun) setNote(e.have === 0 ? "type a five-letter word" : `five letters to a line · ${words(e.have)} so far`, GRAPHITE, 1.4);
          break;
        case "unknown":
          shakeAt = time;
          sound.smudge();
          if (!demoRun) setNote("not in our dictionary · it costs nothing", GRAPHITE, 1.8);
          break;
        case "checking":
          pending = true;
          setNote("checking the dictionary.", GRAPHITE, 99);
          break;
        case "line": {
          pending = false;
          note = null;
          if (!demoRun && msgs[0]?.life === 99) msgs = [];
          const slip = e.ref;
          const at = lineAt.get(slip) ?? [];
          at[e.line - 1] = time;
          lineAt.set(slip, at);
          typedAt = new Float32Array(LETTERS).fill(-10);
          sound.rustle(0.45 * vol);
          let ringN = 0;
          e.marks.forEach((m, i) => {
            const fresh = e.rings.includes(i);
            cue(0.05 + i * MARK_STEP, () => {
              if (m === RING) {
                sound.pluck(scaleNote(2 + ringN++ + (fresh ? 2 : 0), 62), (fresh ? 0.62 : 0.4) * vol);
                sound.scratch(0.7 * vol);
                // A place ringed for the first time flicks a few drops of red off the nib.
                if (fresh && !reduced) {
                  const g = slipGeo();
                  const base = g.base0 + (e.line - 1) * g.line;
                  ink.emit(g.cx[i]! + g.line * 0.3, base - g.type * 0.8, { count: 4, speed: [40, 120], angle: [-2.4, -0.7], life: [0.25, 0.5], size: [1.5, 3], colors: [SEAL], gravity: 360, drag: 2, shape: "circle", spread: 3 });
                }
              } else if (m === RULE) {
                sound.pluck(scaleNote(i, 55), 0.3 * vol);
                sound.scratch(0.5 * vol, -3);
              } else sound.scratch(0.6 * vol, -9);
            });
          });
          if (!demoRun) {
            if (e.points) scoreBump = 1;
            if (e.time >= 1) cue(LINE_DONE, () => showClock(`+${fmtSecs(e.time)}`, WALNUT));
            else if (e.time > 0) cue(LINE_DONE, () => (clockBump = 0.6));
            if (e.bell) say("written at the bell", SEAL, 1.6);
          }
          break;
        }
        case "solve": {
          const old = e.ref;
          startLeaving(old, "solved", e.lines, e.daily);
          const at = time + LINE_DONE + 0.02;
          cues.push({
            at,
            fn: () => {
              const g = slipGeo();
              const size = Math.min(58, g.head.h * 2.1);
              sealMoment = { slip: old, text: roman(e.lines), t0: time, daily: e.daily, size };
              sound.stamp(1.1 * vol);
              sound.chord(Math.min(8, e.streak + 1) + 2, 0.85 * vol);
              window.setTimeout(() => sound.bell(e.lines <= 2 ? 88 : 81), 70);
              const sx = g.card.x + g.card.w - 30;
              const sy = g.card.y + 24;
              ink.emit(sx, sy, { count: reduced ? 4 : 14 + Math.min(16, e.mult * 3), speed: [60, 230], life: [0.3, 0.75], size: [2, 5], colors: [SEAL, SEAL, INK], gravity: 320, drag: 2, shape: "circle", spread: 10 });
              if (!demoRun) {
                hitStop.freeze(reduced ? 0 : 0.055);
                shake.add(Math.min(0.34, 0.16 + e.mult * 0.03));
                scoreBump = 1;
                showClock(`+${fmtSecs(e.time)}`, WALNUT);
                say(`${SOLVE_NAMES[e.lines]} · +${e.points.toLocaleString("en-US")}`, e.lines <= 2 ? SEAL : INK, 1.5);
                if (e.daily) {
                  session.feedback("success");
                  tint.trigger(SEAL, 0.7);
                  window.setTimeout(() => say("today's word, filed", SEAL, 1.8), 900);
                }
                if (e.tierUp && e.mult >= 2) {
                  multShown = e.mult;
                  window.setTimeout(() => {
                    tierAt = time;
                    say(`${TIER_NAMES[e.mult]} · ×${e.mult}`, SEAL, 1.7);
                    session.feedback("impact");
                    if (!e.daily) tint.trigger(SEAL, 0.6);
                    sound.bell(93);
                    hitStop.freeze(reduced ? 0 : 0.08);
                    const f = playFrame();
                    ink.emit(W / 2, f.msg.y + 14, { count: reduced ? 6 : 24, speed: [80, 300], life: [0.6, 1.2], size: [3, 7], colors: [PAPER, "#E8DFCC", PENCIL, SEAL], gravity: 420, drag: 1.3, spin: [-7, 7], spread: 40 });
                  }, 650);
                } else if (!e.clean) multShown = 1;
                if (!taught) {
                  taught = true;
                  tc.storage.set("taught", true).catch(() => undefined);
                  tc.analytics.track("tutorial_complete");
                  window.setTimeout(() => say("filed · every solve buys time back", INK, 2.2), 1500);
                }
              }
            },
          });
          if (!demoRun && e.daily) saveDaily(old, e.lines);
          break;
        }
        case "miss": {
          const old = e.ref;
          startLeaving(old, "missed", old.lines.length, e.daily);
          multShown = 1;
          cue(LINE_DONE + 0.05, () => {
            sound.smudge();
            window.setTimeout(() => sound.bell(57), 90);
            if (!demoRun) {
              shake.add(0.22);
              showClock(`−${e.time}`, SEAL);
              say(`it was ${e.answer} · −${e.time} seconds`, SEAL, 2.2);
            }
          });
          for (let i = 0; i < LETTERS; i++) cue(LINE_DONE + 0.35 + i * 0.13, () => sound.key(0.6 * vol, i));
          if (!demoRun && e.daily) saveDaily(old, 0);
          break;
        }
        case "earn":
          if (!demoRun)
            window.setTimeout(() => {
              say("a pencil for the margin · it writes in one letter", WALNUT, 2);
              sound.bell(93);
              keyFlash.set("pencil", time);
            }, 1300);
          break;
        case "pencil":
          pencilAt = { at: e.at, t: time };
          sound.flip(0.9 * vol);
          sound.scratch(0.9 * vol, 2);
          if (!demoRun) say(`pencilled in: ${e.letter.toUpperCase()}`, WALNUT, 1.3);
          break;
        case "nopencil":
          if (!demoRun) say(`a solve in ${words(TUNE.pencilAt)} lines or fewer earns a pencil`, GRAPHITE, 1.8);
          break;
        case "next":
          if (leaving) arriveAt = leaving.out + 0.05;
          else arriveAt = time;
          typedAt = new Float32Array(LETTERS).fill(-10);
          break;
        case "over":
          break;
      }
    }
  }

  function track(r: Run, key: Key, demoRun: boolean) {
    onEvents(r.press(key), r, demoRun);
  }

  function startLeaving(slip: Slip, kind: "solved" | "missed", lines: number, daily: boolean) {
    const hold = kind === "solved" ? LINE_DONE + TUNE.filePause - 0.1 : LINE_DONE + TUNE.missPause - 0.15;
    leaving = { slip, kind, t0: time, lines, daily, out: time + hold };
  }

  function showClock(text: string, color: string) {
    clockAdd = { text, t: time, color };
    clockBump = 1;
  }
  const fmtSecs = (s: number) => (s % 1 ? s.toFixed(1) : String(s));

  function saveDaily(slip: Slip, lines: number) {
    filed = { day: todayKey, lines, marks: slip.lines.map((l) => [...l.marks]) };
    tc.storage.set("daily", filed).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Input: a key goes down under the finger at once and is set on release, so a swipe the feed takes never types.
  // ---------------------------------------------------------------------------
  function pressKey(key: Key) {
    if (!run || !inPlay()) return;
    lastInput = time;
    keyFlash.set(key, time);
    sound.unlock();
    if (pending) {
      if (key === "write") return;
      // The line changed while it waited on the dictionary: it no longer waits.
      if (key === "erase") {
        pending = false;
        note = null;
      }
    }
    track(run, key, false);
    if (!taught && run.slip.lines.length === 0 && run.full && msgs[0]?.text !== "write it when the line is full") say("write it when the line is full", INK, 99);
  }

  window.addEventListener("pointerdown", (e) => {
    sound.unlock();
    if (!inPlay()) return;
    const kb = playFrame().kb;
    if (!kb) return;
    const k = keyAt(kb, e.clientX, e.clientY);
    if (k) presses.set(e.pointerId, { key: k, x: e.clientX, y: e.clientY });
    lastInput = time;
  });
  window.addEventListener("pointerup", (e) => {
    const p = presses.get(e.pointerId);
    if (!p) return;
    presses.delete(e.pointerId);
    if (!inPlay()) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 34) return;
    pressKey(p.key.key);
  });
  // A hardware keyboard works too (the simulator, a tablet with a keyboard): letters, backspace, enter.
  window.addEventListener("keydown", (e) => {
    if (!inPlay() || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k.length === 1 && k >= "a" && k <= "z") pressKey(k);
    else if (e.key === "Backspace") pressKey("erase");
    else if (e.key === "Enter") pressKey("write");
    else return;
    e.preventDefault();
  });
  const cancel = () => presses.clear();
  window.addEventListener("pointercancel", (e) => presses.delete(e.pointerId));
  session.on("cancel", cancel);

  // A tap starts a run on the title page and after one (the share line on the summary excepted).
  onTap(window, (x, y) => {
    if (session.phase === "playing") return;
    if (session.phase === "over" && shareBox && x >= shareBox.x && x <= shareBox.x + shareBox.w && y >= shareBox.y && y <= shareBox.y + shareBox.h) {
      if (shared === "asking") return;
      shared = "asking";
      sound.flip();
      tc.share
        .challenge({ score: run?.score ?? 0 })
        .then((r) => (shared = r.shared ? "yes" : "no"))
        .catch(() => (shared = "no"));
      return;
    }
    session.start();
  });

  // ---------------------------------------------------------------------------
  // The run
  // ---------------------------------------------------------------------------
  session.on("start", () => {
    const dailyFirst = filed === null;
    run = new Run({ seed: (session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0, answers, daily: dailyFirst ? today.word : null, isWord });
    qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ (0x9a + session.runs)), answers) : null;
    resetShow(run);
    msgs = [];
    shownScore = 0;
    ended = false;
    endT = 0;
    endSent = false;
    isBest = false;
    passedBest = false;
    summary = [];
    clockAdd = null;
    lastInput = time;
    lastWhole = Math.ceil(run.clock);
    layoutTarget = 1;
    pending = false;
    shared = "no";
    nudged = false;
    multShown = 1;
    presses.clear();
    ink.clear();
    sound.rustle();
    if (!taught) say("type any five-letter word", INK, 99);
    else if (!dailyFirst) say(`today's word is filed (${filed!.lines ? `${words(filed!.lines)} lines` : "missed"}) · a fresh slip`, GRAPHITE, 2.2);
    else say("today's word first · the same for everyone", SEAL, 2);
  });

  function finish(r: Run) {
    ended = true;
    endT = 0;
    presses.clear();
    const best = session.best;
    isBest = r.score > 0 && (best === null || r.score > best);
    bestRatio = best && best > 0 ? Math.min(1, r.score / best) : 0;
    sound.bell(57);
    window.setTimeout(() => sound.rustle(0.8), 160);
    say("time", SEAL, 99);
    summary = [pointsLine(r.score, best, isBest), hintFor(r.stats, r.slip), statsLine(r.stats)];
    if (isBest) window.setTimeout(() => sound.bell(81), 420);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function updateDemo(dt: number) {
    if (session.runs > 0) return;
    demo.clock = TUNE.clockMax;
    if (demo.slip.n > 3 && !leaving) {
      demo = newDemo();
      demoPilot = new Pilot(demoSkill, createRng(demoSeed ^ 0xbead), demoAnswers, demoAvoid);
      resetShow(demo);
    }
    demo.step(dt);
    // The demo waits for each slip to be set before it types on it.
    if (time < arriveAt) return;
    const k = demoPilot.next(demo, dt);
    if (k) {
      keyFlash.set(k, time);
      track(demo, k, true);
    }
  }

  function update(rawDt: number) {
    const dt = hitStop.scale(Math.min(rawDt, 0.1));
    session.tick(rawDt);
    time += dt;
    ink.update(dt);
    shake.update(dt);
    tint.update(dt);
    scoreBump = Math.max(0, scoreBump - dt * 4);
    clockBump = Math.max(0, clockBump - dt * 3);
    for (const m of msgs) m.t += dt;
    msgs = msgs.filter((m) => m.t < m.life);
    if (note && time - note.t > note.life) note = null;
    for (let i = cues.length - 1; i >= 0; i--) {
      if (cues[i]!.at <= time) {
        const c = cues.splice(i, 1)[0]!;
        c.fn();
      }
    }
    if (leaving && time > leaving.out + 0.5) leaving = null;
    if (sealMoment && time - sealMoment.t0 > 1.6) sealMoment = null;
    const lk = reduced ? 4 : 2.4;
    layoutK = layoutTarget > layoutK ? Math.min(layoutTarget, layoutK + dt * lk) : Math.max(layoutTarget, layoutK - dt * lk);

    updateDemo(dt);
    const r = live();
    shownScore = Math.abs(r.score - shownScore) < 0.5 ? r.score : shownScore + (r.score - shownScore) * (1 - Math.exp(-12 * dt));
    if (!run || session.runs === 0) return;
    if (ended) {
      endT += dt;
      if (!endSent && endT >= 0.6) {
        endSent = true;
        const s = run.stats;
        session.end(run.score, { outcome: "lose", stats: { words: s.words, fewest: s.fewest, streak: s.bestStreak, seconds: Math.round(s.seconds) } });
      }
      return;
    }
    if (session.phase !== "playing") return;
    const evs = run.step(rawDt);
    if (qaPilot && time >= arriveAt) {
      const k = qaPilot.next(run, rawDt);
      if (k) pressKey(k);
    }
    onEvents(evs, run, false);
    // The last five seconds tick.
    const whole = Math.ceil(run.clock);
    if (whole < lastWhole && whole <= 5 && whole > 0 && run.pause <= 0) sound.tick();
    lastWhole = whole;
    const best = session.best;
    if (!passedBest && best !== null && best > 0 && run.score > best) {
      passedBest = true;
      window.setTimeout(() => {
        say("past your best", SEAL, 1.8);
        session.feedback("success");
        sound.bell(84);
        const f = playFrame();
        ink.emit(f.L + 40, f.top + 30, { count: reduced ? 6 : 26, speed: [80, 260], life: [0.6, 1.1], size: [3, 7], colors: [SEAL, PAPER, PENCIL], gravity: 380, drag: 1.2, spin: [-6, 6], spread: 20 });
      }, 900);
    }
    // After the first run, a quiet nudge when a line has sat still for a while.
    if (taught && !nudged && time - lastInput > 7 && run.pause <= 0 && run.slip.lines.length > 0 && !leaving) {
      nudged = true;
      say(nudgeText(run), GRAPHITE, 2.6);
    }
    if (!run.live) finish(run);
  }

  function nudgeText(r: Run): string {
    const keys = r.keyBest();
    const ruled = [...keys].filter(([, m]) => m === RULE).map(([c]) => c);
    if (ruled.length) return `${ruled[0]!.toUpperCase()} is in it · try it in another place`;
    if (r.pencils > 0) return "stuck? the pencil writes in one letter";
    return "any word will do · each line tells you more";
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  /** Marks the keyboard should show: lines whose marks have finished drawing. */
  function shownKeyMarks(slip: Slip): Map<string, Mark> {
    const out = new Map<string, Mark>();
    const at = lineAt.get(slip) ?? [];
    slip.lines.forEach((l, k) => {
      const t0 = at[k];
      if (t0 !== undefined && time - t0 < LINE_DONE) return;
      for (let i = 0; i < LETTERS; i++) {
        const c = l.word[i]!;
        const was = out.get(c);
        if (was === undefined || l.marks[i]! > was) out.set(c, l.marks[i]!);
      }
    });
    for (let i = 0; i < LETTERS; i++) if (slip.pencilled[i]) out.set(slip.known[i]!, RING);
    return out;
  }

  function drawRing(x: number, y: number, r: number, p: number, seed: number, color = SEAL, alpha = 1, w = 1.7) {
    handRing(ctx, x, y, r, p, seed, w, color, alpha);
  }
  function drawRule(x: number, half: number, y: number, p: number, w = 2, alpha = 1, seed = 0) {
    handRule(ctx, x - half, x + half, y, p, w, WALNUT, alpha, seed);
  }
  function drawStrike(x: number, half: number, y: number, p: number, w = 1.6, alpha = 0.9) {
    if (p <= 0) return;
    const x0 = x - half;
    const x1 = x0 + half * 2 * p;
    brushCurve(ctx, x0, y + 1.5, (x0 + x1) / 2, y - 0.5, x1, y - 2, 1, w * 1.4, GRAPHITE, alpha);
  }

  function drawCard(c: Box, alpha: number) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = CARD_EDGE;
    ctx.beginPath();
    ctx.roundRect(c.x + 1.5, c.y + 3, c.w, c.h, 4);
    ctx.fill();
    ctx.fillStyle = CARD;
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.w, c.h, 4);
    ctx.fill();
    ctx.strokeStyle = rgba(INK, 0.22);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** A slip: the header, six lines with their marks, the line being typed, the note band. */
  function drawSlip(slip: Slip, g: SlipGeo, alpha: number, current: boolean, r: Run | null) {
    drawCard(g.card, alpha);
    ctx.globalAlpha = alpha;
    // Header: what slip this is, and the line count.
    const hx = g.card.x + 14;
    const hy = g.head.y + 18;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = italic(15);
    ctx.fillStyle = slip.daily ? SEAL : GRAPHITE;
    ctx.fillText(slip.daily ? `today's word · no. ${issue}` : `slip ${roman(slip.n)}`, hx, hy);
    ctx.textAlign = "right";
    ctx.fillStyle = GRAPHITE;
    const used = slip.lines.length;
    ctx.fillText(slip.outcome === "open" ? `line ${roman(Math.min(LINES, used + 1))} of vi` : slip.outcome === "solved" ? `in ${words(used)}` : "unsolved", g.card.x + g.card.w - 14, hy);
    handRule(ctx, g.card.x + 10, g.card.x + g.card.w - 10, g.head.y + g.head.h - 1, 1, 0.6, INK, 0.45, slip.n);
    ctx.globalAlpha = 1;
    const at = lineAt.get(slip) ?? [];
    const half = g.cell * 0.3;
    const fs = g.type;
    for (let k = 0; k < LINES; k++) {
      const base = g.base0 + k * g.line;
      // The line's number in the margin, like a galley's.
      ctx.globalAlpha = alpha;
      ctx.font = italic(12);
      ctx.textAlign = "left";
      ctx.fillStyle = PENCIL;
      ctx.fillText(roman(k + 1), g.card.x + 10, base - 2);
      const line = slip.lines[k];
      if (line) {
        const t0 = at[k] ?? -10;
        for (let i = 0; i < LETTERS; i++) {
          const m = line.marks[i]!;
          const x = g.cx[i]!;
          const p = reduced ? (time - t0 >= 0.05 + i * MARK_STEP ? 1 : 0) : clamp01((time - t0 - 0.05 - i * MARK_STEP) / markDur(m));
          const struck = m === STRUCK && p > 0.5;
          ctx.font = serif(fs);
          ctx.textAlign = "center";
          // A solving line is set again in vermilion once its last ring is drawn, letter by letter.
          const red = slip.outcome === "solved" && k === slip.lines.length - 1 ? clamp01((time - t0 - LINE_DONE + 0.05 - i * 0.05) / 0.18) : 0;
          ctx.fillStyle = struck ? rgba(INK, 0.42) : red > 0 ? mixInk(red) : INK;
          ctx.globalAlpha = alpha;
          ctx.fillText(line.word[i]!.toUpperCase(), x, base - (reduced ? 0 : Math.sin(red * Math.PI) * 3));
          const mid = base - fs * 0.34;
          if (m === RING) drawRing(x, mid, Math.min(g.cell, g.line) * 0.43, p, k * 5 + i, SEAL, alpha);
          else if (m === RULE) drawRule(x, half, base + 6, p, 2, alpha, k + i);
          else drawStrike(x, half * 1.05, mid, p, 1.4, 0.85 * alpha);
        }
        continue;
      }
      // The line being typed.
      const isCur = current && r !== null && slip.outcome === "open" && k === slip.lines.length;
      if (isCur) {
        const sh = time - shakeAt < 0.36 && !reduced ? Math.sin((time - shakeAt) * 48) * 6 * (1 - (time - shakeAt) / 0.36) : 0;
        const v = r.view;
        const caretAt = v.caret ?? undefined;
        for (let i = 0; i < LETTERS; i++) {
          const x = g.cx[i]! + sh;
          const known = slip.known[i];
          const letter = v.letters[i];
          ctx.textAlign = "center";
          ctx.font = serif(fs);
          const ta = time - typedAt[i]!;
          const drop = !reduced && ta < 0.12 ? (1 - ta / 0.12) * -5 : 0;
          if (letter && v.typed[i]) {
            // Typed (or a known place confirmed): set in ink. A known place keeps its faint ring.
            ctx.globalAlpha = alpha;
            ctx.fillStyle = INK;
            ctx.fillText(letter.toUpperCase(), x, base + drop);
            if (known && !v.whole && known === letter) drawRing(x, base - fs * 0.34, Math.min(g.cell, g.line) * 0.43, 1, 3 + i, slip.pencilled[i] ? WALNUT : SEAL, 0.32 * alpha, 1.3);
          } else if (known && letter) {
            // Known and not yet typed: in pencil, inside a faint ring (the walnut pencil ring if the pencil wrote it).
            const pen = slip.pencilled[i];
            const pk = pencilAt.at === i && time - pencilAt.t < 0.5 ? clamp01((time - pencilAt.t) / 0.4) : 1;
            ctx.globalAlpha = alpha * pk;
            ctx.fillStyle = pen ? WALNUT : GRAPHITE;
            ctx.fillText(known.toUpperCase(), x, base);
            ctx.globalAlpha = 1;
            drawRing(x, base - fs * 0.34, Math.min(g.cell, g.line) * 0.43, pk, 3 + i, pen ? WALNUT : SEAL, (pen ? 0.75 : 0.32) * alpha, pen ? 1.2 : 1.3);
          } else {
            // An empty place: a short pencil tick (and the known letter, faintly, when a whole word is typed over it).
            ctx.globalAlpha = 1;
            handRule(ctx, x - half * 0.6, x + half * 0.6, base + 5, 1, 0.8, PENCIL, 0.7 * alpha, i);
            if (known) {
              ctx.globalAlpha = 0.25 * alpha;
              ctx.fillStyle = GRAPHITE;
              ctx.fillText(known.toUpperCase(), x, base);
            }
          }
        }
        // The caret (a proofreader's insertion mark) under the place the next key goes.
        if (caretAt !== undefined && r.live && !ended) {
          const x = g.cx[caretAt]! + sh;
          const bob = light.pulse(time, 1.2, { still: 0.5 }) * 2;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba(SEAL, 0.85 * alpha);
          ctx.lineWidth = 1.6;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(x - 5, base + 15 - bob);
          ctx.lineTo(x, base + 9 - bob);
          ctx.lineTo(x + 5, base + 15 - bob);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        continue;
      }
      // An empty line: five pencil ticks.
      ctx.globalAlpha = 1;
      for (let i = 0; i < LETTERS; i++) handRule(ctx, g.cx[i]! - half * 0.6, g.cx[i]! + half * 0.6, base + 5, 1, 0.7, PENCIL, 0.42 * alpha, i + k);
    }
    ctx.globalAlpha = 1;
  }

  /** The note band at the foot of the slip: the dictionary's verdict, the legend while learning, a missed word. */
  function drawNote(g: SlipGeo, slip: Slip | null, alpha: number) {
    const y = g.note.y + g.note.h / 2 + 5;
    const cx = g.card.x + g.card.w / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (leaving && leaving.kind === "missed" && slip === leaving.slip) {
      // The missed word, set in type one letter at a time, in vermilion.
      const t = time - leaving.t0 - LINE_DONE - 0.35;
      if (t < 0) return;
      ctx.globalAlpha = alpha;
      ctx.font = italic(15);
      ctx.fillStyle = GRAPHITE;
      ctx.textAlign = "right";
      ctx.fillText("it was", cx - 46, y);
      ctx.textAlign = "left";
      ctx.font = serif(19);
      ctx.fillStyle = SEAL;
      const word = leaving.slip.answer.toUpperCase();
      let x = cx - 38;
      for (let i = 0; i < word.length; i++) {
        if (t < i * 0.13) break;
        ctx.globalAlpha = alpha * clamp01((t - i * 0.13) / 0.1);
        ctx.fillText(word[i]!, x, y);
        x += ctx.measureText(word[i]!).width + 4;
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (note && slip && slip.outcome === "open") {
      const a = Math.min(1, (time - note.t) / 0.12) * (note.life - (time - note.t) < 0.3 ? (note.life - (time - note.t)) / 0.3 : 1);
      ctx.globalAlpha = a * alpha;
      ctx.font = italic(15);
      ctx.fillStyle = note.color;
      ctx.fillText(note.text, cx, y);
      ctx.globalAlpha = 1;
      return;
    }
    // While learning, after the first line: the three marks, drawn as they are.
    if (!taught && session.runs > 0 && slip && slip.lines.length > 0 && slip.outcome === "open") {
      const items: Array<[Mark, string]> = [
        [RING, "right place"],
        [RULE, "elsewhere"],
        [STRUCK, "not in it"],
      ];
      ctx.font = italic(14);
      const widths = items.map(([, t]) => ctx.measureText(t).width + 26);
      const total = widths.reduce((a, b) => a + b, 0) + 16;
      let x = cx - total / 2;
      ctx.globalAlpha = alpha;
      items.forEach(([m, t], i) => {
        const mx = x + 8;
        ctx.font = serif(15);
        ctx.textAlign = "center";
        ctx.fillStyle = m === STRUCK ? rgba(INK, 0.45) : INK;
        ctx.fillText("A", mx, y);
        if (m === RING) drawRing(mx, y - 5, 9, 1, 7, SEAL, alpha, 1.2);
        else if (m === RULE) drawRule(mx, 6, y + 4, 1, 1.6, alpha);
        else drawStrike(mx, 7, y - 5, 1, 1.1, 0.85 * alpha);
        ctx.font = italic(14);
        ctx.textAlign = "left";
        ctx.fillStyle = GRAPHITE;
        ctx.fillText(t, x + 20, y);
        x += widths[i]! + 8;
      });
      ctx.globalAlpha = 1;
    }
  }

  function drawSlips(r: Run) {
    const g = slipGeo();
    const fade = ended ? 0.3 + 0.7 * (1 - clamp01(endT / 0.6)) : 1;
    if (leaving && time < leaving.out + 0.45) {
      const lt = time - leaving.out;
      if (lt < 0) {
        drawSlip(leaving.slip, g, fade, false, null);
        drawSlipSeal(g, leaving.slip, fade);
        drawNote(g, leaving.slip, fade);
        return;
      }
      // The finished slip slides away to the upper left; the next one drops in.
      const k = easeInOut(clamp01(lt / 0.4));
      ctx.save();
      if (reduced) ctx.globalAlpha = 1 - k;
      else {
        ctx.translate(g.card.x, g.card.y);
        ctx.translate(-k * (g.card.w * 0.7), -k * 60);
        ctx.rotate(-0.08 * k);
        ctx.scale(1 - 0.25 * k, 1 - 0.25 * k);
        ctx.translate(-g.card.x, -g.card.y);
      }
      drawSlip(leaving.slip, g, (1 - k) * fade, false, null);
      drawSlipSeal(g, leaving.slip, (1 - k) * fade);
      ctx.restore();
    }
    // The current slip, dropping in when it was just set.
    const a = time - arriveAt;
    if (a < 0) return;
    const k = reduced ? 1 : easeOut(clamp01(a / 0.36));
    ctx.save();
    if (!reduced) ctx.translate(0, (1 - k) * -40);
    drawSlip(r.slip, g, (reduced ? clamp01(a / 0.2) : clamp01(a / 0.15)) * fade, true, r);
    ctx.restore();
    drawNote(g, r.slip, fade);
  }

  function drawSlipSeal(g: SlipGeo, slip: Slip, alpha: number) {
    const m = sealMoment;
    if (!m || m.slip !== slip) return;
    const sx = g.card.x + g.card.w - 30;
    const sy = g.card.y + 22;
    // A clean patch of paper for the impression, so its numeral reads.
    const k = reduced ? 1 : easeOut(clamp01((time - m.t0) / 0.2));
    ctx.globalAlpha = k * alpha;
    ctx.fillStyle = CARD;
    ctx.beginPath();
    ctx.roundRect(sx - m.size * 0.44, sy - m.size * 0.44, m.size * 0.88, m.size * 0.88, 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawSeal(ctx, sealFor(m.text, m.size), sx, sy, m.size, time - m.t0, reduced, -0.09, alpha);
  }

  function drawKeyboard(f: Frame, r: Run, slip: Slip, alpha: number, slide: number) {
    const kb = f.kb;
    if (!kb || alpha <= 0) return;
    const marks = shownKeyMarks(slip);
    const down = new Set([...presses.values()].map((p) => p.key.key));
    ctx.save();
    ctx.translate(0, (1 - slide) * (kb.box.h + 30));
    for (const k of kb.keys) {
      const flash = keyFlash.get(k.key);
      const pressed = down.has(k.key) || (flash !== undefined && time - flash < 0.1);
      const dy = pressed ? 1.5 : 0;
      const letter = k.row < 3;
      const m = letter ? marks.get(k.key) : undefined;
      const struck = m === STRUCK;
      let on = true;
      if (k.key === "write") on = r.full && !pending;
      if (k.key === "erase") on = r.typedCount > 0;
      if (k.key === "pencil") on = r.pencils > 0;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = CARD_EDGE;
      ctx.beginPath();
      ctx.roundRect(k.x + 0.8, k.y + 2.2, k.w, k.h, 4);
      ctx.fill();
      ctx.fillStyle = pressed ? "#EDE4D2" : struck ? "#E4DAC6" : letter ? CARD : on ? CARD : "#ECE4D4";
      ctx.beginPath();
      ctx.roundRect(k.x, k.y + dy, k.w, k.h, 4);
      ctx.fill();
      ctx.strokeStyle = rgba(INK, struck ? 0.12 : 0.24);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      const cx = k.x + k.w / 2;
      const cy = k.y + k.h / 2 + dy;
      if (letter) {
        const fs = Math.min(24, k.h * 0.46);
        ctx.font = serif(fs);
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = struck ? rgba(INK, 0.36) : INK;
        const base = cy + fs * 0.34;
        ctx.fillText(k.key.toUpperCase(), cx, base);
        const half = Math.min(k.w * 0.32, 10);
        if (m === RING) drawRing(cx, cy - 1, Math.min(k.w * 0.46, 15), 1, k.key.charCodeAt(0), SEAL, alpha, 1.5);
        else if (m === RULE) drawRule(cx, half, base + 5, 1, 2, alpha, k.key.charCodeAt(0));
        else if (m === STRUCK) drawStrike(cx, half * 1.1, cy - 1, 1, 1.2, 0.8 * alpha);
      } else drawAction(k, cx, cy, on, alpha);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawAction(k: KeyBox, cx: number, cy: number, on: boolean, alpha: number) {
    const c = on ? INK : PENCIL;
    ctx.textBaseline = "middle";
    ctx.font = italic(19);
    ctx.textAlign = "center";
    ctx.fillStyle = rgba(on ? INK : GRAPHITE, alpha);
    if (k.key === "erase") {
      // A slip's corner folded back: the shape of taking a letter away.
      const x = k.x + 20;
      ctx.beginPath();
      ctx.moveTo(x - 7, cy);
      ctx.lineTo(x - 1, cy - 7);
      ctx.lineTo(x + 10, cy - 7);
      ctx.lineTo(x + 10, cy + 7);
      ctx.lineTo(x - 1, cy + 7);
      ctx.closePath();
      inkStroke(ctx, 1.2, c, 0.9 * alpha);
      ctx.beginPath();
      ctx.moveTo(x + 1.5, cy - 3);
      ctx.lineTo(x + 7, cy + 3);
      ctx.moveTo(x + 7, cy - 3);
      ctx.lineTo(x + 1.5, cy + 3);
      inkStroke(ctx, 1.1, c, 0.9 * alpha);
      ctx.fillText("erase", cx + 10, cy + 1);
    } else if (k.key === "write") {
      const glow = on ? 1 : 0.5;
      drawNib(ctx, k.x + 22, cy + 9, 22, glow * alpha, 0.5);
      ctx.fillStyle = rgba(on ? SEAL : GRAPHITE, alpha);
      ctx.fillText("write", cx + 10, cy + 1);
    } else {
      const flash = keyFlash.get("pencil");
      const fresh = flash !== undefined && time - flash < 1.2 && on;
      // A pencil, lying at a slant.
      ctx.save();
      ctx.translate(k.x + 22, cy);
      ctx.rotate(-0.6);
      ctx.beginPath();
      ctx.rect(-9, -2.6, 14, 5.2);
      inkStroke(ctx, 1.1, on ? WALNUT : PENCIL, 0.9 * alpha);
      ctx.beginPath();
      ctx.moveTo(5, -2.6);
      ctx.lineTo(10, 0);
      ctx.lineTo(5, 2.6);
      inkStroke(ctx, 1.1, on ? WALNUT : PENCIL, 0.9 * alpha);
      ctx.restore();
      if (fresh) handRing(ctx, k.x + 22, cy, 15, clamp01((time - flash!) / 0.4), 4, 1.1, WALNUT, alpha * (1 - (time - flash!) / 1.2));
      ctx.fillStyle = rgba(on ? INK : GRAPHITE, alpha);
      ctx.fillText(`pencil ×${run?.pencils ?? 0}`, cx + 12, cy + 1);
    }
    ctx.textBaseline = "alphabetic";
  }

  function drawHud(r: Run, f: Frame, alpha: number) {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const top = f.top;
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
      ctx.fillStyle = rgba(clockAdd.color, k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      ctx.textAlign = "right";
      ctx.fillText(clockAdd.text, f.R - 50, top + 30 - k * 6);
    }
    // The slip number and the multiplier, centre.
    ctx.textAlign = "center";
    ctx.font = italic(18);
    ctx.fillStyle = INK;
    const shown = leaving && time < leaving.out + 0.2 ? leaving.slip : r.slip;
    ctx.fillText(shown.daily ? "today's word" : `slip ${roman(shown.n)}`, W / 2, top + 24);
    const mult = r.streak > 0 ? multShown : 1;
    // A tier-up swells the line for a moment.
    const tk = time - tierAt < 0.5 && !reduced ? Math.sin(((time - tierAt) / 0.5) * Math.PI) : 0;
    ctx.save();
    ctx.translate(W / 2, top + 40);
    ctx.scale(1 + 0.3 * tk, 1 + 0.3 * tk);
    ctx.font = italic(14);
    ctx.fillStyle = mult > 1 ? SEAL : GRAPHITE;
    ctx.fillText(mult > 1 ? `×${mult} · ${TIER_NAMES[mult]}` : r.streak > 0 ? "×2 at the next" : "clean solves climb", 0, 4);
    ctx.restore();
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
    if (!m || b.h <= 0) return;
    const a = Math.min(1, m.t / 0.12) * (m.life - m.t < 0.3 ? (m.life - m.t) / 0.3 : 1);
    let px = 18;
    ctx.font = italic(px);
    while (ctx.measureText(m.text).width > b.w - 20 && px > 12) ctx.font = italic(--px);
    const w = Math.min(b.w, ctx.measureText(m.text).width + 28);
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba(PAPER, 0.94);
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, b.y, w, b.h, 4);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = m.color;
    ctx.fillText(m.text, W / 2, b.y + b.h / 2 + 1);
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }

  function drawTitle(f: ReturnType<typeof attract>, alpha: number) {
    if (alpha <= 0) return;
    drawTitleBlock(ctx, { title: TITLE, kicker: `no. ${issue} · ${filed ? "today's word is filed" : "today's word inside"}`, dek: "five letters, six lines, one proofreader's pen." }, f.L, f.top, f.R - f.L, time, alpha, reduced);
    drawPrompt(ctx, "tap to begin", f.L + 2, f.prompt, time, reduced, alpha, 21);
    ctx.globalAlpha = alpha;
    ctx.font = italic(16);
    ctx.textAlign = "right";
    ctx.fillStyle = GRAPHITE;
    if ((session.best ?? 0) > 0) ctx.fillText(`best ${session.best!.toLocaleString("en-US")}`, f.R, f.prompt);
    ctx.globalAlpha = 1;
  }

  /** On the very first run, a nib taps the keyboard until the first letter is typed. */
  function drawTeach(r: Run, f: Frame) {
    if (taught || r !== run || !inPlay() || !f.kb || r.slip.lines.length > 0 || r.typedCount > 0) return;
    const k = f.kb.keys.find((b) => b.key === "s")!;
    const cyc = (time % 1.3) / 1.3;
    const tap = reduced ? 0 : Math.max(0, Math.sin(cyc * Math.PI * 2)) * 6;
    drawNib(ctx, k.x + k.w * 0.7, k.y + k.h * 0.65 - tap, 40, 0.85);
  }

  /** Where the share line sits on the summary (null when there's nothing to send). */
  let shareBox: Box | null = null;

  /**
   * After a run: a slip above the caption with how it went and one thing to try, and (once today's word is filed)
   * today's slip as marks only, with no letters, so it gives nothing away, and the line that sends it.
   */
  function drawSummary() {
    shareBox = null;
    if (!ended || !summary.length) return;
    const a = clamp01((endT - 0.5) / 0.4);
    if (a <= 0) return;
    const p = summaryPlate(W, H, session.preview(), session.standalone, filed !== null);
    const { card } = p;
    drawCard(card, a);
    ctx.globalAlpha = a;
    ctx.textAlign = "left";
    const fit = (text: string, i: number) => {
      let px: number = SUMMARY_PX[i]!;
      const room = i === 0 && isBest ? p.roomBest : p.room[i]!;
      ctx.font = italic(px);
      while (ctx.measureText(text).width > room && px > 11) ctx.font = italic(--px);
    };
    summary.forEach((line, i) => {
      fit(line, i);
      ctx.fillStyle = i === 0 ? INK : i === 1 ? SEAL : GRAPHITE;
      ctx.fillText(line, card.x + 14, p.base[i]!);
    });
    handRule(ctx, card.x + 14, card.x + card.w - 14, p.bar, 1, 0.6, PENCIL, 0.8, 1);
    const frac = isBest ? 1 : bestRatio;
    if (frac > 0) handRule(ctx, card.x + 14, lerp(card.x + 14, card.x + card.w - 14, frac), p.bar, clamp01((endT - 0.6) / 0.6), 2.2, isBest ? SEAL : INK, 0.85, 1);
    if (filed && p.grid) {
      const g = p.grid;
      const rows = Math.max(1, filed.marks.length);
      const pitch = Math.min(9, g.h / rows);
      const cw = g.w / 5;
      const y0 = g.y + (g.h - pitch * rows) / 2 + pitch / 2;
      filed.marks.forEach((row, k) => {
        row.forEach((m, i) => {
          const mx = g.x + cw * (i + 0.5);
          const my = y0 + k * pitch;
          const r = Math.min(cw, pitch) * 0.4;
          if (m === RING) drawRing(mx, my, r, 1, k * 5 + i, SEAL, a, 1);
          else if (m === RULE) drawRule(mx, r, my + r * 0.9, 1, 1.3, a);
          else drawStrike(mx, r, my, 1, 0.8, 0.8 * a);
        });
      });
      const [label, send] = dailyLine(filed.lines, shared);
      const ly = p.base[3]!;
      fit(label + send, 3);
      ctx.fillStyle = INK;
      ctx.fillText(label, card.x + 14, ly);
      const sx = card.x + 14 + ctx.measureText(label).width;
      ctx.fillStyle = shared === "yes" ? GRAPHITE : SEAL;
      ctx.fillText(send, sx, ly);
      if (shared !== "yes") handRule(ctx, sx, sx + ctx.measureText(send).width, ly + 5, 1, 0.9, SEAL, 0.7, 3);
      shareBox = { x: card.x + 4, y: ly - 28, w: card.w - 8, h: Math.max(44, card.y + card.h - (ly - 28)) };
    }
    if (isBest) drawSeal(ctx, sealFor("best", 44), card.x + card.w - 34, card.y - 6, 44, endT - 0.9, reduced, -0.12);
    ctx.globalAlpha = 1;
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.8) drawPrompt(ctx, "tap to begin again", card.x + 4, H - 26, session.phaseTime - 0.8, reduced, 1, 19);
  }

  function render() {
    view.begin();
    const o = shake.offset;
    const r = live();
    const pk = easeInOut(clamp01(layoutK));
    const af = attract();
    const pf = playFrame();
    ctx.save();
    ctx.translate(o.x, o.y);
    drawSlips(r);
    if (layoutTarget > 0.5) drawKeyboard(pf, r, leaving && time < leaving.out ? leaving.slip : r.slip, ended ? 0.35 : 1, pk);
    drawTeach(r, pf);
    ink.draw(ctx);
    ctx.restore();
    if (layoutTarget > 0.5) {
      drawHud(r, pf, pk);
      drawMessage(pf);
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
        void loadAccept();
      }
    },
    { maxDt: 1 },
  );
  // The title page opens on a slip already being read: the demo's first lines are written before the first frame.
  for (let i = 0; i < 4000 && demo.slip.lines.length < 2; i++) {
    demo.clock = TUNE.clockMax;
    const k = demoPilot.next(demo, 1 / 30);
    if (k) demo.press(k);
  }
  resetShow(demo);
}

void main();
