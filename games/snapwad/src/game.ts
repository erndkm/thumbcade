/**
 * The run: a pile of wads, page after page of forts, and the rules that pay you back. Pure and fixed-step (it runs
 * headless for the pilots and the tests), so the same seed and the same shots make the same run.
 *
 * - A tap starts the run with START_WADS wads. Pull back and let go: each shot takes one.
 * - A shot that knocks out a doodle gives its wad back. A chain of three in one shot gives one more, and so does a
 *   big topple (TOPPLE_N pieces off the books in one shot). Hitting a gold star sticker gives one. Never more than
 *   MAX_WADS.
 * - Knocking out every doodle clears the page: a bonus, and the next page arrives with a harder fort. Clearing a page
 *   with its first shot is a one-shot page: another wad and a tape ball (a heavy shot) for later.
 * - Wait too long and a wad uncrumples itself (IDLE_GRACE, then one every IDLE_STEP).
 * - The run ends when the wads are gone and the last shot has settled.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { aimFromDrag, assist, velocityOf } from "./aim.ts";
import { CASE, kindsOf, makeLayout, MAX_TOP, REST, VIEW_W, type Layout } from "./pages.ts";
import { Desk, STEP, type Impact, type Thing } from "./physics.ts";
import { isMite, isShot, MITES, specOf, TAPE, WAD, type Kind, type MiteKind } from "./pieces.ts";

export { STEP };

export const START_WADS = 5;
/** Knock-outs that draw a new wad. */
export const KO_PER_WAD = 2;
export let DIRECT_REFUND = true;
export const setDirect = (v: boolean) => (DIRECT_REFUND = v);
export const MAX_WADS = 5;
export const MAX_TAPE = 2;
export const MAX_RULER = 2;
/** Seconds between shots. */
export const RELOAD = 0.42;
export const IDLE_GRACE = 8;
export const IDLE_STEP = 2.6;
/** A page draws itself in, the fort falls quiet after a clear, then the page turns. */
export const DRAW_T = 0.85;
export const CLEAR_T = 1.45;
export const TURN_T = 0.8;
/** A new page settles this long, unseen, before it is drawn, so it sits exactly still. */
export const PRESETTLE = 2.5;
/** Pieces knocked off the books by one shot for a big topple. */
export const TOPPLE_N = 6;
/** The run ends this long after the last shot even if something is still rocking. */
export const END_WAIT = 3.4;
/** Closing speed (m/s) at which something landing on a doodle's head knocks it out. */
export const BONK = 1.3;
/** A doodle shoved this far (metres) off the spot it stood on is out too. */
export const SHOVE = 0.9;
/** A knocked-out doodle is scribbled out, then erased after this long. */
export const ERASE_T = 0.5;

export const CHAIN_NAMES = ["", "", "double knock!", "domino!", "landslide!", "pile-up!", "the whole desk!"];
export const chainName = (n: number): string => CHAIN_NAMES[Math.min(n, CHAIN_NAMES.length - 1)]!;
export const TOPPLE_NAMES = ["big topple!", "crumble!", "demolition!"];
export const toppleName = (n: number): string => (n >= TOPPLE_N * 3 ? TOPPLE_NAMES[2]! : n >= TOPPLE_N * 2 ? TOPPLE_NAMES[1]! : TOPPLE_NAMES[0]!);

export const PTS = { off: 10, snap: 25, burst: 20, star: 250, clear: 200, clearPerPage: 50, oneShot: 500 } as const;

export type KoHow = "hit" | "bonk" | "tip" | "fall" | "shove" | "gone";
export type RefundWhy = "direct" | "hit" | "chain" | "topple";

export type Ev =
  | { t: "fire"; kind: "wad" | "tape"; angle: number; power: number; ruled: boolean }
  | { t: "impact"; speed: number; x: number; y: number; a: Kind | null; b: Kind | null }
  | { t: "ko"; th: Thing; how: KoHow; chain: number; pts: number; x: number; y: number; last: boolean }
  | { t: "erase"; th: Thing; x: number; y: number }
  | { t: "snap"; x: number; y: number; angle: number }
  | { t: "burst"; kind: "pad" | "cup"; x: number; y: number }
  | { t: "off"; th: Thing; n: number }
  | { t: "refund"; n: number; why: RefundWhy }
  | { t: "meter"; n: number }
  | { t: "chain"; n: number; name: string }
  | { t: "topple"; n: number; name: string }
  | { t: "star"; x: number; y: number }
  | { t: "tape" }
  | { t: "clear"; page: number; oneShot: boolean; pts: number }
  | { t: "turn" }
  | { t: "page"; page: number; news: Kind[] }
  | { t: "drawn" }
  | { t: "lastStand"; th: Thing }
  | { t: "drain"; left: number }
  | { t: "spent"; th: Thing }
  | { t: "done" };

