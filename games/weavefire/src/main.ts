/**
 * Weavefire: a sixty-second vertical shooter. Drag anywhere to fly the shuttle (it moves by the finger's delta, never
 * jumps under it), the guns fire on their own, and power comes from badges you fly into. Weave through the fire, skim
 * bullets for sparks, keep the chain alive, and break the Loom near the end of the minute; after it falls the run goes
 * into overdrive and heats up until it ends.
 */
import "pixi.js/unsafe-eval";
import { createAudio } from "@thumbcade-games/kit/audio";
import { clamp, damp } from "@thumbcade-games/kit/ease";
import { loadFonts } from "@thumbcade-games/kit/fonts";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { Application, Container, Sprite, Ticker } from "pixi.js";
import { MAX_LEVEL, PAL } from "./consts.ts";
import { Hud, multColor, type EndInfo } from "./hud.ts";
import { Pilot, SKILLS, type SkillName } from "./pilot.ts";
import { C, PICKUP_COLOR, Renderer, type View } from "./render.ts";
import { createSfx } from "./sfx.ts";
import { EV, Sim, type EnemyKind, type PickupKind, type RunStats, type SimEvent } from "./sim.ts";
import { createTextures } from "./textures.ts";

/** QA hooks, build time only: `VITE_AUTOPLAY=good` lets the pilot fly the run; `VITE_WARP=36` starts it that many seconds in. */
const AUTOPLAY = (import.meta.env.VITE_AUTOPLAY as string | undefined) ?? "";
const WARP = Number((import.meta.env.VITE_WARP as string | undefined) ?? 0);

/** The ship moves by the finger's delta times this (a little more than 1:1 saves thumb travel). */
const GAIN = 1.12;

const SIZE: Record<EnemyKind, number> = { dart: 1, weaver: 0.9, bloom: 2, bastion: 3, skiff: 1.6, arm: 2.6, core: 4 };

