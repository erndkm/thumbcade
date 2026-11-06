/* Spot: BEAT 531 (13 s). Challenge hook on a real Duskrail run that crashes at 531.
   0.0 hook (531 + "Can you beat it?") over live gameplay · 2.4 slow-mo into the real crash at 3.0 ·
   3.3 result card, odometer, NEW BEST · 5.5 "Your move." on heat · 6.95 swipe into the feed, flicks through
   four more games ("Or any of 12 games.") · 10.0 end card. */
(window.SPOTS = window.SPOTS || {})["beat-531"] = (K) => {
  const { W, H, TALL, clamp, lerp, seg, outCubic, inCubic, inOutCubic, outExpo, spring, SNAP, POP, SHEET, el, vis, setHtml } = K;
  const T = K.layers.textLayer;

  const DURATION = 13.0;
  const CRASH = 3.0;
  const END_AT = 10.0;
  // Feed: the heat poster is swiped away at 6.95, then four flicks.
  const SW = [6.95, 7.75, 8.5, 9.0, 9.25, 9.5];
  const FEED = [
    { g: "stackd", c0: 3.6 },
    { g: "neon-chop", c0: 4.2 },
    { g: "kingsnare", c0: 4.6 },
    { g: "flapjack", c0: 4.4 },
    { g: "heatfall", c0: 5.0 },
    { g: "snek", c0: 5.2 },
  ];

  const L = TALL
    ? {
        label: { y: 286, size: 34 },
        num: { y: 330, size: 440 },
        q: { y: 812, w: 900, max: 124 },
        track: { x: 64, y: 270 },
        res: { s: 2.7, top: 430 },
        move: { w: 940, max: 250, cy: 760 },
        feed: { cx: 540, cy: 1110, s: 1.86 },
        call: { y: 282, w: 900, max: 104 },
        focusY: 0.5,
      }
    : {
        label: { y: 66, size: 30 },
        num: { y: 92, size: 340 },
        q: { y: 470, w: 900, max: 108 },
        track: { x: 60, y: 60 },
        res: { s: 2.55, top: 250 },
        move: { w: 900, max: 230, cy: 640 },
        feed: { cx: 540, cy: 815, s: 1.5 },
        call: { y: 64, w: 900, max: 96 },
        focusY: 0.95,
      };
  const pitch = 640 * L.feed.s + (TALL ? 120 : 90);

  // ---- hook elements
  const scrim = el("div", "scrim", K.layers.scrimLayer);
  scrim.style.top = "0px";
  scrim.style.height = `${TALL ? 1200 : 820}px`;
  scrim.style.background = "linear-gradient(rgba(0,0,0,0.78), rgba(0,0,0,0.55) 55%, rgba(0,0,0,0))";
  // The label sits on an ink plate so the game's own HUD line behind it never collides with it.
  const label = el("div", "abs", T, `<span class="chipk" style="background:#0D0D10;padding:0.5em 0.8em 0.45em;border-radius:6px"><span class="sq" style="background:#FF6A1A"></span>Duskrail · score to beat</span>`);
  const num = el("div", "abs num", T);
  num.style.letterSpacing = "-0.02em";
  const numInner = el("div", "", num, "531");
  const q = K.makeCallout(T);
  K.fillCallout(q, "Can you|beat it?");
  // Compact tracker during the run.
  const track = el("div", "abs", T, `<div class="label" style="font-size:${TALL ? 26 : 24}px;color:#F3F0E8">To beat</div><div class="num" style="font-size:${TALL ? 96 : 84}px;margin-top:6px">531</div>`);

  // ---- result card (logical 360 x 640 box, scaled)
  const resBox = el("div", "abs", T);
  resBox.style.width = "360px";
  resBox.style.height = "640px";
  resBox.style.transformOrigin = "0 0";
  resBox.style.setProperty("--accent", "#FF6A1A");
  resBox.innerHTML = K.resultHtml({ name: "Duskrail", digits: 3, stats: [["Distance", "291 m"], ["Bolts", "24"], ["Best", "531"]] });
  const resCard = resBox.querySelector(".result");
  const stamp = resBox.querySelector(".stamp");
  const odo = resBox.querySelector(".odo");

  // ---- poster + feed callouts
  const move = K.makeCallout(T);
  K.fillCallout(move, "Your|move.");
  move.style.color = "#0D0D10";
  move.querySelectorAll(".dot").forEach((d) => (d.style.color = "#0D0D10"));
  const call = K.makeCallout(T);
  K.fillCallout(call, "Or any of|12 games.");

  const BLUR = [
    [0, 0.22],
    [2.95, 3.12],
    ...SW.map((s) => [s - 0.12, s + 0.32]),
    [END_AT - 0.02, END_AT + 0.42],
  ];
  const HITS = [
    [0.04, 14],
    [CRASH, 20],
    [4.5, 10],
    [5.5, 12],
    [END_AT + 0.3, 10],
  ];

  function hook(t) {
    // Live run: footage of the captured run (clip 5.0 s onwards), then a slow-mo into the crash.
    const inEnd = t >= 2.4;
    const clip = inEnd ? (t < CRASH ? (t - 2.4) * 0.5 : 0.3 + (t - CRASH)) : 5.0 + t;
    const push = 1 + 0.06 * outCubic(seg(t, 0, 2.4)) + (inEnd ? 0.08 * outCubic(seg(t, 2.4, CRASH)) : 0);
    const dim = 0.55 * outCubic(seg(t, CRASH + 0.2, CRASH + 0.5));
    K.setBleed({ game: inEnd ? "duskrail-end" : "duskrail", clip, zoom: push, focusY: L.focusY, dim });

    // Scrim + big number + question (0 - 1.75)
    const out = inCubic(seg(t, 1.6, 1.85));
    scrim.style.opacity = 1 - 0.6 * seg(t, 1.6, 1.9);
    vis(scrim, t < 3.2);
    const showHook = t < 1.9;
    vis(label, showHook);
    vis(num, showHook);
    if (showHook) {
      const la = 0.35 + 0.65 * outExpo(seg(t, 0, 0.3));
      Object.assign(label.style, { fontSize: `${L.label.size}px`, color: "#F3F0E8", left: "0", width: `${W}px`, justifyContent: "center", display: "flex", top: `${L.label.y}px`, opacity: la * (1 - out), transform: `translateY(${-out * 60}px)` });
      const slam = outExpo(seg(t, 0, 0.18));
      const s = lerp(1.18, 1, slam) * (1 - 0.25 * out);
      Object.assign(num.style, { fontSize: `${L.num.size}px`, left: "0", width: `${W}px`, textAlign: "center", top: `${L.num.y}px`, opacity: 1 - out, transform: `translateY(${-out * 160}px) scale(${s})`, transformOrigin: "50% 50%" });
    }
    if (K.animateCallout(q, t, 0.22, 1.6)) K.placeText(q, K.fitSize("Can you|beat it?", L.q.w, L.q.max), 0, L.q.y, "center");

    // Tracker (1.8 - 3.2)
    const ta = outExpo(seg(t, 1.8, 2.15)) * (1 - seg(t, CRASH + 0.15, CRASH + 0.3));
    vis(track, ta > 0.001);
    Object.assign(track.style, { left: `${L.track.x}px`, top: `${L.track.y}px`, opacity: ta, transform: `translateY(${(1 - ta) * -30}px)` });
    // The tracker flips to the accent as the run reaches 531 (the HUD hits 531 at the crash).
    const hit = t >= CRASH - 0.02;
    track.lastChild.style.color = hit ? "#FF6A1A" : "#F3F0E8";
  }

  function result(t) {
    const on = t >= CRASH + 0.25 && t < 5.45;
    vis(resBox, on);
    if (!on) return;
    const s = L.res.s;
    const e = spring(t - (CRASH + 0.3), SHEET);
    const gone = inCubic(seg(t, 5.2, 5.42));
    const x = (W - 360 * s) / 2;
    const y = L.res.top - 132 * s;
    resBox.style.transform = `translate(${x}px, ${y + (1 - e) * 220 + gone * 300}px) scale(${s})`;
    resBox.style.opacity = clamp(e * 2) * (1 - gone);
    const v = 531 * outCubic(seg(t, CRASH + 0.5, 4.3));
    K.setOdo(odo, v, 64);
    const se = spring(t - 4.5, POP);
    stamp.style.opacity = t >= 4.5 ? 1 : 0;
    stamp.style.transform = `rotate(${lerp(-16, -8, se)}deg) scale(${lerp(2.4, 1, se)})`;
    resCard.style.transform = `scale(${1 + 0.015 * Math.exp(-Math.max(0, t - 4.5) * 16) * (t >= 4.5 ? 1 : 0)})`;
  }

  // Heat poster that is itself a card in the feed: the swipe at 6.95 pushes it up.
  function poster(t) {
    if (t < 5.45 || t >= SW[0] + 0.6) {
      vis(move, false);
      return;
    }
    const inK = outExpo(seg(t, 5.45, 5.6));
    const up = spring(t - SW[0], SNAP);
    const y = -up * (H + 40);
    // Revealed by a wipe from the bottom on the beat.
    K.setColor("#FF4A3D", { clipPath: `inset(${(1 - inK) * 100}% 0 0 0)` });
    K.layers.colorLayer.style.transform = `translateY(${y}px)`;
    if (K.animateCallout(move, t, 5.5, 99, { hold: true, punch: 0.06 })) {
      const size = K.fitSize("Your|move.", L.move.w, L.move.max);
      K.placeText(move, size, 0, L.move.cy - size * 0.92 + y, "center");
    }
  }

  function feed(t) {
    if (t < SW[0] - 0.05 || t >= END_AT + 0.45) {
      vis(call, false);
      return;
    }
    // The feed lives below the callout band, like a screen.
    K.layers.cardLayer.style.clipPath = `inset(${L.feed.cy - 320 * L.feed.s - 8}px 0 0 0)`;
    const fp = SW.reduce((a, s) => a + spring(t - s, SNAP), 0);
    const F = L.feed;
    for (let i = 0; i < FEED.length; i++) {
      const rel = i + 1 - fp;
      if (rel < -1.3 || rel > 1.3) continue;
      // The first card rides up from below the poster.
      const yy = i === 0 && fp < 1 ? F.cy + (1 - fp) * (H - F.cy + 640 * F.s * 0.5 + 40) : F.cy + rel * pitch;
      const m = FEED[i];
      const c = K.card();
      c.set({ game: m.g, clip: m.c0 + (t - SW[0]), feed: 1, t });
      c.place(F.cx, yy, F.s);
    }
    const ch = 640 * F.s;
    for (let i = 1; i < SW.length; i++) K.swipeTouch(t, SW[i] + 0.05, F.cx + 140, F.cy + ch * 0.28, F.cy - ch * 0.14);
    K.swipeTouch(t, SW[0] + 0.05, W * 0.62, H * 0.8, H * 0.4);
    if (K.animateCallout(call, t, 7.25, 9.75)) K.placeText(call, K.fitSize("Or any of|12 games.", L.call.w, L.call.max), 0, L.call.y, "center");
  }

  function render(t) {
    K.begin(t, HITS);
    K.layers.colorLayer.style.transform = "";
    K.layers.cardLayer.style.clipPath = "";
    if (t < 5.75) hook(t);
    else {
      vis(scrim, false);
      vis(label, false);
      vis(num, false);
      vis(q, false);
      vis(track, false);
    }
    result(t);
    poster(t);
    feed(t);
    K.endCard(t, END_AT);
    K.end();
  }

  return { DURATION, BLUR, render };
};