export type Phase = "draw" | "play" | "clear" | "turn" | "done";

interface Shot {
  th: Thing;
  kos: number;
  off: number;
  toppled: boolean;
  /** It already gave its wad back. */
  paid: boolean;
  /** What the shot touched first, for the game-over hint. */
  first: "piece" | "mite" | "book" | "desk" | "case" | null;
  firstY: number;
  firedAt: number;
  landedAt: number;
  maxX: number;
  maxY: number;
  done: boolean;
}

export interface Stats {
  shots: number;
  kos: number;
  pages: number;
  bestChain: number;
  off: number;
  snaps: number;
  bursts: number;
  oneShots: number;
  stars: number;
  drains: number;
  tapes: number;
  /** Shots that knocked nothing out. */
  blanks: number;
  /** Shots that flew over everything / fell short of the fort. */
  over: number;
  short: number;
  /** Shots whose first touch was a doodle. */
  direct: number;
  /** Doodles knocked out by the shot itself. */
  bullseyes: number;
  biggestTopple: number;
}

export interface RunOpts {
  /** Attract mode: start on a later page and never run dry (the demo gets wads back). */
  startPage?: number;
  /** Tests: play this page instead of the generated first one. */
  layout?: Layout;
}

export class Run {
  desk: Desk;
  layout: Layout;
  readonly seed: number;
  page: number;
  phase: Phase = "draw";
  phaseT = 0;
  /** Seconds of play (the run's clock, for the pilots and stats). */
  time = 0;
  wads = START_WADS;
  tape = 0;
  score = 0;
  events: Ev[] = [];
  stats: Stats = { shots: 0, kos: 0, pages: 0, bestChain: 0, off: 0, snaps: 0, bursts: 0, oneShots: 0, stars: 0, drains: 0, tapes: 0, blanks: 0, over: 0, short: 0, direct: 0, bullseyes: 0, biggestTopple: 0 };
  /** Shots fired on this page. */
  pageShots = 0;
  reload = 0;
  idle = 0;
  /** Shots left that show their whole flight (earned from star stickers). */
  ruler = 0;
  /** Knock-outs toward the next wad (every KO_PER_WAD draw one). */
  koMeter = 0;
  private drainT = 0;
  private sinceShot = 99;
  private shot: Shot | null = null;
  private shots: Shot[] = [];
  private seen = new Set<Kind>();
  private queued: { angle: number; power: number } | null = null;
  private lastStandSaid = false;
  /** Attract mode never runs dry. */
  readonly demo: boolean;

  constructor(seed: number, opts: RunOpts = {}) {
    this.seed = seed;
    this.demo = opts.startPage !== undefined;
    this.page = opts.startPage ?? 1;
    this.layout = opts.layout ?? makeLayout(this.page, seed);
    if (opts.layout) this.page = opts.layout.page;
    this.desk = this.build(this.layout);
    this.announce();
  }

  private build(layout: Layout): Desk {
    const d = new Desk(layout);
    for (let t = 0; t < PRESETTLE; t += STEP) d.step();
    d.impacts.length = 0;
    // Where the fort settled is where it "was put": knocked off and fell are measured from here.
    for (const th of d.things) {
      const p = th.body.getPosition();
      th.x0 = p.x;
      th.y0 = p.y;
      th.px = p.x;
      th.py = p.y;
      th.pa = th.body.getAngle();
      th.age = 0;
    }
    return d;
  }

  private announce(): void {
    const news: Kind[] = [];
    for (const k of kindsOf(this.layout)) {
      if (!this.seen.has(k)) {
        this.seen.add(k);
        if (this.page > 1 && !isMite(k)) news.push(k);
      }
    }
    if (this.page > 1 && this.layout.star && !this.seen.has("wad")) {
      // The first star sticker is news too (recorded under "wad", which no fort uses).
      this.seen.add("wad");
    }
    this.events.push({ t: "page", page: this.page, news });
  }

