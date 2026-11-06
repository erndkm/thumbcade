/* Spot: 12 SWIPES (12.5 s; ?cut=6 for the 6 s playable lead-in). The real feed, one game per swipe, with a
   GAMES 01/12 odometer and an INSTALLS counter that never moves. Ends on "12 games. 0 installs.", a tap on
   Stackd that starts a real run, then the end card. */
(window.SPOTS = window.SPOTS || {})["12-swipes"] = (K) => {
  const { W, H, TALL, clamp, lerp, seg, outCubic, inCubic, outExpo, spring, SNAP, MORPH, el, vis, setHtml } = K;
  const T = K.layers.textLayer;
  const SHORT = K.CUT === "6";

  const ORDER = ["duskrail", "neon-chop", "flapjack", "snek", "voltbrick", "heatfall", "kingsnare", "shortwick", "pairs", "mines", "kneejerk", "stackd"];
  // Clip start (seconds into each capture) when a card lands; the captured run starts at 3.0.
  const C0 = { duskrail: 4.6, "neon-chop": 4.4, flapjack: 4.2, snek: 5.0, voltbrick: 5.4, heatfall: 4.8, kingsnare: 4.6, shortwick: 6.0, pairs: 5.0, mines: 5.6, kneejerk: 4.4 };
  const P = SHORT
    ? { DURATION: 6.0, hookOut: 0.85, SW: [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5], sum: [3.8, 4.15], sumOut: 4.45, tap: 99, end: 4.5 }
    : { DURATION: 12.5, hookOut: 1.3, SW: [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.25, 5.5, 5.75], sum: [6.0, 6.5], sumOut: 7.05, tap: 7.4, end: 10.0 };
  const { DURATION, SW } = P;
  const appear = (i) => (i === 0 ? 0 : SW[i - 1]);
  // Stackd: attract until the tap, then its captured run (from 3.0 s) at 1.5x so the tower builds.
  const stackdClip = (t) => (SHORT ? 0.8 + (t - SW[10]) : t < P.tap ? 2.9 - (P.tap - t) : 3.0 + (t - P.tap) * 1.5);

  const L = TALL
    ? { feed: { cx: 540, cy: 1120, s: 1.86 }, top: 282, hook: { w: 920, max: 104 }, cnt: { y: 290, label: 30, num: 128, lx: 96, rx: 650 }, sum: { w: 920, max: 112 } }
    : { feed: { cx: 540, cy: 818, s: 1.5 }, top: 58, hook: { w: 920, max: 96 }, cnt: { y: 64, label: 26, num: 110, lx: 96, rx: 650 }, sum: { w: 920, max: 96 } };
  const pitch = 640 * L.feed.s + (TALL ? 120 : 90);
  const clipTop = L.feed.cy - 320 * L.feed.s - 24;

  const hook = K.makeCallout(T);
  K.fillCallout(hook, "Every swipe is|a new game.");
  const sum = K.makeCallout(T);
  K.fillCallout(sum, "12 games.|0 installs.");
  const tapCall = K.makeCallout(T);
  K.fillCallout(tapCall, "Tap to play.");
  const fiveCall = K.makeCallout(T);
  K.fillCallout(fiveCall, "Five seconds.|Or five minutes.");

  // Counters
  const C = L.cnt;
  const left = el("div", "abs", T, `<div class="label" style="font-size:${C.label}px">Games</div><div style="display:flex;align-items:flex-end;margin-top:10px"><div class="odo num games" style="font-size:${C.num}px"></div><div class="num" style="font-size:${C.num * 0.42}px;color:#6E6A78;margin:0 0 ${C.num * 0.1}px 10px">/12</div></div>`);
  const odo = left.querySelector(".games");
  odo.innerHTML = K.odoHtml(2, C.num);
  const right = el("div", "abs", T, `<div class="label" style="font-size:${C.label}px">Installs</div><div class="num" style="font-size:${C.num}px;color:#FF4A3D;margin-top:10px;height:${C.num}px;line-height:${C.num}px">0</div>`);

  const BLUR = [...SW.map((s) => [s - 0.12, s + 0.3]), [P.end - 0.02, P.end + 0.42]];
  const HITS = [
    [P.sum[0], 10],
    [P.sum[1], 10],
    [P.tap + 0.02, 6],
    [P.end + 0.3, 10],
  ];

  function render(t) {
    K.begin(t, HITS);
    K.layers.cardLayer.style.clipPath = `inset(${clipTop}px 0 0 0)`;
    const F = L.feed;
    const fp = SW.reduce((a, s) => a + spring(t - s, SNAP), 0);
    for (let i = 0; i < ORDER.length; i++) {
      const rel = i - fp;
      if (rel < -1.3 || rel > 1.3) continue;
      const g = ORDER[i];
      const c = K.card();
      let feed = 1;
      let dock = 0;
      let scan = -1;
      let clip = g === "stackd" ? stackdClip(t) : C0[g] + (t - appear(i));
      if (g === "stackd" && t >= P.tap) {
        feed = 1 - outCubic(seg(t, P.tap, P.tap + 0.22));
        dock = spring(t - P.tap, MORPH);
        scan = seg(t, P.tap + 0.02, P.tap + 0.38);
        if (scan <= 0 || scan >= 1) scan = -1;
      }
      c.set({ game: g, clip, feed, dock, scan, t });
      c.place(F.cx, F.cy + rel * pitch, F.s);
    }
    const ch = 640 * F.s;
    for (const s of SW) K.swipeTouch(t, s + 0.05, F.cx + 150, F.cy + ch * 0.28, F.cy - ch * 0.14);
    K.tapTouch(t, P.tap, F.cx - 40, F.cy + ch * 0.04);

    // Hook headline (visible from the first frame), then the counters take the band.
    if (K.animateCallout(hook, t, -0.25, P.hookOut)) K.placeText(hook, K.fitSize("Every swipe is|a new game.", L.hook.w, L.hook.max), 0, L.top, "center");
    const ca = outExpo(seg(t, P.hookOut + 0.15, P.hookOut + 0.5)) * (1 - inCubic(seg(t, P.sum[0] - 0.25, P.sum[0] - 0.02)));
    vis(left, ca > 0.001);
    vis(right, ca > 0.001);
    Object.assign(left.style, { left: `${C.lx}px`, top: `${C.y}px`, opacity: ca, transform: `translateY(${(1 - ca) * 40}px)` });
    Object.assign(right.style, { left: `${C.rx}px`, top: `${C.y}px`, opacity: ca, transform: `translateY(${(1 - ca) * 40}px)` });
    // GAMES rolls one step per swipe, on the swipe's spring.
    K.setOdo(odo, 1 + clamp(fp, 0, 11), C.num);

    if (K.animateCallout(sum, t, P.sum[0], P.sumOut)) {
      K.placeText(sum, K.fitSize("12 games.|0 installs.", L.sum.w, L.sum.max), 0, L.top, "center");
      // Second line lands on the next beat.
      const ws = sum.querySelectorAll(".w");
      const a = outExpo(seg(t, P.sum[1], P.sum[1] + 0.4));
      const b = inCubic(seg(t, P.sumOut + 0.03, P.sumOut + 0.23));
      if (ws[1]) ws[1].style.transform = `translateY(${(1 - a) * 108 - b * 108}%)`;
    }
    if (!SHORT) {
      if (K.animateCallout(tapCall, t, P.tap + 0.1, 8.35)) K.placeText(tapCall, K.fitSize("Tap to play.", L.sum.w, L.sum.max), 0, L.top, "center");
      if (K.animateCallout(fiveCall, t, 8.6, 9.7)) K.placeText(fiveCall, K.fitSize("Five seconds.|Or five minutes.", L.sum.w, L.sum.max), 0, L.top, "center");
    } else {
      vis(tapCall, false);
      vis(fiveCall, false);
    }
    K.endCard(t, P.end, { fast: SHORT });
    K.end();
  }

  return { DURATION, BLUR, render };
};