async function main() {
  const [session] = await Promise.all([createSession({ id: "weavefire" }), loadFonts()]);
  const reduced = session.reducedMotion;
  let flown = false;
  try {
    flown = (await tc.storage.get<number>("flown")) === 1;
  } catch {
    /* storage unavailable: show the hint */
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

  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.2, decay: 0.45 });
  const shake = new Shake(9, 0.01, 2, reduced);
  const hitStop = new HitStop();
  const tex = createTextures();
  const rend = new Renderer(tex);
  app.stage.addChild(rend.stage);
  const hud = new Hud(hudCanvas, session, light);
  const audio = createAudio();
  const sfx = createSfx(audio);

  const layout = () => {
    app.renderer.resize(W, H);
    rend.layout(W, H);
    hud.resize(W, H, dpr);
  };
  layout();

  // --- the world ------------------------------------------------------------------------------------------
  let sim!: Sim;
  let pilot: Pilot | null = null;
  let mode: "attract" | "play" = "attract";
  let runSeed = session.ctx.seed >>> 0;
  let overT = -1;
  let endSent = false;
  let slowmo = 0;
  let bestBanner = false;
  let time = 0;
  let scroll = 0;
  let bossTint = 0;
  let bank = 0;
  let lastShipX = 0;
  let thumbX = W / 2;
  let thumbY = H * 0.8;

  const attractMaxY = () => (H - session.preview().bottom - 26) / rend.k;

  function newAttract(): void {
    mode = "attract";
    sim = new Sim({ seed: runSeed ^ 0x9e3779b9, fieldH: rend.fieldH, attract: true, shipMaxY: attractMaxY() });
    sim.setShipZone(rend.fieldH * 0.5, attractMaxY());
    sim.placeShip(180, attractMaxY() - 30);
    pilot = new Pilot(SKILLS.good, runSeed + 17);
    // Start mid-action: the demo is already busy on the first frame.
    for (let i = 0; i < 120; i++) {
      pilot.update(sim, 1 / 60);
      sim.step(1 / 60);
    }
    sim.evCount = 0;
    lastShipX = sim.ship.x;
  }

  function newRun(): void {
    const from = sim?.ship;
    mode = "play";
    runSeed = (runSeed + 0x6d2b79f5) >>> 0;
    sim = new Sim({ seed: runSeed, fieldH: rend.fieldH });
    if (from) sim.placeShip(from.x, Math.max(sim.shipMinY, Math.min(sim.shipMaxY, from.y + 10)));
    pilot = AUTOPLAY in SKILLS ? new Pilot(SKILLS[AUTOPLAY as SkillName], runSeed) : null;
    if (WARP > 0) {
      const warp = pilot ?? new Pilot(SKILLS.expert, runSeed);
      while (sim.t < WARP && sim.ship.alive) {
        warp.update(sim, 1 / 60);
        sim.step(1 / 60);
      }
      sim.evCount = 0;
    }
    overT = -1;
    endSent = false;
    slowmo = 0;
    bestBanner = false;
    hud.clear();
    hud.end = null;
    hud.setScore(sim.score, true);
    hud.showHint = !flown && !pilot;
    rend.reset();
    lastShipX = sim.ship.x;
    sfx.music(true);
    tc.analytics.track("level_start", { level: 1 });
  }

  // --- input ------------------------------------------------------------------------------------------------
  let pid = -1;
  let lastX = 0;
  let lastY = 0;
  let travel = 0;
  const release = (e?: PointerEvent) => {
    if (e && e.pointerId !== pid) return;
    pid = -1;
  };
  window.addEventListener("pointerdown", (e) => {
    if (pid !== -1) return;
    pid = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode !== "play" || session.phase !== "playing" || pilot) return;
    // The ship follows the finger's motion on this very event, so it is drawn in the same frame.
    sim.moveShip((dx * GAIN) / rend.k, (dy * GAIN) / rend.k);
    travel += Math.abs(dx) + Math.abs(dy);
    if (!flown && travel > 70) {
      flown = true;
      hud.showHint = false;
      tc.storage.set("flown", 1).catch(() => undefined);
      tc.analytics.track("tutorial_complete");
    }
  });
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  // The feed took the gesture: forget the finger; the ship simply stays where it is.
  session.on("cancel", () => release());

  session.startOnTap(window);
  session.on("start", () => newRun());

  // --- what happened this frame --------------------------------------------------------------------------------
  const k = () => rend.k;
  const css = (x: number) => x * k();
  const fmt = (n: number) => n.toLocaleString("en-US");
  const LABELS: Record<PickupKind, string> = { power: "GUN +1", drone: "DRONE", shield: "SHIELD", nova: "NOVA" };
  const pickupLabel = (kind: PickupKind) =>
    kind === "power" && sim.ship.level >= MAX_LEVEL ? "GUN MAX +2K" : kind === "shield" && sim.ship.shields >= 3 ? "SHIELD +1.5K" : kind === "drone" && sim.ship.drones >= 2 ? "DRONE +1.5K" : LABELS[kind];
  const playing = () => mode === "play" && session.phase === "playing";
  const lastFormation = { t: -9, y: 0 };

  function onEvent(e: SimEvent): void {
    const attract = mode === "attract";
    switch (e.type) {
      case EV.shot:
        sfx.shot(e.a, time);
        break;
      case EV.hit:
        rend.hitSpark(e.x, e.y, C.white);
        sfx.hit(time);
        break;
      case EV.deflect:
        rend.hitSpark(e.x, e.y, C.loomGold);
        if (Math.random() < 0.3) sfx.deflect();
        break;
      case EV.kill: {
        const kind = e.kind as EnemyKind;
        const size = SIZE[kind];
        rend.explode(kind, e.x, e.y, size, reduced);
        sfx.kill(size, e.b, time);
        if (!attract || size >= 2) hud.popup(`+${fmt(e.a)}`, css(e.x), css(e.y) - 8, multColor(e.b), size >= 2 ? 14 : 11);
        if (size >= 2.5) {
          hitStop.freeze(reduced ? 0.02 : 0.05);
          shake.add(0.28);
          if (playing()) session.feedback("impact");
        } else if (size >= 2) shake.add(0.14);
        else shake.add(0.04);
        break;
      }
      case EV.formation: {
        // Below the last kill and clear of the edges, so it never sits on the kill's own pop-up.
        const fx = clamp(css(e.x), 74, W - 74);
        let fy = clamp(css(e.y) + 34, session.play().top + 110, H - 80);
        // Two formations finished together stack instead of printing over each other.
        if (time - lastFormation.t < 0.8 && Math.abs(fy - lastFormation.y) < 44) fy = lastFormation.y + 46;
        lastFormation.t = time;
        lastFormation.y = fy;
        hud.popup("FORMATION", fx, fy, PAL.crystal, 17, true, 1.15);
        hud.popup(`+${fmt(e.a)}`, fx, fy + 20, PAL.crystal, 14, false, 1.15);
        rend.pickupBurst(e.x, e.y, C.crystal);
        sfx.formation();
        shake.add(0.1);
        break;
      }
      case EV.graze:
        rend.graze(e.x, e.y, sim.ship.x, sim.ship.y, e.b);
        sfx.graze(e.b);
        if (e.b > 0 && e.b % 10 === 0) hud.popup(`GRAZE ×${e.b}`, css(sim.ship.x), css(sim.ship.y) - 40, PAL.paper, 13, true, 0.9);
        break;
      case EV.crystal:
        rend.crystalPop(e.x, e.y);
        sfx.crystal(time);
        break;
      case EV.pickup:
        rend.pickupBurst(e.x, e.y, PICKUP_COLOR[e.kind as PickupKind]);
        sfx.pickup();
        if (playing()) session.feedback("tap");
        break;
      case EV.levelUp:
        rend.levelUp(sim.ship.x, sim.ship.y, e.a);
        sfx.level(e.a);
        if (!attract) {
          hud.banner(e.b ? "GUN BACK" : `GUN LV ${e.a}`, e.a >= MAX_LEVEL ? "FULL POWER" : e.b ? "NICE CATCH" : "+1 STREAM", PAL.accent);
          if (playing()) session.feedback("success");
        }
        break;
      case EV.droneUp:
        if (!attract) hud.banner("DRONE ONLINE", e.a > 1 ? "BOTH WINGS COVERED" : "IT HUNTS ON ITS OWN", PAL.paper);
        sfx.level(3);
        break;
      case EV.shieldUp:
        if (!attract) hud.banner("SHIELD +1", `${e.a} OF 3`, "#8CB8FF");
        sfx.shield();
        break;
      case EV.maxedBonus:
        hud.popup(`MAXED +${fmt(e.a)}`, css(e.x), css(e.y) - 16, PAL.crystal, 13, true, 1);
        break;
      case EV.nova:
        rend.nova(e.x, e.y);
        flash.trigger(PAL.bloom, 0.5);
        shake.add(0.4);
        sfx.nova();
        if (!attract) hud.banner("NOVA", "BULLETS TO CRYSTALS", PAL.bloom);
        if (playing()) session.feedback("impact");
        break;
      case EV.shieldHit:
        rend.shipHit(e.x, e.y);
        sfx.shieldHit(e.a);
        shake.add(0.5);
        hitStop.freeze(reduced ? 0.03 : 0.08);
        flash.trigger(PAL.warn, 0.55);
        hud.shieldPop.kick(9);
        hud.banner(e.a === 1 ? "LAST SHIELD" : "SHIELD DOWN", e.b ? "GUN -1 · CATCH IT BACK" : `${e.a} LEFT`, e.a === 1 ? PAL.warn : PAL.paper, e.a === 1);
        session.feedback("impact");
        break;
      case EV.multUp:
        hud.multPop.kick(7);
        sfx.multUp(e.a);
        if (!attract && e.a >= 3) hud.popup(`×${e.a}`, css(sim.ship.x), css(sim.ship.y) - 44, multColor(e.a), 20, true, 0.8);
        if (e.a >= 4 && playing()) session.feedback("tap");
        break;
      case EV.multDown:
        sfx.multDown(e.a);
        hud.multPop.kick(-4);
        break;
      case EV.warning:
        hud.banner("WARNING", "THE LOOM IS COMING", PAL.warn, true, 2.4);
        sfx.siren();
        break;
      case EV.armDown:
        rend.explode("arm", e.x, e.y, 2.8, reduced);
        shake.add(0.32);
        hitStop.freeze(reduced ? 0.03 : 0.06);
        sfx.kill(3, sim.mult, time);
        hud.banner(e.a > 0 ? "ARM BROKEN" : "ALL ARMS DOWN", e.a > 0 ? `${e.a} LEFT` : "THE EYE OPENS", PAL.loomGold);
        if (playing()) session.feedback("impact");
        break;
      case EV.bossBoom:
        rend.bossBoom(e.x, e.y, e.a, reduced);
        sfx.bossBoom(e.a);
        shake.add(0.12);
        break;
      case EV.bossDead:
        rend.bossFinale(e.x, e.y, reduced);
        flash.trigger(PAL.paper, 0.6);
        shake.add(0.85);
        hitStop.freeze(reduced ? 0.05 : 0.22);
        sfx.win();
        hud.banner("LOOM DOWN", `+${fmt(e.a)} · ${e.b.toFixed(1)} S`, PAL.loomGold, true, 2.6);
        if (playing()) {
          session.feedback("success");
          tc.analytics.track("level_complete", { level: sim.loop + 1 });
        }
        break;
      case EV.loop:
        hud.banner("OVERDRIVE", "HOTTER EVERY SECOND", PAL.bullet, true, 2.2);
        sfx.siren();
        break;
      case EV.cancel:
        rend.cancel(e.x, e.y, e.a > 0);
        break;
      case EV.pickupLost:
        if (!attract) sfx.lost();
        break;
      case EV.death:
        rend.shipDeath(e.x, e.y);
        sfx.death();
        sfx.music(false);
        shake.add(0.8);
        hitStop.freeze(reduced ? 0.05 : 0.14);
        slowmo = 0.5;
        flash.trigger(PAL.accent, 0.6);
        overT = 0;
        break;
    }
  }

  function hintFor(st: RunStats, secs: number): string {
    if (st.peakLevel <= 2) return "FLY INTO THE GUN +1 BADGES: EACH ADDS A STREAM.";
    if (st.deathBy === "body") return "DON'T RAM THEM. SHIPS HURT ON CONTACT TOO.";
    if (st.bossLeft > 0.4) return "BREAK THE LOOM'S ARMS FIRST: EACH ONE CLOSES A THREAD.";
    if (secs < 28) return "KEEP SLIDING SIDEWAYS. AIMED SHOTS MISS A MOVING SHIP.";
    if (st.levelLosses >= 2) return "A HIT KNOCKS A GUN LEVEL LOOSE. CATCH IT BACK.";
    if (st.grazes < 12) return "SKIM CLOSER. A NEAR MISS PAYS AND KEEPS THE CHAIN WARM.";
    if (st.maxMult <= 4) return "KEEP KILLING: THE CHAIN COOLS 2 S AFTER YOUR LAST KILL.";
    if (st.bossesKilled > 0) return "OVERDRIVE NEVER COOLS. GRAZE FOR POINTS, STAY LOW.";
    return "WATCH THE PODS: THEIR PETALS OPEN JUST BEFORE A RING.";
  }

  // --- frame --------------------------------------------------------------------------------------------------
  function update(rawDt: number): void {
    session.tick(rawDt);
    time += rawDt;
    hud.update(rawDt);
    flash.update(rawDt);
    shake.update(rawDt);
    let dt = hitStop.scale(rawDt);
    if (slowmo > 0) {
      slowmo -= rawDt;
      dt *= 0.35;
    }
    if (pilot && (mode === "attract" || session.phase === "playing")) pilot.update(sim, dt);
    sim.step(dt);
    sim.drain(onEvent);

    // The ship banks into sideways motion.
    const vx = rawDt > 0 ? (sim.ship.x - lastShipX) / rawDt : 0;
    lastShipX = sim.ship.x;
    bank = damp(bank, clamp(vx / 520, -1, 1), 14, rawDt);
    const inBoss = sim.phase === "warning" || sim.phase === "boss" || sim.boss.phase !== "off";
    bossTint = damp(bossTint, inBoss ? 1 : 0, 2, rawDt);
    scroll += rawDt * (reduced ? 0.5 : 1) * (sim.loop > 0 ? 1.6 : 1);

    if (mode === "play") {
      hud.setScore(sim.score);
      if (!bestBanner && session.best !== null && session.best > 0 && sim.score > session.best && session.phase === "playing") {
        bestBanner = true;
        hud.banner("NEW BEST", "KEEP GOING", PAL.crystal, true, 1.8);
        rend.pickupBurst(sim.ship.x, sim.ship.y - 40, C.crystal);
        sfx.formation();
        hud.scorePop.kick(6);
      }
      // Game over -> report within the second.
      if (overT >= 0) {
        overT += rawDt;
        if (!endSent && overT > 0.7) {
          endSent = true;
          const prev = session.best;
          const st = sim.stats;
          const r = session.end(sim.score, {
            outcome: "lose",
            stats: { grazes: st.grazes, maxMult: st.maxMult, kills: st.kills, bosses: st.bossesKilled, seconds: Math.round(sim.t) },
          });
          const info: EndInfo = { score: sim.score, prevBest: prev, isBest: r.isBest, stats: { ...st }, hint: hintFor(st, sim.t), seconds: sim.t };
          hud.end = info;
          hud.scorePop.kick(4);
          if (r.isBest && sim.score > 0) {
            rend.pickupBurst(180, rend.fieldH * 0.35, C.crystal);
            sfx.win();
          }
        }
      }
    } else {
      // The demo's thumb trails under the ship.
      const sx = css(sim.ship.x);
      const sy = css(sim.ship.y);
      thumbX = damp(thumbX, sx + 6, 10, rawDt);
      thumbY = damp(thumbY, Math.min(H - session.preview().bottom + 30, sy + 66), 10, rawDt);
    }
  }

  const view: View = { time: 0, dt: 0, shakeX: 0, shakeY: 0, shakeA: 0, bank: 0, attract: true, reduced, bossTint: 0, planetSink: 0, scroll: 0 };

  function render(rawDt: number): void {
    const o = shake.offset;
    view.time = time;
    view.dt = hitStop.active ? 0 : rawDt * (slowmo > 0 ? 0.35 : 1);
    view.shakeX = o.x;
    view.shakeY = o.y;
    view.shakeA = o.angle;
    view.bank = bank;
    view.attract = mode === "attract";
    view.bossTint = bossTint;
    view.planetSink = mode === "play" ? Math.min(420, sim.t * 4.2) : Math.sin(time * 0.2) * 4;
    view.scroll = scroll;
    rend.draw(sim, view);
    Ticker.system.update(performance.now());
    app.renderer.render(app.stage);
    hud.begin(dpr);
    if (mode === "attract") hud.drawAttract(time, css(sim.ship.x), css(sim.ship.y), thumbX, thumbY, true);
    else {
      hud.drawPlay(sim, time, k(), o.x, o.y, pickupLabel);
      if (session.phase === "over") hud.drawSummary(time, "TAP TO WEAVE AGAIN");
    }
    flash.draw(hud.ctx, W, H);
  }

  window.addEventListener("resize", () => {
    W = window.innerWidth;
    H = window.innerHeight;
    layout();
    if (mode === "attract") newAttract();
  });
  session.on("insets", () => {
    hud.titlePop.kick(3);
    if (mode === "attract") sim.setShipZone(rend.fieldH * 0.5, attractMaxY());
  });

  /** Draws every texture once before ready(), so uploads and shader compiles never land in attract mode. */
  function warmUp(): void {
    rend.prewarm();
    const tmp = new Container();
    const all = [
      tex.glow, tex.glowSoft, tex.bulletS, tex.bulletL, tex.shot, tex.shotHeavy, tex.dartShot, tex.crystal, tex.spark, tex.shard, tex.ring, tex.puff, tex.dot,
      tex.line, tex.hitbox, tex.bubble, tex.flame, tex.drone, tex.dart, tex.dartFlash, tex.weaverHead, tex.weaverBead, tex.weaverFlash, tex.bloomCore,
      tex.bloomPetal, tex.bloomFlash, tex.bastion, tex.bastionEye, tex.bastionFlash, tex.skiff, tex.skiffFlash, tex.loomArm, tex.loomArmFlash,
      tex.loomCoreShut, tex.loomCoreOpen, tex.loomCoreFlash, tex.loomWheel, tex.pickupRing, ...tex.ships, ...Object.values(tex.pickups),
    ];
    for (const t of all) {
      const s = new Sprite(t);
      s.alpha = 0.01;
      s.blendMode = "add";
      tmp.addChild(s);
      const n = new Sprite(t);
      n.alpha = 0.01;
      tmp.addChild(n);
    }
    app.stage.addChild(tmp);
    app.renderer.render(app.stage);
    app.stage.removeChild(tmp);
    tmp.destroy({ children: true });
  }

  newAttract();
  warmUp();
  hud.titlePop.target = 1;
  let frames = 0;
  tc.loop((dt) => {
    const d = Math.min(dt, 1 / 20);
    update(d);
    render(d);
    if (++frames === 3) session.ready();
  });
}

void main();