  get ammo(): number {
    return this.wads + this.tape;
  }

  get live(): number {
    return this.desk.live().length;
  }

  /** A shot is in the air (it hasn't touched anything yet). */
  get flying(): boolean {
    return this.shots.some((s) => !s.first && !s.done && !s.th.gone && s.th.age < 3.5);
  }

  /** Seconds since the last shot first touched something (or was fired, if it hasn't yet). */
  get sinceLanding(): number {
    const s = this.shot;
    if (!s) return 99;
    if (s.landedAt < 0 && (s.done || s.th.gone || s.th.age > 3.5)) s.landedAt = s.firedAt + Math.min(3.5, s.th.age);
    return s.landedAt >= 0 ? this.desk.time - s.landedAt : 0;
  }

  /** The next shot is a tape ball. */
  get nextIsTape(): boolean {
    return this.tape > 0;
  }

  canFire(): boolean {
    return (this.phase === "play" || this.phase === "draw") && this.ammo > 0 && this.reload <= 0;
  }

  /**
   * The thumb came up after pulling back by (dx, dy) CSS px: aim, nudge a near miss onto the doodle it nearly hit,
   * and fire. Returns the aim it fired, or null (a pull inside the dead zone is a cancel).
   */
  release(dx: number, dy: number): { angle: number; power: number } | null {
    const aim = aimFromDrag(dx, dy);
    if (!aim || !this.canFire()) return null;
    const a = this.phase === "play" ? assist(this.desk, aim.angle, aim.power, this.tape > 0) : aim;
    return this.fire(a.angle, a.power) ? a : null;
  }

  /** Fire at an aim. During the page's drawing-in the shot waits for the page; returns false if it can't go. */
  fire(angle: number, power: number): boolean {
    if (!this.canFire()) return false;
    if (this.phase === "draw") {
      this.queued = { angle, power };
      return true;
    }
    const kind = this.tape > 0 ? "tape" : "wad";
    const ruled = this.ruler > 0;
    if (ruled) this.ruler--;
    if (kind === "tape") {
      this.tape--;
      this.stats.tapes++;
    } else this.wads--;
    const { vx, vy } = velocityOf(angle, power);
    const th = this.desk.launch(kind, REST.x, REST.y, vx, vy);
    const s: Shot = { th, kos: 0, off: 0, toppled: false, paid: false, first: null, firstY: 0, firedAt: this.desk.time, landedAt: -1, maxX: REST.x, maxY: REST.y, done: false };
    this.shot = s;
    this.shots.push(s);
    this.stats.shots++;
    this.pageShots++;
    this.reload = RELOAD;
    this.idle = 0;
    this.drainT = 0;
    this.sinceShot = 0;
    this.events.push({ t: "fire", kind, angle, power, ruled });
    return true;
  }

