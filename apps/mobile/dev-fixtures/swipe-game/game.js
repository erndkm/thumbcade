/*
 * Lane Flip — dev fixture (vertical-swipe game, controls.vertical = true).
 * Three stacked lanes scroll toward you. Swipe up or down to flip lanes, grab sparks, dodge walls.
 * A run starts with a tap; play is all vertical swipes, so the feed must stay out of the way.
 */
(function () {
  "use strict";
  var K = window.Kit;
  var TC = window.TC;
  var ACCENT = "#FFB547";
  var INK = "#0D0D10";
  var LINE = "#24242B";
  var PAPER = "#F3F0E8";
  var DIM = "#A7A3AE";
  var MUTE = "#6E6A78";
  var HEAT = "#FF4A3D";
  var MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
  var SANS = "-apple-system, system-ui, 'Segoe UI', sans-serif";

  var cv = K.makeCanvas();
  var g = cv.ctx;
  var S = cv.size;
  var insets = K.makeInsets();
  var parts = K.makeParticles();
  var shake = K.makeShake();

  var mode = "boot"; // boot | attract | play | over
  var best = 0;
  var reduced = false;
  var time = 0;
  var readySent = false;

  function freshWorld() {
    return { lane: 1, y: 1, speed: 260, dist: 0, sparks: 0, spawnIn: 0.8, items: [], overAt: 0, alive: true };
  }
  var w = freshWorld();
  var demo = freshWorld();

  var pointer = { down: false, x: 0, y: 0, used: false, moved: false, cancelled: false };

  function geometry() {
    var i = insets.current;
    var h = S.h - i.top - i.bottom;
    var gap = Math.min(110, h / 4.2);
    var mid = i.top + h / 2 + (mode === "attract" ? 30 : 0);
    return { gap: gap, mid: mid, left: i.left, right: S.w - i.right, playerX: i.left + 64 };
  }
  function laneY(geo, lane) {
    return geo.mid + (lane - 1) * geo.gap;
  }
  function score(world) {
    return Math.floor(world.dist / 10) + world.sparks * 25;
  }

  function spawn(world) {
    var geo = geometry();
    // The first ~5 seconds of a run are a warm-up: sparks only, no walls.
    var warmup = world.dist < 1300;
    var blocked = warmup ? 0 : Math.random() < 0.35 ? 2 : 1;
    var lanes = [0, 1, 2].sort(function () {
      return Math.random() - 0.5;
    });
    for (var b = 0; b < blocked; b++) world.items.push({ kind: "wall", lane: lanes[b], x: geo.right + 40, hit: false });
    if (warmup || Math.random() < 0.7) world.items.push({ kind: "spark", lane: lanes[2], x: geo.right + 40 + Math.random() * 80, hit: false });
    world.spawnIn = Math.max(0.42, 1.05 - world.speed / 1400) + Math.random() * 0.25;
  }

  function flip(world, dir) {
    var next = K.clamp(world.lane + dir, 0, 2);
    if (next === world.lane) return false;
    world.lane = next;
    return true;
  }

  function startRun() {
    mode = "play";
    insets.use("play");
    w = freshWorld();
    parts.clear();
    K.blip(480, 0.08, "square", 0.05, 1.8);
    TC.start("tap");
  }

  function endRun() {
    mode = "over";
    w.alive = false;
    w.overAt = time;
    insets.use("preview");
    var s = score(w);
    TC.feedback("impact");
    K.blip(180, 0.45, "sawtooth", 0.07, 0.3);
    if (!reduced) shake.kick(16);
    TC.end(s, "lose");
    if (s > best) {
      best = s;
      TC.storageSet("best", best).catch(function () {});
    }
  }

  function step(world, dt, isDemo) {
    var geo = geometry();
    world.speed = Math.min(660, world.speed + dt * 9);
    world.dist += world.speed * dt;
    world.spawnIn -= dt;
    if (world.spawnIn <= 0) spawn(world);
    world.y = K.lerp(world.y, world.lane, 1 - Math.pow(0.00002, dt));

    if (isDemo) {
      // Attract AI: look ahead and flip away from walls.
      for (var a = 0; a < world.items.length; a++) {
        var it = world.items[a];
        var ahead = it.x - geo.playerX;
        if (it.kind === "wall" && it.lane === world.lane && ahead > 0 && ahead < 190) {
          var options = [world.lane - 1, world.lane + 1].filter(function (l) {
            if (l < 0 || l > 2) return false;
            return !world.items.some(function (o) {
              return o.kind === "wall" && o.lane === l && Math.abs(o.x - it.x) < 70;
            });
          });
          if (options.length) world.lane = options[Math.floor(Math.random() * options.length)];
          break;
        }
      }
    }

    var py = laneY(geo, world.y);
    for (var i = world.items.length - 1; i >= 0; i--) {
      var o = world.items[i];
      o.x -= world.speed * dt;
      if (o.x < geo.left - 60) {
        world.items.splice(i, 1);
        continue;
      }
      var oy = laneY(geo, o.lane);
      if (!o.hit && Math.abs(o.x - geo.playerX) < 24 && Math.abs(oy - py) < geo.gap * 0.42) {
        o.hit = true;
        if (o.kind === "spark") {
          world.sparks += 1;
          parts.burst(o.x, oy, ACCENT, 14, 260);
          if (!isDemo) {
            TC.feedback("success");
            K.blip(880, 0.07, "square", 0.04, 1.3);
          }
        } else if (!isDemo) {
          parts.burst(geo.playerX, py, HEAT, 30, 380);
          endRun();
          return;
        } else {
          world.items.splice(i, 1);
        }
      }
    }
  }

  function update(dt) {
    time += dt;
    parts.update(dt);
    if (mode === "play") step(w, dt, false);
    else if (mode === "attract") step(demo, dt, true);
  }

  function draw(dt) {
    var world = mode === "attract" ? demo : w;
    var geo = geometry();
    g.save();
    g.fillStyle = INK;
    g.fillRect(0, 0, S.w, S.h);
    shake.apply(g, dt);

    // lanes with scrolling dashes
    for (var l = 0; l < 3; l++) {
      var ly = laneY(geo, l);
      g.fillStyle = LINE;
      g.fillRect(0, ly + geo.gap / 2 - 1, S.w, 2);
      var off = (world.dist * 0.6) % 48;
      g.fillStyle = "#17171C";
      for (var x = -off; x < S.w; x += 48) g.fillRect(x, ly - 1, 22, 2);
    }

    // items
    for (var i = 0; i < world.items.length; i++) {
      var o = world.items[i];
      var oy = laneY(geo, o.lane);
      if (o.kind === "wall") {
        g.fillStyle = PAPER;
        g.fillRect(o.x - 12, oy - geo.gap * 0.36, 24, geo.gap * 0.72);
        g.fillStyle = INK;
        for (var s = -2; s <= 2; s++) g.fillRect(o.x - 12, oy + s * 9 - 1, 24, 2);
      } else if (!o.hit) {
        g.save();
        g.translate(o.x, oy);
        g.rotate(time * 3);
        g.fillStyle = ACCENT;
        g.fillRect(-7, -7, 14, 14);
        g.restore();
      }
    }

    // player
    var py = laneY(geo, world.y);
    if (mode !== "over") {
      g.fillStyle = ACCENT;
      g.fillRect(geo.playerX - 16, py - 16, 32, 32);
      g.fillStyle = INK;
      g.fillRect(geo.playerX + 4, py - 8, 6, 6);
      g.globalAlpha = 0.25;
      g.fillStyle = ACCENT;
      for (var t = 1; t <= 4; t++) g.fillRect(geo.playerX - 16 - t * 14, py - 10 + t * 2, 10 - t, 20 - t * 4);
      g.globalAlpha = 1;
    }
    parts.draw(g);
    g.restore();

    g.textAlign = "center";
    if (mode === "play" || mode === "over") {
      var top = insets.current.top + 18;
      g.fillStyle = PAPER;
      g.font = "400 44px " + MONO;
      g.fillText(String(score(w)), S.w / 2, top + 40);
      g.fillStyle = MUTE;
      g.font = "400 12px " + MONO;
      g.fillText(w.sparks + " SPARKS", S.w / 2, top + 62);
    } else if (mode === "attract") {
      var i0 = insets.current;
      var cx = i0.left + (S.w - i0.left - i0.right) / 2;
      var ty = i0.top + 60;
      g.fillStyle = PAPER;
      g.font = "900 34px " + SANS;
      g.fillText("LANE FLIP", cx, ty);
      g.font = "400 12px " + MONO;
      g.fillStyle = DIM;
      g.fillText("SWIPE UP / DOWN TO FLIP LANES", cx, ty + 24);
      g.globalAlpha = 0.55 + 0.45 * Math.sin(time * 4);
      g.fillStyle = ACCENT;
      g.font = "700 15px " + MONO;
      g.fillText("TAP TO PLAY", cx, geo.mid + geo.gap * 1.9);
      g.globalAlpha = 1;
      if (best > 0) {
        g.fillStyle = MUTE;
        g.font = "400 12px " + MONO;
        g.fillText("BEST " + best, cx, geo.mid + geo.gap * 1.9 + 20);
      }
    }
  }

  var loop = K.makeLoop(function (dt) {
    update(dt);
    draw(dt);
    if (!readySent && mode === "attract") {
      readySent = true;
      TC.ready();
    }
  });

  // ---------------------------------------------------------------- input
  window.addEventListener("pointerdown", function (e) {
    pointer.down = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.used = false;
    pointer.moved = false;
    pointer.cancelled = false;
  });
  window.addEventListener("pointermove", function (e) {
    if (!pointer.down || pointer.cancelled) return;
    var dx = e.clientX - pointer.x;
    var dy = e.clientY - pointer.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) pointer.moved = true;
    if (mode !== "play" || pointer.used || !loop.running) return;
    if (Math.abs(dy) > 22 && Math.abs(dy) > Math.abs(dx)) {
      pointer.used = true;
      if (flip(w, dy < 0 ? -1 : 1)) {
        TC.feedback("tap");
        K.blip(dy < 0 ? 620 : 420, 0.05, "triangle", 0.04, 1.2);
      }
    }
  });
  window.addEventListener("pointerup", function () {
    if (!pointer.down) return;
    pointer.down = false;
    if (pointer.moved || pointer.cancelled || !loop.running) return;
    if (mode === "attract" || (mode === "over" && time - w.overAt > 0.6)) startRun();
  });
  window.addEventListener("pointercancel", function () {
    pointer.down = false;
    pointer.cancelled = true;
  });

  // ---------------------------------------------------------------- shell messages
  TC.on("pause", function () {
    loop.stop();
    K.setAudioPaused(true);
  });
  TC.on("resume", function () {
    K.setAudioPaused(false);
    loop.start();
  });
  TC.on("mute", function () {
    K.setMuted(true);
  });
  TC.on("unmute", function () {
    K.setMuted(false);
  });
  TC.on("input.cancel", function () {
    pointer.down = false;
    pointer.cancelled = true;
  });
  TC.on("insets", function (set) {
    insets.update(set);
  });
  TC.on("replay", function () {
    startRun();
  });

  TC.hello("fixture-swipe")
    .then(function (ctx) {
      insets.update(ctx.insets);
      reduced = !!ctx.reducedMotion;
      K.setMuted(!!(ctx.audio && ctx.audio.muted));
      if (typeof ctx.best === "number") best = ctx.best;
      return TC.storageGet("best")
        .then(function (v) {
          if (typeof v === "number" && v > best) best = v;
        })
        .catch(function () {});
    })
    .catch(function () {})
    .then(function () {
      mode = "attract";
      loop.start();
    });
})();
