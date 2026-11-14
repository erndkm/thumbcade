/**
 * Galebell: a lighthouse pinball table in a rising storm. Hold the left or right half of the screen to raise that
 * flipper (both at once work), tap to launch. Three balls, plus an extra ball you can earn; ring the buoys, light the
 * lamps, drop the flags, moor two balls in the harbour and call in the high tide. Every shot winds the storm up a
 * tier: more points for everything, and a quicker table.
 */
import "pixi.js/unsafe-eval";
import { createAudio } from "@thumbcade-games/kit/audio";
import { clamp } from "@thumbcade-games/kit/ease";
import { loadFonts } from "@thumbcade-games/kit/fonts";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { Application, Container, Ticker } from "pixi.js";
import { BUOYS, FLAGS, PAL } from "./art.ts";
import { BANNERS, comboName, hintFor, HINTS, jackpotName, TIERS } from "./copy.ts";
import { Hud, tierColor, type EndInfo } from "./hud.ts";
import { AimBuilder, Pilot, SKILLS, type SkillName } from "./pilot.ts";
import { Renderer } from "./render.ts";
import { Game, GE, type Controls, type GameEvent } from "./rules.ts";
import { createSfx } from "./sfx.ts";
import { buildTable } from "./table.ts";
import { Thumbs } from "./thumbs.ts";

/**
 * QA hooks, build time only: `VITE_AUTOPLAY=good` lets the pilot play the run through the same controls, and
 * `VITE_WARP=40` starts it that many seconds in (simulated headless at 60 Hz by the pilot, so it is the same every
 * time). A normal build has neither.
 */
const AUTOPLAY = (import.meta.env.VITE_AUTOPLAY as string | undefined) ?? "";
const WARP = Number((import.meta.env.VITE_WARP as string | undefined) ?? 0);

