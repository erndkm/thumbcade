/* Thumbcade ad studio soundtracks: 120 BPM, A minor, synthesized offline with Web Audio.
   Instruments are copied from marketing/trailer/comp/music.js; each spot has its own arrangement, cued to
   the compositor's timeline. window.renderSound(spot, cut) -> { b64 (16-bit WAV), peak }. */
window.renderSound = async function renderSound(spot, cut) {
  const SR = 48000;
  const DUR = { "beat-531": 13.0, "12-swipes": cut === "6" ? 6.0 : 12.5, "zero-installs": 13.0 }[spot];
  if (!DUR) throw new Error(`unknown spot ${spot}`);
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * DUR), SR);
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

  // ---------------------------------------------------------------- bus + instruments (from the trailer)
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

  // ---------------------------------------------------------------- shared phrases
  const chordOf = (map) => (t) => {
    let c = map[0][1];
    for (const [s, n] of map) if (t >= s - 1e-6) c = n;
    return CH[c];
  };
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  function groove(t0, t1, chord, o = {}) {
    const v = o.v ?? 1;
    for (let t = t0; t < t1 - 1e-6; t += 0.5) {
      kick(t, v);
      hat(t + 0.25, 0.9 * v, true);
      if (o.clap !== false && Math.round((t - t0) / 0.5) % 2 === 1) clap(t, 0.85 * v);
    }
    for (let t = t0; t < t1 - 1e-6; t += 0.125) hat(t, 0.5 * v, false, -0.3);
    for (let t = t0; t < t1 - 1e-6; t += 0.25) {
      const c = chord(t);
      const oct = o.octave && Math.round(t / 0.25) % 2 === 1 ? 12 : 0;
      bass(t, c.b - 12 + oct, 0.22, v, o.bright ?? 0.8);
    }
    if (o.arp) {
      for (let t = t0; t < t1 - 1e-6; t += 0.125) {
        const c = chord(t);
        const step = Math.round((t - t0) / 0.125);
        lead(t, c.n[ARP[step % 8]] + 12, 0.1, o.arp, { sustain: 0.2, delay: 0.22, send: 0.12, cut: 3600 });
      }
    }
  }
  const SCALE = [69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86, 88];
  function swipeSfx(t, i, v = 0.9) {
    whoosh(t - 0.05, 0.3, v, false, 0.25, -0.25);
    blip(t + 0.1, SCALE[i % SCALE.length], 0.8, 0.05, PULSE25, music);
  }
  const typing = (t0, dur, n) => {
    for (let i = 0; i < n; i++) typeClick(t0 + (i / n) * dur + ((i * 37) % 7) * 0.002, 0.8);
  };
  function snareRoll(t0, t1, v0 = 0.3, v1 = 0.9) {
    for (let t = t0; t < t1 - 1e-6; t += 0.0625) snare(t, v0 + (v1 - v0) * ((t - t0) / (t1 - t0)));
  }
  function crashHit(t) {
    const s = noiseSrc(t, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    const g = envGain(t, 0.001, 0.3, 0.5);
    s.connect(bp).connect(g);
    out(g, { to: master, send: 0.3 });
  }
  /** End card: the button pops at t0, is pressed at t0 + 0.3, the wordmark rises, the tagline types. */
  function endSting(t0, fast = false) {
    const f = fast ? 0.6 : 1;
    const pt = t0 + 0.3;
    const tail = DUR - 0.1;
    whoosh(t0 - 0.08, 0.35, 0.8, true);
    click(pt - 0.05, 1.3);
    impact(pt, 1.2, { sub: 1.0, len: 1.6 });
    crash(pt, 1.0, 2.4);
    pad(pt, tail, CH.Fmaj9.n, 1.2, 2400, master);
    pad(pt, tail, [29, 41], 1.0, 600, master);
    const notes = [[pt, 81, 0.25], [pt + 0.25, 84, 0.25], [pt + 0.5, 88, 0.5], [pt + 1.0, 91, Math.max(0.3, tail - pt - 1.3)]];
    notes.forEach(([t, m, d]) => t < tail - 0.2 && lead(t, m, d, 1.1, { wave: PULSE50, sustain: 0.7, delay: 0.6, send: 0.5, to: master }));
    typing(t0 + 0.75 * f, fast ? 0.4 : 0.5, 24);
    blip(t0 + 0.75 * f + (fast ? 0.4 : 0.5), 88, 0.6, 0.2, PULSE25);
  }
  /** Odometer ticks following the compositor's outCubic roll between t0 and t1. */
  function odoTicks(t0, t1, n = 20) {
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      blip(t0 + (t1 - t0) * (1 - Math.cbrt(1 - k)), 84 + Math.round(k * 12), 0.55, 0.025, PULSE25);
    }
  }

  // ================================================================ arrangements
  if (spot === "beat-531") {
    const chord = chordOf([[0, "Am"], [1, "F"], [2, "G"], [5.5, "Am"], [6.5, "F"], [7.5, "C"], [8.5, "G"], [9.0, "E"]]);
    // 0.0 the 531 slam
    impact(0.0, 1.1, { len: 1.0 });
    stab(0.0, [57, 60, 64], 0.45, 1.3);
    crash(0.0, 0.8, 1.4);
    [96, 91, 88, 84].forEach((m, i) => blip(0.02 + i * 0.04, m, 0.8, 0.04, PULSE25));
    groove(0.0, 2.4, chord, { v: 0.95, arp: 0.5 });
    blip(0.22, 93, 0.7, 0.03, PULSE25);
    blip(0.29, 96, 0.7, 0.03, PULSE25);
    blip(1.8, 88, 0.6, 0.05, PULSE25);
    riser(1.6, 2.4, 0.7);
    // 2.4 slow motion into the crash: the music ducks under a low-pass, a heartbeat, a snare roll
    lp.setValueAtTime(20000, 2.35);
    lp.exponentialRampToValueAtTime(380, 2.6);
    lp.setValueAtTime(380, 2.98);
    lp.setValueAtTime(20000, 3.0);
    sub(2.4, 0.6, 0.45, 70, 40);
    sub(2.7, 0.55, 0.4, 70, 40);
    pad(2.4, 3.0, CH.E.n, 0.9, 900);
    snareRoll(2.5, 3.0, 0.15, 0.6);
    whoosh(2.4, 0.6, 0.6, true);
    // 3.0 the crash on the course
    impact(3.0, 1.2, { sub: 0.9, len: 0.9 });
    crash(3.0, 0.9, 1.6);
    crashHit(3.0);
    // 3.3 result card, odometer, 4.5 NEW BEST
    whoosh(3.28, 0.25, 0.6, true);
    odoTicks(3.5, 4.3);
    pad(3.3, 4.5, CH.Am.n, 0.7, 1200);
    for (let t = 3.5; t < 5.5 - 1e-6; t += 0.5) {
      kick(t, 0.6, { decay: 0.3 });
      hat(t + 0.25, 0.6, true);
    }
    for (let t = 3.5; t < 5.5 - 1e-6; t += 0.25) bass(t, (t < 4.5 ? CH.Am : CH.C).b - 12, 0.2, 0.7, 0.4);
    impact(4.5, 0.85, { sub: 0.5, len: 0.6 });
    [72, 76, 79, 84, 88].forEach((m, i) => blip(4.5 + i * 0.055, m, 1.3, i === 4 ? 0.45 : 0.08, PULSE25));
    pad(4.5, 5.45, CH.C.n.map((n) => n + 12), 1.0, 3600);
    crash(4.5, 0.7, 1.2);
    // 5.5 YOUR MOVE.
    impact(5.5, 1.15, { len: 1.0 });
    stab(5.5, [57, 60, 64], 0.45, 1.3);
    crash(5.5, 0.8, 1.4);
    groove(5.5, 6.95, chord, { v: 0.9 });
    riser(6.4, 6.95, 0.8);
    // 6.95 swipe into the feed, flicks
    [6.95, 7.75, 8.5, 9.0, 9.25, 9.5].forEach((s, i) => swipeSfx(s, i + 4));
    crash(7.0, 0.7, 1.2);
    groove(7.0, 10.0, chord, { v: 1, arp: 0.6, octave: true });
    blip(7.25, 93, 0.7, 0.03, PULSE25);
    blip(7.32, 96, 0.7, 0.03, PULSE25);
    snareRoll(9.5, 10.0, 0.4, 1.0);
    riser(9.2, 10.0, 1.0);
    endSting(10.0);
  } else if (spot === "12-swipes" && cut === "6") {
    const chord = chordOf([[0, "Am"], [1, "F"], [2, "G"], [3, "E"], [3.75, "Am"]]);
    const SW = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5];
    impact(0.0, 1.0, { len: 0.8 });
    stab(0.0, [57, 60, 64], 0.4, 1.1);
    crash(0.0, 0.8, 1.4);
    groove(0.0, 1.0, chord, { v: 0.95 });
    groove(1.0, 3.75, chord, { v: 1, arp: 0.55, octave: true });
    SW.forEach((s, i) => swipeSfx(s, i, 0.8));
    impact(3.8, 1.0, { len: 0.6 });
    stab(3.8, [57, 60, 64], 0.35, 1.2);
    impact(4.15, 0.9, { sub: 0.5, len: 0.5 });
    stab(4.15, [53, 57, 60], 0.3, 1.1);
    riser(3.9, 4.5, 0.8);
    endSting(4.5, true);
  } else if (spot === "12-swipes") {
    const chord = chordOf([[0, "Am"], [2, "F"], [3, "G"], [4, "Am"], [5, "F"], [5.5, "G"], [6, "Am"], [6.5, "F"], [7.4, "E"], [8.5, "Am"], [9, "F"], [9.5, "G"]]);
    const SW = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.25, 5.5, 5.75];
    impact(0.0, 1.0, { len: 0.9 });
    stab(0.0, [57, 60, 64], 0.4, 1.1);
    crash(0.0, 0.8, 1.4);
    groove(0.0, 3.0, chord, { v: 0.95 });
    groove(3.0, 6.0, chord, { v: 1, arp: 0.55, octave: true });
    SW.forEach((s, i) => swipeSfx(s, i));
    // 12 games. / 0 installs.
    impact(6.0, 1.0, { len: 0.6 });
    stab(6.0, [57, 60, 64], 0.35, 1.2);
    impact(6.5, 0.9, { sub: 0.5, len: 0.5 });
    stab(6.5, [53, 57, 60], 0.3, 1.1);
    groove(6.0, 7.4, chord, { v: 0.9 });
    // The tap: filter closes into it, then rebuilds to the end card.
    lp.setValueAtTime(20000, 6.7);
    lp.exponentialRampToValueAtTime(420, 7.35);
    lp.setValueAtTime(420, 7.42);
    lp.exponentialRampToValueAtTime(20000, 9.95);
    click(7.35, 1.1);
    [69, 72, 76, 81, 84].forEach((m, i) => blip(7.4 + i * 0.035, m, 1.2, 0.06, PULSE25));
    impact(7.4, 0.7, { sub: 0.5, len: 0.6 });
    whoosh(7.4, 0.36, 0.5, true);
    for (let t = 7.5; t < 10.0 - 1e-6; t += 0.5) kick(t, 0.9);
    for (let t = 7.5; t < 10.0 - 1e-6; t += 0.25) bass(t, chord(t).b - 12, 0.2, 0.9, 0.3 + (t - 7.5) * 0.25);
    for (let t = 7.5; t < 10.0 - 1e-6; t += 0.125) hat(t, 0.4 + (t - 7.5) * 0.15, false, 0.3);
    pad(7.4, 8.45, CH.E.n, 0.9, 1400);
    pad(8.5, 9.95, CH.Am.n, 0.9, 1800);
    blip(8.6, 93, 0.7, 0.03, PULSE25);
    blip(8.67, 96, 0.7, 0.03, PULSE25);
    snareRoll(9.0, 10.0, 0.25, 1.0);
    riser(8.8, 10.0, 1.1);
    endSting(10.0);
  } else if (spot === "zero-installs") {
    const chord = chordOf([[0, "Am"], [2, "F"], [4, "Am"], [6, "E"], [7.0, "Am"], [8.0, "F"], [9.0, "C"], [9.5, "G"]]);
    // 0 - 7: the waiting room. The music sits under a low-pass; a stopwatch ticks; the right screen's swipes are crisp.
    lp.setValueAtTime(650, 0);
    lp.setValueAtTime(650, 6.0);
    lp.exponentialRampToValueAtTime(3200, 6.98);
    lp.setValueAtTime(20000, 7.0);
    impact(0.0, 0.9, { len: 0.8 });
    stab(0.0, [57, 60, 64], 0.4, 1.0);
    groove(0.0, 7.0, chord, { v: 0.85 });
    pad(0.0, 6.95, CH.Am.n, 0.8, 900);
    for (let t = 1.5; t < 7.0 - 1e-6; t += 0.5) click(t, 0.28);
    [1.0, 1.75, 2.5, 3.25, 4.0, 4.75, 5.5, 6.25].forEach((s, i) => swipeSfx(s, i, 0.7));
    riser(6.2, 7.0, 0.9);
    snareRoll(6.5, 7.0, 0.2, 0.8);
    // 7.0 the feed takes the frame
    impact(7.0, 1.15, { len: 1.0 });
    crash(7.0, 1.0, 1.6);
    whoosh(7.0, 0.5, 0.9, true);
    groove(7.0, 10.5, chord, { v: 1, arp: 0.6, octave: true });
    [7.4, 8.0, 8.6, 9.3].forEach((s, i) => swipeSfx(s, i + 8));
    [[7.42, [57, 60, 64]], [8.02, [53, 57, 60]], [8.62, [55, 60, 64]]].forEach(([t, n]) => {
      stab(t, n, 0.3, 1.1);
      blip(t, 93, 0.7, 0.03, PULSE25);
    });
    impact(9.32, 1.1, { len: 0.8 });
    stab(9.32, [55, 59, 62, 67], 0.45, 1.3);
    crash(9.32, 0.8, 1.2);
    snareRoll(10.0, 10.5, 0.4, 1.0);
    riser(9.8, 10.5, 1.0);
    endSting(10.5);
  }

  // ---------------------------------------------------------------- render + WAV
  const buf = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  // Normalise so the mix lands near -14 LUFS with headroom for AAC; short fade at the end.
  const gain = 0.7 / (peak || 1);
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