  step(): void {
    if (this.phase === "done") return;
    this.phaseT += STEP;
    this.reload = Math.max(0, this.reload - STEP);
    if (this.phase === "draw") {
      if (this.phaseT >= DRAW_T) {
        this.setPhase("play");
        this.events.push({ t: "drawn" });
        if (this.queued) {
          const q = this.queued;
          this.queued = null;
          this.reload = 0;
          this.fire(q.angle, q.power);
        }
      }
      return;
    }
    if (this.phase === "turn") {
      if (this.phaseT >= TURN_T / 2 && this.layout.page !== this.page) {
        this.layout = makeLayout(this.page, this.seed);
        this.desk = this.build(this.layout);
        this.shots = [];
        this.shot = null;
        this.pageShots = 0;
        this.lastStandSaid = false;
        this.announce();
      }
      if (this.phaseT >= TURN_T) this.setPhase("draw");
      return;
    }
    this.time += STEP;
    this.sinceShot += STEP;
    this.desk.step();
    this.resolveImpacts();
    this.checkThings();
    if (this.desk.starHit && this.phase === "play") this.collectStar();
    if (this.phase === "play") {
      this.checkLastStand();
      if (this.desk.live().length === 0) this.clearPage();
    }
    if (this.phase === "clear") {
      if (this.phaseT >= CLEAR_T) {
        this.page++;
        this.setPhase("turn");
        this.events.push({ t: "turn" });
      }
      return;
    }
    // Idle wads uncrumple themselves.
    if (!this.flying) this.idle += STEP;
    if (this.idle > IDLE_GRACE && this.ammo > 0) {
      this.drainT += STEP;
      if (this.drainT >= IDLE_STEP) {
        this.drainT = 0;
        if (this.wads > 0) this.wads--;
        else this.tape--;
        this.stats.drains++;
        this.events.push({ t: "drain", left: this.ammo });
      }
    }
    if (this.demo && this.ammo === 0 && !this.flying) this.wads = START_WADS;
    // Out of wads: once the last shot has settled, the run is over.
    if (this.ammo === 0 && !this.flying && this.sinceShot > 0.6 && (this.desk.calm() || this.sinceShot > END_WAIT)) {
      this.setPhase("done");
      this.events.push({ t: "done" });
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  private resolveImpacts(): void {
    const imps = this.desk.impacts;
    for (let i = 0; i < imps.length; i++) {
      const im = imps[i]!;
      this.noteFirst(im, im.a, im.b);
      this.noteFirst(im, im.b, im.a);
      if (im.speed >= 1.1) this.events.push({ t: "impact", speed: im.speed, x: im.x, y: im.y, a: im.a?.kind ?? null, b: im.b?.kind ?? null });
      this.damage(im.a, im.dvA, im.b);
      this.damage(im.b, im.dvB, im.a);
      // Something falling on a doodle's head knocks it out, even gently (the normal points from a to b).
      if (im.speed >= BONK) {
        if (im.a && isMite(im.a.kind) && im.b && !isMite(im.b.kind) && im.ny > 0.6) this.knockOut(im.a, "bonk", isShot(im.b.kind));
        if (im.b && isMite(im.b.kind) && im.a && !isMite(im.a.kind) && im.ny < -0.6) this.knockOut(im.b, "bonk", isShot(im.a.kind));
      }
    }
    imps.length = 0;
  }

  private noteFirst(im: Impact, self: Thing | null, other: Thing | null): void {
    if (!self || !isShot(self.kind)) return;
    const s = this.shots.find((q) => q.th === self);
    if (!s || s.first) return;
    if (other) s.first = isMite(other.kind) ? "mite" : isShot(other.kind) ? null : "piece";
    else {
      // Scenery: the books, the desk or my pencil case (from where the hit was).
      s.first = im.y < 0.05 ? "desk" : im.x < CASE.x1 + 0.1 && im.y < CASE.top + 0.1 ? "case" : "book";
    }
    s.firstY = im.y;
    if (s.landedAt < 0) s.landedAt = this.desk.time;
    if (s.first === "mite") this.stats.direct++;
  }

  private damage(th: Thing | null, dv: number, by: Thing | null): void {
    if (!th || th.gone || dv <= 0) return;
    const spec = specOf(th.kind);
    if (dv < spec.breakDv) return;
    if (isMite(th.kind)) {
      this.knockOut(th, "hit", !!by && isShot(by.kind));
      return;
    }
    const p = th.body.getPosition();
    if (th.kind === "pencil") {
      const a = th.body.getAngle();
      this.desk.snap(th);
      this.stats.snaps++;
      this.score += PTS.snap;
      this.events.push({ t: "snap", x: p.x, y: p.y, angle: a });
    } else if (th.kind === "pad" || th.kind === "cup") {
      this.desk.remove(th);
      this.stats.bursts++;
      this.score += PTS.burst;
      this.events.push({ t: "burst", kind: th.kind, x: p.x, y: p.y });
    }
  }

  private knockOut(th: Thing, how: KoHow, direct = false): void {
    if (th.out >= 0) return;
    th.out = this.desk.time;
    const s = this.shot;
    const p = th.body.getPosition();
    const live = this.desk.live().length;
    let chain = 1;
    if (s) {
      s.kos++;
      chain = s.kos;
      if (chain === 2 || chain === 4) this.refund(1, "chain");
      if (chain >= 2) this.events.push({ t: "chain", n: chain, name: chainName(chain) });
    }
    // A doodle knocked out by the wad itself gives the wad back (once a shot); every KO_PER_WAD knocked out
    // otherwise (toppled, shoved, hit by a falling piece) draw a new one.
    if (DIRECT_REFUND && direct && s && !s.paid && s.first === "mite") {
      this.stats.bullseyes++;
      s.paid = true;
      this.refund(1, "direct");
    } else {
      this.koMeter++;
      if (this.koMeter >= KO_PER_WAD) {
        this.koMeter = 0;
        this.refund(1, "hit");
      } else this.events.push({ t: "meter", n: this.koMeter });
    }
    this.stats.kos++;
    this.stats.bestChain = Math.max(this.stats.bestChain, chain);
    const pts = MITES[th.kind as MiteKind].pts * chain;
    this.score += pts;
    this.events.push({ t: "ko", th, how, chain, pts, x: p.x, y: p.y, last: live === 0 });
  }

  private refund(n: number, why: RefundWhy): void {
    const room = MAX_WADS - this.wads;
    const got = Math.min(n, Math.max(0, room));
    this.wads += got;
    // A refund always says so, even into a full pile: the pile was full.
    this.events.push({ t: "refund", n: got, why });
  }

  private checkThings(): void {
    const t = this.desk.time;
    for (const th of this.desk.things) {
      if (th.gone) continue;
      const p = th.body.getPosition();
      const awayX = p.x < -0.8 || p.x > 8.8 || p.y < -2;
      if (isMite(th.kind)) {
        if (th.out >= 0) {
          if (t - th.out >= ERASE_T || awayX) {
            this.events.push({ t: "erase", th, x: p.x, y: p.y });
            this.desk.remove(th);
          }
          continue;
        }
        let a = th.body.getAngle() % (Math.PI * 2);
        if (a > Math.PI) a -= Math.PI * 2;
        if (a < -Math.PI) a += Math.PI * 2;
        // Past a radian from upright (a tick lying on another side is a third of a turn round) it has fallen over.
        th.tipT = Math.abs(a) > 1.0 ? th.tipT + STEP : 0;
        if (awayX) this.knockOut(th, "gone");
        else if (p.y < th.y0 - 1.0) this.knockOut(th, "fall");
        else if (Math.hypot(p.x - th.x0, p.y - th.y0) > SHOVE) this.knockOut(th, "shove");
        else if (th.tipT > 0.12) this.knockOut(th, "tip");
        continue;
      }
      if (isShot(th.kind)) {
        const s = this.shots.find((q) => q.th === th);
        if (s && !s.done) {
          s.maxX = Math.max(s.maxX, p.x);
          s.maxY = Math.max(s.maxY, p.y);
          if (th.still > 0.6 || th.age > 6 || awayX) this.finishShot(s);
        }
        if (awayX || (s?.done && th.still > 1.4) || th.age > 9) {
          this.events.push({ t: "spent", th });
          this.desk.remove(th);
        }
        continue;
      }
      if (!th.off && p.y < th.y0 - 1.4) {
        th.off = true;
        this.stats.off++;
        this.score += PTS.off;
        const s = this.shot;
        if (s) {
          s.off++;
          this.stats.biggestTopple = Math.max(this.stats.biggestTopple, s.off);
          if (s.off === TOPPLE_N) {
            s.toppled = true;
            this.refund(1, "topple");
          }
          if (s.off >= TOPPLE_N && (s.off === TOPPLE_N || s.off === TOPPLE_N * 2 || s.off === TOPPLE_N * 3)) this.events.push({ t: "topple", n: s.off, name: toppleName(s.off) });
        }
        this.events.push({ t: "off", th, n: s?.off ?? 0 });
      }
      if (awayX) this.desk.remove(th);
    }
  }

  private finishShot(s: Shot): void {
    if (s.done) return;
    s.done = true;
    if (s.kos === 0 && !s.toppled) {
      this.stats.blanks++;
      const piles = this.layout.piles;
      const x1 = piles.length ? piles[piles.length - 1]!.x1 : VIEW_W;
      const lowTop = piles.length ? Math.min(...piles.map((p) => p.top)) : 0;
      if (!s.first || ((s.first === "desk" || s.first === "book") && s.maxX > x1 - 0.1)) {
        if (s.maxY > MAX_TOP - 1 || s.maxX > x1) this.stats.over++;
      } else if (s.first === "desk" || s.first === "case" || (s.first === "book" && s.firstY < lowTop - 0.3)) this.stats.short++;
    }
  }

  private collectStar(): void {
    const st = this.layout.star!;
    this.desk.removeStar();
    this.stats.stars++;
    this.score += PTS.star;
    // A star sticker earns the ruler: the next shot shows its whole flight.
    this.ruler = Math.min(MAX_RULER, this.ruler + 1);
    this.events.push({ t: "star", x: st.x, y: st.y });
  }

  private checkLastStand(): void {
    if (this.lastStandSaid) return;
    const live = this.desk.live();
    if (live.length !== 1) return;
    const m = live[0]!;
    const p = m.body.getPosition();
    const v = m.body.getLinearVelocity();
    const danger = Math.hypot(v.x, v.y) > 1.4 || Math.abs(m.body.getAngle()) > 0.45 || p.y < m.y0 - 0.35;
    // A shot about to arrive: within a metre and a half and closing fast.
    let incoming = false;
    for (const s of this.shots) {
      if (s.done || s.th.gone) continue;
      const q = s.th.body.getPosition();
      const w = s.th.body.getLinearVelocity();
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5 && (dx * w.x + dy * w.y) / (d || 1) > 6) incoming = true;
    }
    if (danger || incoming) {
      this.lastStandSaid = true;
      this.events.push({ t: "lastStand", th: m });
    }
  }

  private clearPage(): void {
    // One wad, the whole page (a page with a single doodle is just a hit).
    const oneShot = this.pageShots === 1 && this.layout.pieces.filter((p) => isMite(p.kind)).length >= 2;
    this.stats.pages++;
    const pts = PTS.clear + PTS.clearPerPage * this.page + (oneShot ? PTS.oneShot : 0);
    this.score += pts;
    if (this.shot) this.finishShot(this.shot);
    this.events.push({ t: "clear", page: this.page, oneShot, pts });
    if (oneShot) {
      this.stats.oneShots++;
      if (this.page >= 3 && this.tape < MAX_TAPE) {
        this.tape++;
        this.events.push({ t: "tape" });
      }
    }
    this.setPhase("clear");
  }

  /** One hint picked from what actually happened in the run. */
  hint(): string {
    const s = this.stats;
    if (s.shots === 0) return HINTS.none;
    if (s.drains >= 2 && s.drains * 2 >= s.shots) return HINTS.idle;
    if (s.over >= 3 && s.over * 3 >= s.shots) return HINTS.over;
    if (s.short >= 3 && s.short * 3 >= s.shots) return HINTS.short;
    if (s.pages === 0) return HINTS.first;
    if (s.bestChain < 2) return HINTS.chain;
    if (s.oneShots === 0 && s.pages >= 2) return HINTS.oneShot;
    if (s.biggestTopple < TOPPLE_N) return HINTS.topple;
    if (s.stars === 0 && s.pages >= 3) return HINTS.star;
    if (s.direct * 2 > s.shots) return HINTS.legs;
    return HINTS.last;
  }
}

export const HINTS = {
  none: "pull back anywhere on the page and let go. the band does the rest",
  idle: "wads uncrumple if you wait too long. keep them flying",
  over: "a lot of my wads sailed right over. pull back a little less",
  short: "a lot of wads fell short. pull back further: the band is stronger than it looks",
  first: "knock out every doodle on the page and the next page turns. one hit gives the wad back",
  chain: "knock the legs out from under a fort: falling pieces knock out doodles for free",
  oneShot: "clear a page with a single wad and you get a tape ball. it hits like a textbook",
  topple: `knock ${TOPPLE_N} pieces off the books with one wad: a big topple gives a wad back`,
  star: "hit a gold star sticker for a wad back. they hang where only a lob reaches",
  legs: "aim at what holds a doodle up, not at the doodle: a topple can take two",
  last: "the last doodle on a page goes in slow motion. make it a good one",
} as const;

/** Seeds for runs: the same as the kit's rng, exposed for the pilots. */
export const runSeeds = (seed: number, n: number): number[] => {
  const r = createRng(seed);
  return Array.from({ length: n }, () => r.int(1, 2 ** 31 - 2));
};

/** A wad's or tape ball's radius (for drawing and the pilot). */
export const shotRadius = (k: "wad" | "tape"): number => (k === "tape" ? TAPE.r : WAD.r);
