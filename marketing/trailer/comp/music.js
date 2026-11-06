/* Thumbcade teaser soundtrack: 120 BPM, A minor, synthesized offline. Cues match trailer.js. */
window.renderMusic = async function renderMusic(cut) {
  const SR = 48000;
  const CUT = String(cut) === "15";
  const DUR = CUT ? 15.0 : 26.5;
  // Edit plan: [from, to, shift]. An event is kept when it starts inside a span and moves by its shift.
  // The 15 s cut drops 3.98-5.98 (a bar, so the groove stays on the grid), stops before DROP, and
  // picks the sign-off up from the riser into the final press.
  const PLAN = CUT
    ? [
        [0, 3.98, 0],
        [5.98, 12.88, -2.0],
        [21.8, 26.5, -11.0],
      ]
    : [[0, DUR, 0]];
  const shiftAt = (t) => {
    for (const [a, b, s] of PLAN) if (t >= a - 1e-9 && t < b) return s;
    return null;
  };
  const M = (t) => (shiftAt(t) == null ? null : t + shiftAt(t));
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * DUR), SR);
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

  // ---------------------------------------------------------------- bus
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.ratio.value = 3.5;
  glue.attack.value = 0.006;
  glue.release.value = 0.14;
  glue.knee.value = 8;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2.5;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  limiter.knee.value = 0;
  master.connect(glue).connect(limiter).connect(ctx.destination);

  // Reverb send
  const verb = ctx.createConvolver();
  {
    const len = Math.floor(SR * 2.4);
    const ir = ctx.createBuffer(2, len, SR);
    let s = 1234567;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = rnd() * Math.exp((-i / len) * 6.5) * (i < SR * 0.01 ? i / (SR * 0.01) : 1);
    }
    verb.buffer = ir;
  }
  const verbIn = ctx.createGain();
  verbIn.gain.value = 0.32;
  const verbLow = ctx.createBiquadFilter();
  verbLow.type = "highpass";
  verbLow.frequency.value = 280;
  verbIn.connect(verbLow).connect(verb).connect(master);

  // Ping-pong-ish delay for the lead
  const delayIn = ctx.createGain();
  delayIn.gain.value = 0.28;
  const dl = ctx.createDelay(1);
  dl.delayTime.value = 0.375;
  const dr = ctx.createDelay(1);
  dr.delayTime.value = 0.25;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const dlf = ctx.createBiquadFilter();
  dlf.type = "lowpass";
  dlf.frequency.value = 3200;
  const pl = ctx.createStereoPanner();
  pl.pan.value = -0.6;
  const pr = ctx.createStereoPanner();
  pr.pan.value = 0.6;
  delayIn.connect(dlf);
  dlf.connect(dl).connect(pl).connect(master);
  dlf.connect(dr).connect(pr).connect(master);
  dl.connect(fb).connect(dlf);

  // Music bus with an automatable low-pass (for the tap break and the creator breakdown).
  const musicLP = ctx.createBiquadFilter();
  musicLP.type = "lowpass";
  musicLP.frequency.value = 20000;
  musicLP.Q.value = 0.9;
  const music = ctx.createGain();
  music.connect(musicLP).connect(master);
  const lp = musicLP.frequency;
  lp.setValueAtTime(20000, 0);
  if (CUT) {
    lp.setValueAtTime(20000, 5.7);
    lp.exponentialRampToValueAtTime(420, 6.45);
    lp.setValueAtTime(420, 6.5);
    lp.exponentialRampToValueAtTime(20000, 7.95);
  } else {
    lp.setValueAtTime(20000, 7.7);
    lp.exponentialRampToValueAtTime(420, 8.45);
    lp.setValueAtTime(420, 8.5);
    lp.exponentialRampToValueAtTime(20000, 9.95);
    lp.setValueAtTime(20000, 19.9);
    lp.exponentialRampToValueAtTime(900, 20.15);
    lp.setValueAtTime(900, 20.2);
    lp.exponentialRampToValueAtTime(6000, 21.8);
    lp.setValueAtTime(20000, 22.45);
  }

  const noise = (() => {
    const b = ctx.createBuffer(1, SR * 2, SR);
    const d = b.getChannelData(0);
    let s = 99;
    for (let i = 0; i < d.length; i++) d[i] = ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    return b;
  })();
  const pulse = (duty) => {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ctx.createPeriodicWave(re, im);
  };
  const PULSE25 = pulse(0.25);
  const PULSE50 = pulse(0.5);

  function out(node, { to = music, gain = 1, pan = 0, send = 0, delay = 0 } = {}) {
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    let last = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      last = p;
    }
    last.connect(to);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      last.connect(s).connect(verbIn);
    }
    if (delay) {
      const s = ctx.createGain();
      s.gain.value = delay;
      last.connect(s).connect(delayIn);
    }
    return g;
  }
  function envGain(t, a, d, peak = 1, sustain = 0, hold = 0, r = 0.05) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) {
      g.gain.setTargetAtTime(sustain * peak, t + a, d / 3);
      g.gain.setValueAtTime(sustain * peak + 1e-4, t + a + hold);
      g.gain.linearRampToValueAtTime(0, t + a + hold + r);
    } else g.gain.setTargetAtTime(0, t + a, d / 4);
    return g;
  }
  function noiseSrc(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(t, (t * 7.3) % 1.5);
    s.stop(t + dur);
    return s;
  }

  // ---------------------------------------------------------------- drums
  function kick(t, v = 1, o = {}) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(o.f0 || 165, t);
    osc.frequency.exponentialRampToValueAtTime(o.f1 || 46, t + (o.sweep || 0.11));
    const g = envGain(t, 0.002, o.decay || 0.42, v);
    osc.connect(g);
    out(g, { to: o.to || music, gain: 0.95 });
    osc.start(t);
    osc.stop(t + 0.8);
    const c = noiseSrc(t, 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    const cg = envGain(t, 0.001, 0.02, 0.35 * v);
    c.connect(hp).connect(cg);
    out(cg, { to: o.to || music });
  }
  function sub(t, v = 1, len = 1.1, f0 = 90, f1 = 33) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + len * 0.7);
    const g = envGain(t, 0.004, len, v);
    osc.connect(g);
    out(g, { to: master, gain: 0.9 });
    osc.start(t);
    osc.stop(t + len + 0.3);
  }
  function clap(t, v = 1) {
    for (let i = 0; i < 3; i++) {
      const s = noiseSrc(t + i * 0.011, 0.25);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1350;
      bp.Q.value = 1.1;
      const g = envGain(t + i * 0.011, 0.001, i === 2 ? 0.2 : 0.02, v * 0.55);
      s.connect(bp).connect(g);
      out(g, { send: 0.35 });
    }
  }
  function snare(t, v = 1) {
    const s = noiseSrc(t, 0.3);
    const bp = ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 1500;
    const g = envGain(t, 0.001, 0.16, v * 0.45);
    s.connect(bp).connect(g);
    out(g, { send: 0.2 });
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    const og = envGain(t, 0.001, 0.08, v * 0.35);
    o.connect(og);
    out(og);
    o.start(t);
    o.stop(t + 0.2);
  }
  function hat(t, v = 1, open = false, pan = 0.25) {
    const s = noiseSrc(t, open ? 0.4 : 0.08);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = open ? 7000 : 8500;
    const g = envGain(t, 0.001, open ? 0.24 : 0.035, v * (open ? 0.2 : 0.16));
    s.connect(hp).connect(g);
    out(g, { pan });
  }
  function crash(t, v = 1, len = 1.6) {
    const s = noiseSrc(t, len + 0.2);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4200;
    const g = envGain(t, 0.002, len, v * 0.22);
    s.connect(hp).connect(g);
    out(g, { send: 0.4, to: master });
  }

  // ---------------------------------------------------------------- tonal
  function bass(t, m, dur, v = 1, bright = 1) {
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = mtof(m);
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.value = mtof(m - 12);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 6;
    f.frequency.setValueAtTime(180, t);
    f.frequency.linearRampToValueAtTime(380 + 1400 * bright, t + 0.012);
    f.frequency.setTargetAtTime(240, t + 0.02, 0.07);
    const g = envGain(t, 0.004, 0.2, v * 0.32, 0.65, dur - 0.02, 0.03);
    const m2 = ctx.createGain();
    m2.gain.value = 0.55;
    o1.connect(f);
    o2.connect(m2).connect(f);
    f.connect(g);
    out(g);
    for (const o of [o1, o2]) {
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }
  function lead(t, m, dur, v = 1, o = {}) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(o.wave || PULSE25);
    osc.frequency.value = mtof(m);
    if (o.slideFrom) {
      osc.frequency.setValueAtTime(mtof(o.slideFrom), t);
      osc.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.05);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(dur > 0.3 ? mtof(m) * 0.012 : 0, t + Math.min(dur, 0.35));
    lfo.connect(lg).connect(osc.frequency);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.cut || 5200;
    const g = envGain(t, 0.004, 0.25, v * 0.13, o.sustain ?? 0.55, Math.max(0.01, dur - 0.01), 0.04);
    osc.connect(f).connect(g);
    out(g, { pan: o.pan || 0, send: o.send ?? 0.18, delay: o.delay ?? 0.5, to: o.to || music });
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.2);
    lfo.stop(t + dur + 0.2);
  }
  function blip(t, m, v = 1, len = 0.06, wave = PULSE50, to = master) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = mtof(m);
    const g = envGain(t, 0.001, len, v * 0.11);
    osc.connect(g);
    out(g, { to, send: 0.15 });
    osc.start(t);
    osc.stop(t + len + 0.1);
  }
  function stab(t, notes, dur, v = 1) {
    for (const [i, m] of notes.entries()) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.setValueAtTime(5200, t);
        f.frequency.setTargetAtTime(900, t + 0.01, 0.08);
        const g = envGain(t, 0.003, dur, (v * 0.055) / (1 + i * 0.15));
        o.connect(f).connect(g);
        out(g, { send: 0.3, pan: det > 0 ? 0.35 : -0.35 });
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    }
  }
  function pad(t0, t1, notes, v = 1, cut = 1600, to = music) {
    for (const m of notes) {
      for (const det of [-11, 0, 11]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = cut;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(v * 0.028, t0 + Math.min(0.5, (t1 - t0) * 0.4));
        g.gain.setValueAtTime(v * 0.028, t1 - 0.05);
        g.gain.linearRampToValueAtTime(0, t1 + 0.35);
        o.connect(f).connect(g);
        out(g, { send: 0.45, pan: det / 22, to });
        o.start(t0);
        o.stop(t1 + 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- fx
  function whoosh(t, dur, v = 1, up = false, pan0 = 0, pan1 = 0) {
    const s = noiseSrc(t, dur + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(up ? 400 : 3800, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 5200 : 280, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.42, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(pan0, t);
    p.pan.linearRampToValueAtTime(pan1, t + dur);
    s.connect(bp).connect(g).connect(p);
    out(p, { to: master, send: 0.2 });
  }
  function riser(t0, t1, v = 1) {
    const s = noiseSrc(t0, t1 - t0 + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.Q.value = 0.8;
    hp.frequency.setValueAtTime(300, t0);
    hp.frequency.exponentialRampToValueAtTime(7000, t1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v * 0.3, t1);
    g.gain.linearRampToValueAtTime(0, t1 + 0.02);
    s.connect(hp).connect(g);
    out(g, { to: master, send: 0.3 });
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(880, t1);
    const of = ctx.createBiquadFilter();
    of.type = "lowpass";
    of.frequency.value = 2400;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t0);
    og.gain.linearRampToValueAtTime(v * 0.05, t1);
    og.gain.linearRampToValueAtTime(0, t1 + 0.02);
    o.connect(of).connect(og);
    out(og, { to: master, send: 0.3 });
    o.start(t0);
    o.stop(t1 + 0.05);
  }
  function click(t, v = 1) {
    const s = noiseSrc(t, 0.02);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 2;
    const g = envGain(t, 0.0005, 0.012, v * 0.9);
    s.connect(bp).connect(g);
    out(g, { to: master, send: 0.1 });
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.02);
    const og = envGain(t, 0.0005, 0.03, v * 0.25);
    o.connect(og);
    out(og, { to: master });
    o.start(t);
    o.stop(t + 0.06);
  }
  function impact(t, v = 1, opts = {}) {
    kick(t, v * 1.05, { to: master, decay: 0.6 });
    sub(t, v * (opts.sub ?? 0.8), opts.len || 0.9);
    const s = noiseSrc(t, 0.6);
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.setValueAtTime(5000, t);
    lpf.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    const g = envGain(t, 0.001, 0.4, v * 0.3);
    s.connect(lpf).connect(g);
    out(g, { to: master, send: 0.5 });
  }
  function typeClick(t, v = 1) {
    const s = noiseSrc(t, 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400 + ((t * 9973) % 1) * 1800;
    bp.Q.value = 3;
    const g = envGain(t, 0.0005, 0.018, v * 0.5);
    s.connect(bp).connect(g);
    out(g, { to: master, pan: ((t * 31) % 1) * 0.4 - 0.2 });
  }

  // ---------------------------------------------------------------- chords
  const CH = {
    Am: { b: 45, n: [57, 60, 64, 69] },
    F: { b: 41, n: [53, 57, 60, 65] },
    C: { b: 48, n: [55, 60, 64, 67] },
    G: { b: 43, n: [55, 59, 62, 67] },
    E: { b: 40, n: [56, 59, 62, 64] },
    Fmaj9: { b: 41, n: [53, 57, 60, 64, 67] },
  };
  const chordAt = (t) => {
    const map = [
      [3, "Am"], [5, "F"], [7, "G"], [8.5, "E"], [10, "Am"], [11, "F"], [12, "C"], [13, "G"],
      [14, "F"], [15, "G"], [16, "Am"], [17, "F"], [17.5, "C"], [18, "F"], [19, "G"], [20, "Am"], [21, "F"], [21.5, "G"],
    ];
    let c = "Am";
    for (const [s, n] of map) if (t >= s - 1e-6) c = n;
    return CH[c];
  };

  // ================================================================ ARRANGEMENT
  // Written on the long cut's clock; the wrappers passed in below apply the edit plan.
  const at = (fn) => (t, ...a) => {
    const o = M(t);
    if (o != null) fn(o, ...a);
  };
  // Pads are clipped to each kept span; risers stay whole when they peak inside one.
  const padM = (t0, t1, ...a) => {
    for (const [a0, b0, s] of PLAN) {
      const x0 = Math.max(t0, a0);
      const x1 = Math.min(t1, b0);
      if (x1 - x0 > 0.05) pad(x0 + s, x1 + s, ...a);
    }
  };
  const riserM = (t0, t1, ...a) => {
    const s = shiftAt(t1 - 1e-6);
    if (s != null) riser(t0 + s, t1 + s, ...a);
  };
  arrange(at(kick), at(sub), at(clap), at(snare), at(hat), at(crash), at(bass), at(lead), at(blip), at(stab), padM, at(whoosh), riserM, at(click), at(impact), at(typeClick));
  function arrange(kick, sub, clap, snare, hat, crash, bass, lead, blip, stab, pad, whoosh, riser, click, impact, typeClick) {
  // 0.0 coin-in, rising swell
  blip(0.02, 83, 1.2, 0.07, PULSE50);
  blip(0.09, 88, 1.2, 0.28, PULSE50);
  riser(0.1, 0.5, 0.6);
  // 0.5 the button press
  click(0.47, 1.2);
  impact(0.5, 1.0, { len: 1.0 });
  crash(0.5, 0.6, 1.0);
  // Zoom into the button
  whoosh(0.56, 0.44, 1.2, true);
  riser(0.6, 1.0, 0.7);
  // Title slams
  impact(1.0, 1.0);
  stab(1.0, [57, 60, 64], 0.4, 1.2);
  crash(1.0, 0.7, 1.2);
  impact(1.25, 0.7, { sub: 0.4, len: 0.5 });
  stab(1.25, [57, 60, 64], 0.25, 0.8);
  impact(1.5, 0.95);
  stab(1.5, [53, 57, 60], 0.4, 1.1);
  // PLAYABLE: pixels resolve (descending digital blips), then the slam.
  impact(2.0, 1.15, { len: 1.1 });
  stab(2.0, [52, 56, 59, 64], 0.5, 1.3);
  [96, 91, 88, 84, 79, 76].forEach((m, i) => blip(2.0 + i * 0.05, m, 0.9, 0.04, PULSE25));
  hat(2.5, 0.8);
  hat(2.625, 0.9);
  hat(2.75, 1);
  snare(2.75, 0.5);
  snare(2.875, 0.7);
  riser(2.3, 2.95, 0.8);
  // Feed swipes
  const SW = [2.62, 3.88, 4.88, 5.88, 6.38, 6.63, 6.88, 7.13, 7.38, 7.63, 7.88];
  SW.forEach((t, i) => {
    whoosh(t - 0.05, 0.3, i === 0 ? 1.2 : 0.9, false, 0.25, -0.25);
    if (i >= 4) blip(t + 0.1, [69, 72, 76, 79, 81, 84, 88][i - 4], 0.8, 0.05, PULSE25, music);
  });

  // 3.0 - 8.0 groove
  for (let t = 3.0; t < 8.0 - 1e-6; t += 0.5) {
    kick(t, 1);
    hat(t + 0.25, 1, true);
    const beat = Math.round((t - 3.0) / 0.5);
    if (beat % 2 === 1) clap(t, 0.85);
  }
  for (let t = 3.0; t < 8.0 - 1e-6; t += 0.125) hat(t, 0.55, false, -0.3);
  crash(3.0, 0.8, 1.4);
  for (let t = 3.0; t < 8.0 - 1e-6; t += 0.25) {
    const c = chordAt(t);
    bass(t, c.b - 12 + ((Math.round(t / 0.25) % 4 === 3) ? 12 : 0), 0.22, 1, 0.6);
  }
  pad(3.0, 4.95, CH.Am.n, 0.8);
  pad(5.0, 6.95, CH.F.n, 0.8);
  pad(7.0, 8.0, CH.G.n, 0.8);
  // Arp builds in from 5.0
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let t = 5.0; t < 8.0 - 1e-6; t += 0.125) {
    const c = chordAt(t);
    const step = Math.round((t - 5.0) / 0.125);
    lead(t, c.n[ARP[step % 8]] + 12, 0.1, 0.55 + 0.25 * ((t - 5) / 3), { sustain: 0.2, delay: 0.25, send: 0.12, cut: 3800 });
  }
  // Callout ticks
  [3.02, 4.02, 5.02, 6.02, 8.02, 8.95].forEach((t) => blip(t, 93, 0.7, 0.03, PULSE25));

  // 8.0 the hold on Stackd, 8.5 the tap
  sub(8.0, 0.5, 0.5, 70, 45);
  pad(8.0, 8.5, CH.G.n, 0.7, 900);
  click(8.45, 1.1);
  [69, 72, 76, 81, 84].forEach((m, i) => blip(8.5 + i * 0.035, m, 1.2, 0.06, PULSE25));
  impact(8.5, 0.7, { sub: 0.5, len: 0.6 });
  whoosh(8.5, 0.36, 0.5, true);
  // 8.5 - 10.0 rebuild on E
  for (let t = 8.5; t < 10.0 - 1e-6; t += 0.5) kick(t, 0.9);
  for (let t = 9.0; t < 9.5 - 1e-6; t += 0.25) snare(t, 0.4 + (t - 9) * 0.4);
  for (let t = 9.5; t < 10.0 - 1e-6; t += 0.0625) snare(t, 0.4 + (t - 9.5) * 1.1);
  for (let t = 8.5; t < 10.0 - 1e-6; t += 0.25) bass(t, CH.E.b - 12, 0.2, 0.9, 0.3 + (t - 8.5) * 0.4);
  pad(8.5, 9.95, CH.E.n, 0.9, 1400);
  riser(8.8, 9.98, 1.1);
  for (let t = 8.5; t < 10.0 - 1e-6; t += 0.125) hat(t, 0.45 + (t - 8.5) * 0.3, false, 0.3);

  // 10.0 - 14.0 montage: the drop
  crash(10.0, 1.0, 1.8);
  impact(10.0, 1.0, { len: 0.8 });
  for (let t = 10.0; t < 14.0 - 1e-6; t += 0.5) {
    kick(t, 1.05);
    hat(t + 0.25, 1.1, true);
    if (Math.round((t - 10) / 0.5) % 2 === 1) clap(t, 1);
  }
  for (let t = 10.0; t < 14.0 - 1e-6; t += 0.125) hat(t, 0.6, false, -0.3);
  for (let t = 10.0; t < 14.0 - 1e-6; t += 0.25) {
    const c = chordAt(t);
    const oct = Math.round(t / 0.25) % 2 === 1 ? 12 : 0;
    bass(t, c.b - 12 + oct, 0.22, 1.05, 1.1);
  }
  for (let t = 10.0; t < 14.0 - 1e-6; t += 0.125) {
    const c = chordAt(t);
    const step = Math.round((t - 10) / 0.125);
    lead(t, c.n[ARP[step % 8]] + 12, 0.1, 0.5, { sustain: 0.2, delay: 0.2, send: 0.1, cut: 3200, pan: 0.15 });
  }
  // Hook: one note per verb.
  const HOOK = [76, 81, 84, 81, 79, 88, 86, 83];
  HOOK.forEach((m, i) => {
    const t = 10.0 + i * 0.5;
    lead(t, m + 12, 0.42, 1.25, { wave: PULSE50, sustain: 0.6, delay: 0.45, send: 0.25, slideFrom: i ? HOOK[i - 1] + 12 : undefined });
    stab(t, chordAt(t).n.slice(0, 3).map((n) => n + 12), 0.18, 0.7);
  });
  // Verb sound design
  whoosh(10.42, 0.3, 1.0, false, -0.8, 0.8); // dodge: pass-by
  whoosh(10.95, 0.16, 1.4, true, 0.4, -0.4); // slice
  click(11.0, 0.8);
  whoosh(11.45, 0.32, 0.9, true, -0.5, 0.5); // flip
  kick(12.0, 0.8, { f0: 300, f1: 90, decay: 0.2 }); // merge: two-tone thunk
  blip(12.0, 64, 1, 0.08);
  blip(12.06, 76, 1, 0.12);
  // break: bricks
  if (shiftAt(12.5) != null) {
    const b0 = M(12.5);
    const s = noiseSrc(b0, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2600;
    bp.Q.value = 0.7;
    const g = envGain(b0, 0.001, 0.35, 0.6);
    s.connect(bp).connect(g);
    out(g, { to: master, send: 0.4 });
    [91, 86, 95, 88, 84, 93].forEach((m, i) => blip(12.5 + i * 0.03 + 0.01, m, 0.7, 0.05, PULSE25));
  }
  // drop: falling pitch into a thud
  if (shiftAt(12.9) != null) {
    const d = shiftAt(12.9);
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(1600, 12.9 + d);
    o.frequency.exponentialRampToValueAtTime(140, 13.05 + d);
    const g = envGain(12.9 + d, 0.002, 0.16, 0.12);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2400;
    o.connect(f).connect(g);
    out(g, { to: master, send: 0.2 });
    o.start(12.9 + d);
    o.stop(13.1 + d);
    impact(13.05, 0.6, { sub: 0.4, len: 0.4 });
  }
  // checkmate: chime
  [88, 93, 100].forEach((m, i) => blip(13.5 + i * 0.045, m, 1.1, 0.35, PULSE25));
  crash(13.5, 0.5, 0.8);

  // 14.0 - 16.0 the wall
  impact(14.0, 0.9);
  crash(14.0, 0.9, 1.6);
  pad(14.0, 14.95, CH.F.n.map((n) => n + 12), 1.1, 2600);
  pad(15.0, 15.95, CH.G.n.map((n) => n + 12), 1.1, 3200);
  for (let t = 14.0; t < 15.5 - 1e-6; t += 0.5) {
    kick(t, 0.95);
    hat(t + 0.25, 0.9, true);
    if (Math.round((t - 14) / 0.5) % 2 === 1) clap(t, 0.9);
  }
  for (let t = 14.0; t < 16.0 - 1e-6; t += 0.25) bass(t, chordAt(t).b - 12, 0.22, 1, 0.8);
  lead(14.0, 84 + 12, 0.95, 1.0, { wave: PULSE50, sustain: 0.7, delay: 0.5, send: 0.35 });
  lead(15.0, 86 + 12, 0.45, 1.0, { wave: PULSE50, sustain: 0.7, delay: 0.5, send: 0.35 });
  lead(15.5, 83 + 12, 0.45, 1.0, { wave: PULSE50, sustain: 0.7, delay: 0.5, send: 0.35 });
  for (let t = 15.5; t < 16.0 - 1e-6; t += 0.0625) snare(t, 0.3 + (t - 15.5) * 1.2);
  riser(15.2, 15.98, 1.0);
  whoosh(15.45, 0.55, 1.1, true);

  // 16.0 - 18.0 result
  crash(16.0, 0.6, 1.2);
  kick(16.0, 1);
  for (let t = 16.0; t < 18.0 - 1e-6; t += 0.5) {
    if (t > 16.2 && t < 16.9) continue;
    kick(t, 0.85);
    hat(t + 0.25, 0.8, true);
  }
  for (let t = 16.0; t < 18.0 - 1e-6; t += 0.25) bass(t, chordAt(t).b - 12, 0.2, 0.85, 0.6);
  // The crash on the course
  impact(16.23, 0.9, { sub: 0.6, len: 0.6 });
  if (shiftAt(16.23) != null) {
    const s = noiseSrc(M(16.23), 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    const g = envGain(M(16.23), 0.001, 0.3, 0.5);
    s.connect(bp).connect(g);
    out(g, { to: master, send: 0.3 });
  }
  whoosh(16.78, 0.25, 0.6, true);
  // Odometer ticks
  for (let i = 0; i < 20; i++) {
    const k = i / 19;
    const t = 16.95 + 0.65 * (1 - (1 - k) ** 2);
    blip(t, 84 + Math.round(k * 12), 0.55, 0.025, PULSE25);
  }
  // NEW BEST
  impact(17.5, 0.85, { sub: 0.5, len: 0.6 });
  [72, 76, 79, 84, 88].forEach((m, i) => blip(17.5 + i * 0.055, m, 1.3, i === 4 ? 0.45 : 0.08, PULSE25));
  pad(17.5, 18.0, CH.C.n.map((n) => n + 12), 1.1, 3600);
  crash(17.5, 0.7, 1.2);

  // 18.0 - 20.0 challenge
  click(18.0, 0.9);
  whoosh(18.16, 0.3, 0.6, true);
  for (let t = 18.0; t < 20.0 - 1e-6; t += 0.5) {
    kick(t, 0.9);
    hat(t + 0.25, 0.85, true);
    if (Math.round((t - 18) / 0.5) % 2 === 1) clap(t, 0.8);
  }
  for (let t = 18.0; t < 20.0 - 1e-6; t += 0.125) hat(t, 0.45, false, -0.3);
  for (let t = 18.0; t < 20.0 - 1e-6; t += 0.25) bass(t, chordAt(t).b - 12 + (Math.round(t / 0.25) % 2 ? 12 : 0), 0.22, 0.95, 0.9);
  pad(18.0, 18.95, CH.F.n, 0.8);
  pad(19.0, 19.9, CH.G.n, 0.8);
  [[18.42, 81], [18.47, 88]].forEach(([t, m]) => blip(t, m, 1, 0.08, PULSE25)); // sent
  for (let t = 18.86; t < 19.14; t += 0.09) blip(t, 100, 0.35, 0.015, PULSE50); // typing dots
  blip(19.15, 76, 1, 0.1, PULSE50); // reply
  // heart: sparkle
  [91, 95, 98, 103].forEach((m, i) => blip(19.45 + i * 0.03, m, 0.9, 0.12, PULSE25));
  kick(19.45, 0.5, { f0: 400, f1: 120, decay: 0.12 });
  lead(19.5, 79 + 12, 0.42, 0.9, { wave: PULSE50 });

  // 20.0 - 22.0 creators: breakdown
  whoosh(19.92, 0.32, 1.0, false, 0.6, -0.6);
  for (let t = 20.0; t < 21.75 - 1e-6; t += 0.5) {
    kick(t, 0.5, { decay: 0.26 });
    hat(t + 0.25, 0.5, true);
  }
  for (let t = 20.0; t < 21.75 - 1e-6; t += 0.25) bass(t, chordAt(t).b - 12, 0.2, 0.55, 0.2);
  pad(20.0, 20.95, CH.Am.n, 0.9, 1100);
  pad(21.0, 21.75, CH.F.n, 0.9, 1400);
  // Typing
  const typing = (t0, dur, n) => {
    for (let i = 0; i < n; i++) typeClick(t0 + (i / n) * dur + ((i * 37) % 7) * 0.002, 0.8);
  };
  typing(20.12, 0.42, 25);
  typing(20.78, 0.3, 17);
  blip(20.62, 88, 0.7, 0.06, PULSE25);
  // Upload rising tone
  if (shiftAt(21.12) != null) {
    const d = shiftAt(21.12);
    const o = ctx.createOscillator();
    o.setPeriodicWave(PULSE25);
    o.frequency.setValueAtTime(mtof(64), 21.12 + d);
    o.frequency.exponentialRampToValueAtTime(mtof(88), 21.42 + d);
    const g = envGain(21.12 + d, 0.01, 0.3, 0.09, 0.9, 0.29, 0.02);
    o.connect(g);
    out(g, { to: master, send: 0.2 });
    o.start(21.12 + d);
    o.stop(21.5 + d);
  }
  blip(21.48, 84, 1, 0.08, PULSE25);
  blip(21.53, 88, 1, 0.12, PULSE25);
  [76, 81, 88].forEach((m, i) => blip(21.66 + i * 0.04, m + 12, 1.1, 0.2, PULSE25)); // LIVE
  riser(21.55, 22.2, 1.0);
  whoosh(21.86, 0.4, 0.9, true);

  // 22.5 the final press + logo sting
  click(22.45, 1.3);
  impact(22.5, 1.2, { sub: 1.0, len: 1.6 });
  crash(22.5, 1.0, 2.6);
  pad(22.5, 26.0, CH.Fmaj9.n, 1.2, 2400, master);
  pad(22.5, 26.0, [29, 41], 1.0, 600, master);
  [[22.5, 81, 0.25], [22.75, 84, 0.25], [23.0, 88, 0.5], [23.5, 91, 1.4]].forEach(([t, m, d]) =>
    lead(t, m, d, 1.1, { wave: PULSE50, sustain: 0.7, delay: 0.6, send: 0.5, to: master }),
  );
  typing(23.0, 0.55, 26);
  blip(23.8, 88, 0.6, 0.2, PULSE25);
  blip(23.95, 93, 0.5, 0.3, PULSE25);
  whoosh(25.12, 0.3, 0.45, false, 0.2, -0.2);
  blip(25.42, 81, 0.35, 0.08, PULSE25);
  }

  const buf = await ctx.startRendering();
  // Normalise to -1 dBFS with a short fade at the end.
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const gain = 0.84 / (peak || 1);
  const fadeFrom = Math.floor(SR * (DUR - 0.4));
  const L0 = buf.getChannelData(0);
  const R0 = buf.getChannelData(1);
  const n = L0.length;
  const wav = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => [...s].forEach((ch, i) => wav.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  wav.setUint32(4, 36 + n * 4, true);
  str(8, "WAVE");
  str(12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 2, true);
  wav.setUint32(24, SR, true);
  wav.setUint32(28, SR * 4, true);
  wav.setUint16(32, 4, true);
  wav.setUint16(34, 16, true);
  str(36, "data");
  wav.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    const f = i > fadeFrom ? Math.max(0, 1 - (i - fadeFrom) / (n - fadeFrom)) : 1;
    wav.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L0[i] * gain * f)) * 32767, true);
    wav.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R0[i] * gain * f)) * 32767, true);
  }
  const bytes = new Uint8Array(wav.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), peak };
};