async function main() {
  const [session] = await Promise.all([createSession({ id: "galebell" }), loadFonts()]);
  const reduced = session.reducedMotion;
  let taught = false;
  try {
    taught = (await tc.storage.get<number>("taught")) === 1;
  } catch {
    /* storage unavailable: teach again */
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = window.innerWidth;
  let H = window.innerHeight;

  const app = new Application();
  await app.init({ width: W, height: H, resolution: dpr, autoDensity: true, antialias: false, background: PAL.ink, autoStart: false, preference: "webgl" });
  // Pixi's tickers would keep requestAnimationFrame alive through a pause; tc.loop drives everything.
  app.ticker.stop();
  Ticker.system.autoStart = false;
  Ticker.system.stop();
  Ticker.shared.autoStart = false;
  Ticker.shared.stop();
  app.canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  document.body.appendChild(app.canvas);
  const hudCanvas = document.createElement("canvas");
  hudCanvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none";
  document.body.appendChild(hudCanvas);

  const def = buildTable();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.18, decay: 0.45 });
  const shake = new Shake(7, 0.006, 2.2, reduced);
  const hitStop = new HitStop();
  const rend = new Renderer(def);
  app.stage.addChild(rend.stage);
  const hud = new Hud(hudCanvas, session, light);
  const audio = createAudio();
  const sfx = createSfx(audio);

  const layout = () => {
    app.renderer.resize(W, H);
    rend.layout(W, H, dpr, session.play().top);
    hud.resize(W, H, dpr);
    hud.bandAt = rend.sy(158);
  };
  layout();

  // --- the world ------------------------------------------------------------------------------------------------
  let game!: Game;
  let pilot: Pilot | null = null;
  let mode: "attract" | "play" = "attract";
  let runSeed = session.ctx.seed >>> 0;
  let overT = -1;
  let endSent = false;
  let bestBanner = false;
  let time = 0;
  let attractT = 0;
  let idleT = 0;
  let slipShown = false;
  const flips = [0, 0];

  function newAttract(): void {
    mode = "attract";
    attractT = 0;
    game = new Game({ seed: runSeed ^ 0x9e3779b9, attract: true });
    pilot = new Pilot(SKILLS.expert, runSeed + 17, def, true);
    // Start mid-action: the demo is already in play on the first frame.
    for (let i = 0; i < 160; i++) {
      game.step(1 / 60, pilot.update(game, 1 / 60));
      game.evCount = 0;
    }
    rend.clear();
  }

  function newRun(): void {
    mode = "play";
    runSeed = (runSeed + 0x6d2b79f5) >>> 0;
    game = new Game({ seed: runSeed });
    pilot = AUTOPLAY in SKILLS ? new Pilot(SKILLS[AUTOPLAY as SkillName], runSeed, def, WARP <= 0) : null;
    if (WARP > 0) {
      const warp = pilot ?? new Pilot(SKILLS.expert, runSeed, def, false);
      while (game.t < WARP && game.phase !== "over") {
        game.step(1 / 60, warp.update(game, 1 / 60));
        game.evCount = 0;
      }
    }
    overT = -1;
    endSent = false;
    bestBanner = false;
    slipShown = false;
    idleT = 0;
    flips[0] = flips[1] = 0;
    hud.clear();
    hud.end = null;
    hud.setScore(game.score, true);
    hud.showHint = !taught && !pilot;
    rend.clear();
    thumbs.cancelAll();
    sfx.music(true);
    tc.analytics.track("level_start", { level: 1 });
  }

  // --- input: hold a half of the screen; a short tap launches ------------------------------------------------------
  const thumbs = new Thumbs();
  const keys = [false, false];
  let tapLaunch = false;
  const pressed: [boolean, boolean] = [false, false];
  const playing = () => mode === "play" && session.phase === "playing" && !pilot;
  window.addEventListener("pointerdown", (e) => {
    if (!playing()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    thumbs.down(e.pointerId, e.clientX, e.clientY, performance.now(), W);
  });
  window.addEventListener("pointerup", (e) => {
    if (thumbs.up(e.pointerId, e.clientX, e.clientY, performance.now())) tapLaunch = true;
  });
  window.addEventListener("pointercancel", (e) => thumbs.cancel(e.pointerId));
  // The feed took the gesture: let go of everything.
  session.on("cancel", () => thumbs.cancelAll());
  const keySide = (code: string) => (code === "ArrowLeft" || code === "KeyZ" || code === "ShiftLeft" ? 0 : code === "ArrowRight" || code === "Slash" || code === "KeyM" || code === "ShiftRight" ? 1 : -1);
  window.addEventListener("keydown", (e) => {
    const s = keySide(e.code);
    if (s >= 0) {
      keys[s] = true;
      e.preventDefault();
    }
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (session.phase !== "playing") session.start();
      else tapLaunch = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    const s = keySide(e.code);
    if (s >= 0) keys[s] = false;
  });
  session.startOnTap(window);
  session.on("start", () => newRun());

  // --- what happened ------------------------------------------------------------------------------------------------
  const fmt = (n: number) => n.toLocaleString("en-US");
  const sx = (x: number) => rend.sx(x);
  const sy = (y: number) => rend.sy(y);
  const own = () => mode === "play";

  function onEvent(e: GameEvent): void {
    const big = own();
    switch (e.type) {
      case GE.Flip:
        sfx.flip(e.a);
        break;
      case GE.FlipperHit:
        sfx.flipperHit(e.b, e.a);
        if (e.b > 900) rend.burst(e.x, e.y, PAL.lampHi, 4, 180, 5);
        break;
      case GE.Bumper: {
        rend.bumperHit(e.a);
        sfx.bell(e.a, game.tier, e.b);
        rend.burst(e.x, e.y, BUOYS[e.a]!.color, 6, 240, 6);
        shake.add(0.07);
        if (big) hud.popup(`+${fmt(100 * game.tier)}`, sx(e.x), sy(e.y) - 20, BUOYS[e.a]!.color, 11);
        break;
      }
      case GE.Sling:
        rend.slingKick(e.a);
        sfx.sling(e.a);
        rend.burst(e.x, e.y, PAL.seaHi, 5, 200, 5);
        shake.add(0.05);
        break;
      case GE.Wall:
      case GE.BallBall:
        sfx.wall(e.a, time);
        break;
      case GE.Target:
        sfx.flag(e.a);
        rend.burst(e.x, e.y, FLAGS[e.a]!.bg, 8, 220, 6);
        shake.add(0.08);
        break;
      case GE.Flags:
        sfx.flags();
        rend.ring(169, 308, PAL.lamp, 60);
        if (big) hud.banner(BANNERS.flags[0], e.a ? "HARBOUR OPEN · LOCK LIT" : BANNERS.flags[1], PAL.lamp);
        break;
      case GE.FlagsReset:
        sfx.flagsReset();
        break;
      case GE.Lane:
        sfx.lane(time);
        rend.burst(e.x, e.y, PAL.lamp, 4, 140, 5);
        break;
      case GE.Lamps:
        sfx.lamps();
        rend.chaseLights();
        for (const x of [135, 169, 203]) rend.burst(x, 100, PAL.lampHi, 6, 200, 6);
        if (big) hud.banner(BANNERS.lamps[0], `+${fmt(2500 * game.tier)}`, PAL.lampHi);
        break;
      case GE.LaneShift:
        break;
      case GE.Spin:
        sfx.spin(e.b, time);
        break;
      case GE.Whirl:
        sfx.whirl();
        if (big) hud.popup(`WHIRL ×${e.a}`, sx(e.x) + 24, sy(e.y) - 10, PAL.seaHi, 13, true, 1);
        break;
      case GE.Orbit:
        sfx.orbit();
        rend.ring(e.a ? 307 : 31, 352, PAL.lamp, 36);
        if (big) hud.popup(`ORBIT +${fmt(1000 * game.tier)}`, sx(e.a ? 290 : 48), sy(330), PAL.lampHi, 14, true, 1.1);
        break;
      case GE.Harbour:
        sfx.harbour();
        rend.harbourPulse();
        rend.ring(e.x, e.y, PAL.lamp, 34);
        hitStop.freeze(reduced ? 0.02 : 0.05);
        break;
      case GE.Kickout:
        sfx.kickout();
        rend.burst(e.x, e.y, PAL.paper, 5, 160, 5);
        break;
      case GE.Lock:
        sfx.lock();
        rend.burst(e.x, e.y, PAL.lamp, 14, 260, 7);
        if (big) {
          const b = e.a >= 2 ? BANNERS.lock2 : BANNERS.lock1;
          hud.banner(b[0], b[1], PAL.lampHi, e.a >= 2, 1.8);
          if (e.a >= 2) session.feedback("success");
        }
        break;
      case GE.Multiball:
        sfx.multiball();
        flash.trigger(PAL.lampHi, 0.7);
        shake.add(0.5);
        hitStop.freeze(reduced ? 0.04 : 0.12);
        rend.chaseLights();
        rend.ring(e.x, e.y, PAL.lampHi, 90);
        if (big) {
          hud.banner(BANNERS.multiball[0], BANNERS.multiball[1], PAL.lampHi, true, 2.2);
          session.feedback("success");
        }
        break;
      case GE.MultiballEnd:
        sfx.multiballEnd();
        if (big) hud.banner(BANNERS.tideEnd[0], `${e.a} JACKPOT${e.a === 1 ? "" : "S"}`, PAL.seaHi);
        break;
      case GE.Jackpot:
        sfx.jackpot(e.b);
        flash.trigger(PAL.lamp, 0.6);
        shake.add(0.4);
        hitStop.freeze(reduced ? 0.03 : 0.09);
        rend.burst(e.x, e.y, PAL.lampHi, 18, 320, 8);
        if (big) {
          hud.banner(jackpotName(e.b), `+${fmt(e.a)}`, PAL.lampHi, true, 1.8);
          session.feedback("impact");
        }
        break;
      case GE.SuperLit:
        if (big) hud.banner(BANNERS.superLit[0], BANNERS.superLit[1], PAL.gold);
        break;
      case GE.Super:
        sfx.super();
        flash.trigger(PAL.gold, 0.8);
        shake.add(0.7);
        hitStop.freeze(reduced ? 0.05 : 0.16);
        rend.chaseLights();
        rend.burst(e.x, e.y, PAL.gold, 30, 380, 9);
        rend.ring(e.x, e.y, PAL.gold, 110);
        if (big) {
          hud.banner(BANNERS.super[0], `+${fmt(e.a)}`, PAL.gold, true, 2.2);
          session.feedback("success");
        }
        break;
      case GE.TierUp: {
        const tier = TIERS[e.a - 1]!;
        sfx.tier(e.a);
        flash.trigger(tierColor(e.a), 0.5);
        shake.add(0.3);
        hitStop.freeze(reduced ? 0.03 : 0.08);
        rend.chaseLights();
        hud.tierPop.kick(8);
        if (big) {
          hud.banner(tier.name, `×${e.a} · ${tier.line}`, tierColor(e.a), true, 2);
          session.feedback("success");
          tc.analytics.track("milestone", { tier: e.a });
        }
        break;
      }
      case GE.Combo:
        sfx.combo(e.a);
        if (big) hud.combo = { n: e.a, name: comboName(e.a), pts: e.b, t: 0 };
        break;
      case GE.ExtraLit:
        if (big) hud.banner(BANNERS.extraLit[0], BANNERS.extraLit[1], PAL.gold, false, 2);
        break;
      case GE.ExtraBall:
        sfx.extra();
        flash.trigger(PAL.gold, 0.7);
        shake.add(0.4);
        hitStop.freeze(reduced ? 0.04 : 0.12);
        rend.burst(e.x, e.y, PAL.gold, 24, 340, 8);
        if (big) {
          hud.banner(BANNERS.extra[0], BANNERS.extra[1], PAL.gold, true, 2.2);
          session.feedback("success");
        }
        break;
      case GE.Save:
        sfx.save();
        if (big) hud.banner(BANNERS.save[0], BANNERS.save[1], PAL.kelp);
        break;
      case GE.Drain:
        sfx.drain();
        rend.burst(169, 630, PAL.seaHi, 16, 260, 7);
        shake.add(0.25);
        if (big) session.feedback("impact");
        break;
      case GE.Bonus:
        break;
      case GE.BallStart:
        if (big && e.a > 1) {
          const last = e.b === 0;
          hud.banner(last ? BANNERS.last[0] : `BALL ${Math.min(3, e.a)}`, last ? BANNERS.last[1] : `${e.b + 1} TO PLAY`, PAL.paper);
        }
        break;
      case GE.Launch:
        sfx.launch();
        break;
      case GE.GameOver:
        sfx.over();
        sfx.music(false);
        overT = 0;
        break;
      case GE.Slip:
        sfx.slip();
        if (big && !slipShown) {
          slipShown = true;
          hud.banner(BANNERS.slip[0], BANNERS.slip[1], PAL.coral);
        }
        break;
      case GE.GoldLit:
        sfx.gold();
        if (big) hud.banner(BANNERS.gold[0], `RING IT FOR ${fmt(2000 * game.tier)}`, PAL.gold, false, 1.4);
        break;
      case GE.GoldHit:
        sfx.gold();
        rend.burst(e.x, e.y, PAL.gold, 16, 300, 8);
        rend.ring(e.x, e.y, PAL.gold, 50);
        shake.add(0.2);
        if (big) hud.popup(`GOLD +${fmt(2000 * game.tier)}`, sx(e.x), sy(e.y) - 26, PAL.gold, 16, true, 1.2);
        break;
      case GE.Points:
        if (big && e.a >= 300) hud.popup(`+${fmt(e.a)}`, sx(e.x), sy(e.y) - 14, PAL.paper, e.a >= 5000 ? 15 : 12, false, 0.9);
        break;
      case GE.Inlane:
      case GE.Nudge:
        break;
    }
  }

  // --- frame --------------------------------------------------------------------------------------------------------
  function update(rawDt: number): void {
    session.tick(rawDt);
    time += rawDt;
    hud.update(rawDt);
    flash.update(rawDt);
    shake.update(rawDt);
    const dt = hitStop.scale(rawDt);
    // Thumbs.
    let c: Controls;
    if (pilot) c = pilot.update(game, dt);
    else if (playing()) {
      c = { left: keys[0]! || thumbs.side(0), right: keys[1]! || thumbs.side(1), launch: tapLaunch };
    } else c = { left: false, right: false, launch: false };
    tapLaunch = false;
    pressed[0] = c.left;
    pressed[1] = c.right;
    if (mode === "play" && !pilot) {
      // Teaching: gone once both sides have been used a couple of times.
      for (let i = 0; i < 2; i++) if (c[i ? "right" : "left"] && !game.world.flippers[i]!.pressed) flips[i]!++;
      if (!taught && flips[0]! >= 2 && flips[1]! >= 2) {
        taught = true;
        hud.showHint = false;
        tc.storage.set("taught", 1).catch(() => undefined);
        tc.analytics.track("tutorial_complete");
      }
      const anyBall = game.world.balls.some((b) => b !== game.laneBall);
      idleT = c.left || c.right || !anyBall ? 0 : idleT + rawDt;
      hud.nudge = clamp(hud.nudge + (idleT > 6 && taught ? rawDt * 2 : -rawDt * 3));
    }
    if (session.phase === "playing" || mode === "attract") game.step(dt, c);
    game.drain(onEvent);

    if (mode === "attract") {
      attractT += rawDt;
      if (attractT > 70 || game.phase === "over") newAttract();
      return;
    }
    hud.setScore(game.score);
    if (!bestBanner && session.best !== null && session.best > 0 && game.score > session.best && session.phase === "playing") {
      bestBanner = true;
      hud.banner("NEW BEST", "KEEP IT ROLLING", PAL.gold, true, 1.8);
      rend.burst(169, 300, PAL.gold, 20, 300, 8);
      sfx.extra();
      hud.scorePop.kick(6);
      session.feedback("success");
    }
    if (overT >= 0) {
      overT += rawDt;
      if (!endSent && overT > 0.5) {
        endSent = true;
        const prev = session.best;
        const st = game.stats;
        const r = session.end(game.score, {
          outcome: "lose",
          stats: { tier: st.tier, orbits: st.orbits, jackpots: st.jackpots, combo: st.maxCombo, seconds: Math.round(game.t) },
        });
        const info: EndInfo = { score: game.score, prevBest: prev, isBest: r.isBest, stats: { ...st }, hint: HINTS[hintFor(st)] };
        hud.end = info;
        hud.scorePop.kick(4);
        if (r.isBest && game.score > 0) rend.burst(169, 300, PAL.gold, 24, 320, 8);
      }
    }
  }

  function render(rawDt: number): void {
    const o = shake.offset;
    rend.draw(game, time, hitStop.active ? 0 : rawDt, light, o.x / rend.k, o.y / rend.k, reduced, pressed);
    Ticker.system.update(performance.now());
    app.renderer.render(app.stage);
    hud.begin(dpr);
    if (mode === "attract") hud.drawAttract(time);
    else {
      hud.drawPlay(game, rend, time, pressed);
      if (session.phase === "over") hud.drawSummary(time);
    }
    flash.draw(hud.ctx, W, H);
  }

  window.addEventListener("resize", () => {
    W = window.innerWidth;
    H = window.innerHeight;
    layout();
  });
  session.on("insets", () => {
    hud.titlePop.kick(3);
    layout();
  });

  /** Draws every texture once before ready(), so uploads never land in attract mode. */
  function warmUp(): void {
    const tmp = new Container();
    for (const s of rend.prewarmSprites()) tmp.addChild(s);
    app.stage.addChild(tmp);
    app.renderer.render(app.stage);
    app.stage.removeChild(tmp);
    tmp.destroy({ children: true });
  }

  newAttract();
  warmUp();
  hud.titlePop.target = 1;
  let frames = 0;
  const aim = new AimBuilder(def);
  tc.loop((dt) => {
    const d = Math.min(dt, 1 / 20);
    update(d);
    render(d);
    if (++frames === 3) session.ready();
    // The pilot's cradle table fills in a little each frame after ready() (a few ms, never a long task).
    else if (frames > 3 && !aim.done) aim.step(2.5);
  });
}

void main();
