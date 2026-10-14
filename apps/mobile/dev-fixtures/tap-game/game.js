/*
 * Pulse Ring — dev fixture (tap game, controls.vertical = false).
 * Tap when the pulse meets the ring. Perfect hits build a combo; three misses end the run.
 */
(function () {
  "use strict";
  var K = window.Kit;
  var TC = window.TC;
  var ACCENT = "#3DFFB0";
  var INK = "#0D0D10";
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

  var run = { score: 0, lives: 3, combo: 0, speed: 150, pulse: 0, target: 110, flash: 0, overAt: 0 };
  var demo = { pulse: 0, target: 110, speed: 170, ghost: 0 };
  var popups = [];

  var pointer = { down: false, x: 0, y: 0, moved: false, cancelled: false };

  function area() {
    var i = insets.current;
    var w = S.w - i.left - i.right;
    var h = S.h - i.top - i.bottom;
    return { x: i.left + w / 2, y: i.top + h / 2, w: w, h: h, top: i.top, left: i.left };
  }
  function maxRadius() {
    var a = area();
    return Math.max(60, Math.min(a.w, a.h) / 2 - 36);
  }
  function newTarget(r) {
    var m = maxRadius();
    r.target = 54 + Math.random() * Math.max(20, m - 54);
    r.pulse = 0;
  }

  function popup(text, color, x, y) {
    popups.push({ text: text, color: color, x: x, y: y, life: 1 });
  }

  function startRun() {
    mode = "play";
    insets.use("play");
    run.score = 0;
    run.lives = 3;
    run.combo = 0;
    // Warm-up: the first rings grow slowly.
    run.speed = 110;
    run.flash = 0;
    popups.length = 0;
    parts.clear();
    newTarget(run);
    K.blip(520, 0.08, "square", 0.05, 1.6);
    TC.start("tap");
  }

  function endRun() {
    mode = "over";
    run.overAt = time;
    insets.use("preview");
    TC.feedback("impact");
    K.blip(220, 0.4, "sawtooth", 0.06, 0.3);
    if (!reduced) shake.kick(14);
    TC.end(run.score, "lose");
    if (run.score > best) {
      best = run.score;
      TC.storageSet("best", best).catch(function () {});
    }
  }

  function judge() {
    var err = Math.abs(run.pulse - run.target);
    var a = area();
    if (err < 7) {
      run.combo += 1;
      var pts = 2 + run.combo;
      run.score += pts;
      run.flash = 1;
      popup(run.combo > 1 ? "PERFECT x" + run.combo : "PERFECT", ACCENT, a.x, a.y - run.target - 22);
      parts.burst(a.x + run.target, a.y, ACCENT, 18, 320);
      parts.burst(a.x - run.target, a.y, ACCENT, 18, 320);
      TC.feedback("success");
      K.blip(660 + run.combo * 40, 0.09, "square", 0.05, 1.5);
    } else if (err < 18) {
      run.combo = 0;
      run.score += 1;
      popup("GOOD +1", PAPER, a.x, a.y - run.target - 22);
      parts.burst(a.x, a.y - run.target, PAPER, 10, 200);
      TC.feedback("tap");
      K.blip(440, 0.07, "triangle", 0.05, 1.2);
    } else {
      miss();
      return;
    }
    run.speed = Math.min(430, run.speed + 7);
    newTarget(run);
  }

  function miss() {
    var a = area();
    run.lives -= 1;
    run.combo = 0;
    popup("MISS", HEAT, a.x, a.y - run.target - 22);
    TC.feedback("fail");
    K.blip(160, 0.18, "sawtooth", 0.06, 0.6);
    if (!reduced) shake.kick(9);
    if (run.lives <= 0) endRun();
    else newTarget(run);
  }

  // ---------------------------------------------------------------- update / draw
  function update(dt) {
    time += dt;
    parts.update(dt);
    for (var i = popups.length - 1; i >= 0; i--) {
      popups[i].life -= dt * 1.4;
      popups[i].y -= 40 * dt;
      if (popups[i].life <= 0) popups.splice(i, 1);
    }
    if (mode === "play") {
      run.pulse += run.speed * dt;
      run.flash = Math.max(0, run.flash - dt * 3);
      if (run.pulse > run.target + 26) miss();
    } else {
      demo.pulse += demo.speed * dt;
      demo.ghost = Math.max(0, demo.ghost - dt * 2.5);
      if (demo.pulse >= demo.target) {
        var a = area();
        demo.ghost = 1;
        parts.burst(a.x + demo.target, a.y, ACCENT, 10, 240);
        newTarget(demo);
        demo.speed = 150 + Math.random() * 80;
      }
    }
  }

  function drawRing(cx, cy, r, color, width, alpha) {
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    // engraved ticks
    for (var k = 0; k < 24; k++) {
      var ang = (k / 24) * Math.PI * 2 + time * 0.2;
      var r1 = r + 6;
      var r2 = r + (k % 6 === 0 ? 14 : 10);
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      g.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      g.lineWidth = 2;
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  function draw(dt) {
    g.save();
    g.fillStyle = INK;
    g.fillRect(0, 0, S.w, S.h);
    shake.apply(g, dt);

    // dotted backdrop
    g.fillStyle = "#24242B";
    for (var y = 12; y < S.h; y += 28) for (var x = 12; x < S.w; x += 28) g.fillRect(x, y, 2, 2);

    var a = area();
    var r = mode === "play" ? run : demo;

    // pulse
    g.globalAlpha = 0.12;
    g.fillStyle = ACCENT;
    g.beginPath();
    g.arc(a.x, a.y, Math.max(0, r.pulse), 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = PAPER;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(a.x, a.y, Math.max(0, r.pulse), 0, Math.PI * 2);
    g.stroke();

    // target ring
    var flash = mode === "play" ? run.flash : demo.ghost;
    drawRing(a.x, a.y, r.target, ACCENT, 4 + flash * 6, 0.9);
    g.fillStyle = ACCENT;
    g.fillRect(a.x - 3, a.y - 3, 6, 6);

    parts.draw(g);

    for (var i = 0; i < popups.length; i++) {
      var p = popups[i];
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.font = "700 16px " + MONO;
      g.textAlign = "center";
      g.fillText(p.text, p.x, p.y);
    }
    g.globalAlpha = 1;
    g.restore();

    // HUD
    g.textAlign = "center";
    if (mode === "play" || mode === "over") {
      var top = insets.current.top + 18;
      g.fillStyle = PAPER;
      g.font = "400 44px " + MONO;
      g.fillText(String(run.score), S.w / 2, top + 40);
      for (var l = 0; l < 3; l++) {
        g.fillStyle = l < run.lives ? HEAT : "#34343D";
        g.fillRect(S.w / 2 - 26 + l * 20, top + 56, 12, 12);
      }
      if (run.combo > 1) {
        g.fillStyle = ACCENT;
        g.font = "400 13px " + MONO;
        g.fillText("COMBO " + run.combo, S.w / 2, top + 88);
      }
    }
    if (mode === "attract") {
      var ty = a.top + 56;
      g.fillStyle = PAPER;
      g.font = "900 34px " + SANS;
      g.fillText("PULSE RING", a.x, ty);
      g.font = "400 12px " + MONO;
      g.fillStyle = DIM;
      g.fillText("TAP WHEN THE PULSE MEETS THE RING", a.x, ty + 24);
      var blink = 0.55 + 0.45 * Math.sin(time * 4);
      g.globalAlpha = blink;
      g.fillStyle = ACCENT;
      g.font = "700 15px " + MONO;
      g.fillText("TAP TO PLAY", a.x, a.y + a.h / 2 - 24);
      g.globalAlpha = 1;
      if (best > 0) {
        g.fillStyle = MUTE;
        g.font = "400 12px " + MONO;
        g.fillText("BEST " + best, a.x, a.y + a.h / 2 - 6);
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
  function onDown(e) {
    pointer.down = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.moved = false;
    pointer.cancelled = false;
    if (mode === "play" && loop.running) judge();
  }
  function onMove(e) {
    if (!pointer.down) return;
    if (Math.abs(e.clientX - pointer.x) > 10 || Math.abs(e.clientY - pointer.y) > 10) pointer.moved = true;
  }
  function onUp() {
    if (!pointer.down) return;
    pointer.down = false;
    if (pointer.moved || pointer.cancelled || !loop.running) return;
    if (mode === "attract" || (mode === "over" && time - run.overAt > 0.6)) startRun();
  }
  window.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
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

  // ---------------------------------------------------------------- boot
  TC.hello("fixture-tap")
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
      newTarget(demo);
      loop.start();
    });
})();
