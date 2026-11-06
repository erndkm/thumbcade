/* Spot: ZERO INSTALLS (13 s). "Waiting vs. playing": a running stopwatch over two screens. Left, a generic
   game's friction drawn in our own type (download, install, a 9-step tutorial, an energy timer). Right, the
   real Thumbcade feed, already playing, one game per swipe. At 7.6 the left screen drops out, the feed takes
   the frame: "No installs. No menus. No loading bars. Just swipe." End card at 10.5. */
(window.SPOTS = window.SPOTS || {})["zero-installs"] = (K) => {
  const { W, H, TALL, clamp, lerp, seg, outCubic, inCubic, inOutCubic, outExpo, inExpo, spring, SNAP, POP, el, vis, setHtml } = K;
  const T = K.layers.textLayer;

  const DURATION = 13.0;
  const SPLIT_OUT = 7.0;
  const END_AT = 10.5;
  const ORDER = ["flapjack", "stackd", "neon-chop", "snek", "voltbrick", "kingsnare", "pairs", "heatfall", "duskrail", "shortwick", "kneejerk", "mines", "flapjack"];
  const C0 = { flapjack: 3.6, stackd: 4.4, "neon-chop": 4.4, snek: 5.0, voltbrick: 5.4, kingsnare: 4.6, pairs: 5.0, heatfall: 4.8, duskrail: 4.6, shortwick: 6.0, kneejerk: 4.4, mines: 5.6 };
  // Swipes on the right screen during the split, then one per callout.
  const SW = [1.0, 1.75, 2.5, 3.25, 4.0, 4.75, 5.5, 6.25, 7.4, 8.0, 8.6, 9.3];
  const appear = (i) => (i === 0 ? 0 : SW[i - 1]);

  const L = TALL
    ? {
        top: 282,
        head: { w: 920, max: 112 },
        watch: { y: 270, size: 128 },
        lab: { y: 462, size: 26, val: 46 },
        split: { s: 1.12, cy: 905, lx: 268, rx: 812 },
        feed: { cx: 540, cy: 1120, s: 1.86 },
        call: { w: 920, max: 108 },
      }
    : {
        top: 58,
        head: { w: 920, max: 100 },
        watch: { y: 52, size: 112 },
        lab: { y: 222, size: 22, val: 40 },
        split: { s: 1.38, cy: 772, lx: 279, rx: 801 },
        feed: { cx: 540, cy: 818, s: 1.5 },
        call: { w: 920, max: 100 },
      };
  const S = L.split;
  const pitchSplit = 640 * S.s + 80;
  const pitchFeed = 640 * L.feed.s + (TALL ? 120 : 90);

  const head = K.makeCallout(T);
  K.fillCallout(head, "Waiting|vs. playing.");
  const watch = el("div", "abs num", T);
  watch.style.textAlign = "center";
  watch.style.width = `${W}px`;
  watch.style.letterSpacing = "0.02em";
  const labL = el("div", "abs", T, `<div class="label" style="font-size:${L.lab.size}px">Every other game</div><div class="num v" style="font-size:${L.lab.val}px;color:#6E6A78;margin-top:8px"></div>`);
  const labR = el("div", "abs", T, `<div class="label chipk" style="font-size:${L.lab.size}px;color:#F3F0E8"><span class="sq"></span>${K.BRAND.name}</div><div class="num v" style="font-size:${L.lab.val}px;margin-top:8px"></div>`);
  const valL = labL.querySelector(".v");
  const valR = labR.querySelector(".v");

  // The other game's screen: a logical 360 x 640 panel, scaled like a feed card.
  const other = el("div", "panel", K.layers.cardLayer);
  Object.assign(other.style, { width: "360px", height: "640px", transformOrigin: "50% 50%", left: "0", top: "0" });
  other.innerHTML = `
    <div class="abs label k" style="left:28px;top:44px;font-size:17px"></div>
    <div class="abs ph dl" style="left:28px;top:200px;width:304px">
      <div class="num pct" style="font-size:112px;color:#A7A3AE"></div>
      <div class="bar-track" style="position:relative;margin-top:22px;width:304px"><div class="bar-fill"></div></div>
      <div class="label mb" style="font-size:17px;margin-top:16px"></div>
    </div>
    <div class="abs ph in" style="left:28px;top:200px;width:304px">
      <div style="font-weight:800;font-stretch:125%;font-size:44px;color:#A7A3AE;letter-spacing:-0.02em">Installing</div>
      <div class="bar-track" style="position:relative;margin-top:26px;width:304px"><div class="bar-fill stripe" style="width:34%"></div></div>
      <div class="label" style="font-size:17px;margin-top:16px">Do not close the app</div>
    </div>
    <div class="abs ph tu" style="left:28px;top:170px;width:304px">
      <div class="label" style="font-size:17px">Tutorial</div>
      <div class="num" style="font-size:112px;color:#A7A3AE;margin-top:12px">1/9</div>
      <div class="steps" style="margin-top:24px">${"<i></i>".repeat(9)}</div>
      <div style="font-size:21px;color:#A7A3AE;margin-top:26px;line-height:28px">Swipe left to learn how to swipe left.</div>
    </div>
    <div class="abs ph en" style="left:28px;top:170px;width:304px">
      <div class="label" style="font-size:17px">Out of energy</div>
      <div class="num cd" style="font-size:94px;color:#A7A3AE;margin-top:12px"></div>
      <div style="font-size:21px;color:#A7A3AE;margin-top:22px;line-height:28px">Come back later to keep playing.</div>
    </div>`;
  const kick = other.querySelector(".k");
  const ph = { dl: other.querySelector(".dl"), in: other.querySelector(".in"), tu: other.querySelector(".tu"), en: other.querySelector(".en") };
  const pct = other.querySelector(".pct");
  const fill = other.querySelector(".dl .bar-fill");
  const mb = other.querySelector(".mb");
  const stripe = other.querySelector(".stripe");
  const steps = other.querySelectorAll(".tu .steps i");
  const cd = other.querySelector(".cd");
  // Phase windows on the stopwatch clock.
  const PH = [
    ["dl", 0.0, 3.0, "Step 1 of 4 · Download"],
    ["in", 3.0, 4.4, "Step 2 of 4 · Install"],
    ["tu", 4.4, 5.8, "Step 3 of 4 · Tutorial"],
    ["en", 5.8, 99, "Step 4 of 4 · Wait"],
  ];

  const calls = [
    { text: "No installs.", t0: 7.42, t1: 7.85 },
    { text: "No menus.", t0: 8.02, t1: 8.45 },
    { text: "No loading|bars.", t0: 8.62, t1: 9.1 },
    { text: "Just swipe.", t0: 9.32, t1: 10.3 },
  ].map((c) => {
    const e = K.makeCallout(T);
    K.fillCallout(e, c.text);
    return { ...c, e };
  });

  const BLUR = [...SW.map((s) => [s - 0.12, s + 0.3]), [SPLIT_OUT, SPLIT_OUT + 0.5], [END_AT - 0.02, END_AT + 0.42]];
  const HITS = [
    [0.02, 8],
    [SPLIT_OUT + 0.35, 8],
    [7.42, 8],
    [9.32, 12],
    [END_AT + 0.3, 10],
  ];

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${String(m).padStart(2, "0")}:${r.toFixed(1).padStart(4, "0")}`;
  };

  function otherScreen(t) {
    const out = inOutCubic(seg(t, SPLIT_OUT, SPLIT_OUT + 0.55));
    vis(other, out < 1);
    if (out >= 1) return;
    const s = S.s * (1 - 0.1 * out);
    other.style.transform = `translate(${S.lx - 180 - out * (W * 0.75)}px, ${S.cy - 320 + out * 120}px) rotate(${-out * 10}deg) scale(${s})`;
    other.style.opacity = 1 - out * 0.4;
    for (const [k, a, b, label] of PH) {
      const on = t >= a && t < b;
      vis(ph[k], on);
      if (on) {
        kick.textContent = label;
        const e = outExpo(seg(t, a, a + 0.35));
        ph[k].style.opacity = a === 0 ? 1 : e;
        ph[k].style.transform = `translateY(${a === 0 ? 0 : (1 - e) * 24}px)`;
      }
    }
    const p = 31 * (1 - (1 - clamp(t / 3.0)) ** 1.6);
    pct.textContent = `${Math.floor(p)}%`;
    fill.style.width = `${p}%`;
    mb.textContent = `${((214 * p) / 100).toFixed(1)} / 214 MB`;
    stripe.style.transform = `translateX(${((t * 1.4) % 1) * 300 - 110}px)`;
    steps.forEach((s, i) => s.classList.toggle("on", i === 0));
    const left = 30 * 60 - Math.max(0, t - 5.8);
    cd.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
    // Label value
    valL.textContent = PH.find(([, a, b]) => t >= a && t < b)[3].split(" · ")[0];
  }

  function render(t) {
    K.begin(t, HITS);
    const k = inOutCubic(seg(t, SPLIT_OUT, SPLIT_OUT + 0.6));
    const fp = SW.reduce((a, s) => a + spring(t - s, SNAP), 0);
    // Right screen -> the full feed.
    const cx = lerp(S.rx, L.feed.cx, k);
    const cy = lerp(S.cy, L.feed.cy, k);
    const sc = lerp(S.s, L.feed.s, k);
    const pitch = lerp(pitchSplit, pitchFeed, k);
    K.layers.cardLayer.style.clipPath = "";
    for (let i = 0; i < ORDER.length; i++) {
      const rel = i - fp;
      if (rel < -1.3 || rel > 1.3) continue;
      const g = ORDER[i];
      const c = K.card();
      c.set({ game: g, clip: C0[g] + (t - appear(i)), feed: 1, t, clipPath: "" });
      c.place(cx, cy + rel * pitch, sc);
      // Each screen is a window: cards are clipped to the screen's top edge.
      const yTop = Math.max(0, -rel * pitch);
      const yBot = Math.max(0, rel * pitch) * (1 - k);
      c.el.style.clipPath = yTop > 0 || yBot > 0 ? `inset(${yTop / sc}px 0 ${yBot / sc}px 0)` : "";
    }
    const ch = 640 * sc;
    for (const s of SW) K.swipeTouch(t, s + 0.05, cx + 70 * sc, cy + ch * 0.28, cy - ch * 0.14);

    otherScreen(t);

    // Headline (hook), then the stopwatch.
    if (K.animateCallout(head, t, -0.25, 1.25)) K.placeText(head, K.fitSize("Waiting|vs. playing.", L.head.w, L.head.max), 0, L.top, "center");
    const wa = outExpo(seg(t, 1.35, 1.7)) * (1 - inCubic(seg(t, SPLIT_OUT - 0.1, SPLIT_OUT + 0.2)));
    vis(watch, wa > 0.001);
    Object.assign(watch.style, { fontSize: `${L.watch.size}px`, left: "0", top: `${L.watch.y}px`, opacity: wa, transform: `translateY(${(1 - wa) * 40}px)` });
    watch.textContent = fmt(Math.min(t, SPLIT_OUT));
    const la = outExpo(seg(t, 1.3, 1.65)) * (1 - inCubic(seg(t, SPLIT_OUT - 0.1, SPLIT_OUT + 0.15)));
    vis(labL, la > 0.001);
    vis(labR, la > 0.001);
    const lw = 320 * S.s;
    Object.assign(labL.style, { left: `${S.lx - lw / 2 + 4}px`, top: `${L.lab.y}px`, opacity: la });
    Object.assign(labR.style, { left: `${S.rx - lw / 2 + 4}px`, top: `${L.lab.y}px`, opacity: la });
    valR.textContent = `Game ${String(1 + Math.round(clamp(fp, 0, 11))).padStart(2, "0")}`;

    for (const c of calls) {
      if (K.animateCallout(c.e, t, c.t0, c.t1)) K.placeText(c.e, K.fitSize(c.text, L.call.w, L.call.max), 0, L.top, "center");
    }
    K.endCard(t, END_AT);
    K.end();
  }

  return { DURATION, BLUR, render };
};
