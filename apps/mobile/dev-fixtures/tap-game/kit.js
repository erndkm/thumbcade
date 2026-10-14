/*
 * Tiny helpers shared by the dev fixtures: canvas sizing, a pausable loop, procedural blips,
 * particles, screen shake, and inset handling. Copied into each fixture by build-assets.ts.
 */
(function () {
  "use strict";

  // --- canvas -------------------------------------------------------------------------------
  function makeCanvas() {
    var c = document.createElement("canvas");
    document.body.appendChild(c);
    var ctx = c.getContext("2d");
    var state = { w: 0, h: 0, dpr: 1 };
    function fit() {
      state.dpr = Math.min(window.devicePixelRatio || 1, 3);
      state.w = window.innerWidth;
      state.h = window.innerHeight;
      c.width = Math.round(state.w * state.dpr);
      c.height = Math.round(state.h * state.dpr);
      c.style.width = state.w + "px";
      c.style.height = state.h + "px";
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    }
    fit();
    window.addEventListener("resize", fit);
    return { canvas: c, ctx: ctx, size: state };
  }

  // --- loop -----------------------------------------------------------------------------------
  function makeLoop(step) {
    var raf = 0;
    var last = 0;
    var running = false;
    function frame(t) {
      if (!running) return;
      var dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
      last = t;
      step(dt);
      raf = requestAnimationFrame(frame);
    }
    return {
      start: function () {
        if (running) return;
        running = true;
        last = 0;
        raf = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        cancelAnimationFrame(raf);
      },
      get running() {
        return running;
      },
    };
  }

  // --- audio --------------------------------------------------------------------------------
  var audio = { ctx: null, muted: true, paused: false };
  function ensureAudio() {
    if (audio.ctx || audio.muted) return audio.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audio.ctx = new AC();
    } catch (_) {
      audio.ctx = null;
    }
    return audio.ctx;
  }
  function blip(freq, dur, type, gain, slide) {
    if (audio.muted || audio.paused) return;
    var ac = ensureAudio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    var o = ac.createOscillator();
    var g = ac.createGain();
    var t = ac.currentTime;
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(gain || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function setMuted(m) {
    audio.muted = m;
    if (m && audio.ctx && audio.ctx.state === "running") audio.ctx.suspend();
  }
  function setAudioPaused(p) {
    audio.paused = p;
    if (!audio.ctx) return;
    if (p && audio.ctx.state === "running") audio.ctx.suspend();
    if (!p && !audio.muted && audio.ctx.state === "suspended") audio.ctx.resume();
  }

  // --- particles & shake ----------------------------------------------------------------------
  function makeParticles() {
    var list = [];
    return {
      burst: function (x, y, color, n, speed) {
        for (var i = 0; i < n; i++) {
          var a = Math.random() * Math.PI * 2;
          var s = (0.4 + Math.random() * 0.6) * (speed || 260);
          list.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, size: 2 + Math.random() * 4, color: color });
        }
      },
      update: function (dt) {
        for (var i = list.length - 1; i >= 0; i--) {
          var p = list[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.92;
          p.vy = p.vy * 0.92 + 240 * dt;
          p.life -= dt * 1.6;
          if (p.life <= 0) list.splice(i, 1);
        }
      },
      draw: function (ctx) {
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
      },
      clear: function () {
        list.length = 0;
      },
    };
  }
  function makeShake() {
    var mag = 0;
    return {
      kick: function (m) {
        mag = Math.max(mag, m);
      },
      apply: function (ctx, dt) {
        if (mag <= 0.1) {
          mag = 0;
          return;
        }
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
        mag *= Math.pow(0.0008, dt);
      },
    };
  }

  // --- insets ---------------------------------------------------------------------------------
  function makeInsets() {
    var none = { top: 0, right: 0, bottom: 0, left: 0 };
    var set = { preview: none, play: none, current: "preview" };
    return {
      update: function (s) {
        if (s && s.preview && s.play) set = s;
      },
      use: function (which) {
        set = { preview: set.preview, play: set.play, current: which };
      },
      get current() {
        return set.current === "play" ? set.play : set.preview;
      },
      get preview() {
        return set.preview;
      },
    };
  }

  window.Kit = {
    makeCanvas: makeCanvas,
    makeLoop: makeLoop,
    blip: blip,
    setMuted: setMuted,
    setAudioPaused: setAudioPaused,
    makeParticles: makeParticles,
    makeShake: makeShake,
    makeInsets: makeInsets,
    clamp: function (v, a, b) {
      return v < a ? a : v > b ? b : v;
    },
    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },
    easeOutBack: function (t) {
      var c1 = 1.70158;
      var c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
  };
})();
