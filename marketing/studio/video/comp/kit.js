/* Thumbcade ad studio: shared compositor kit. Every pixel is a pure function of t (seconds), so frames
   render in any order and can be sub-sampled for motion blur. Adapted from marketing/trailer/comp/trailer.js.
   120 BPM: one beat = 0.5 s. */
(() => {
  const Q = new URLSearchParams(location.search);
  const W = Number(Q.get("w")) || 1080;
  const H = Number(Q.get("h")) || 1920;
  /** 9:16 (Reels, Stories, TikTok) vs 4:5 (Meta Feed). */
  const TALL = H / W > 1.5;
  const FPS = 60;
  const CUT = Q.get("cut") || "";
  const FR = window.FRAMES || {};
  // The brand on screen: Thumbcade, unless the renderer injects window.BRAND (render.mjs --brand, see marketing/swipesu).
  // engraving: the cap artwork in the 1024 mark space (null keeps the thumbprint). wordmarkWidth: the wordmark's
  // width at the 150-unit height of wordmark.svg, so other names keep the same type size.
  const BRAND = { name: "thumbcade", engraving: null, wordmark: "/assets/wordmark.svg", wordmarkWidth: 771, avatar: TC.avatars.thumbcade, ...window.BRAND };
  // BRAND.icon replaces the button with an app icon whose swipe draws itself across (see marketing/swuple/swipe).
  const ICON = BRAND.icon || null;

  const stage = document.getElementById("stage");
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;

  // ------------------------------------------------------------------ math
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const outCubic = (k) => 1 - (1 - k) ** 3;
  const inCubic = (k) => k ** 3;
  const inOutCubic = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
  const outExpo = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
  const inExpo = (k) => (k <= 0 ? 0 : 2 ** (10 * k - 10));
  const inOutExpo = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 2 ** (20 * k - 10) / 2 : (2 - 2 ** (-20 * k + 10)) / 2);

  /** Step response of a damped spring (0 -> 1), matching the app's Reanimated configs. */
  function spring(dt, c) {
    if (dt <= 0) return 0;
    const w0 = Math.sqrt(c.stiffness / c.mass);
    const z = c.damping / (2 * Math.sqrt(c.stiffness * c.mass));
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * dt) * (Math.cos(wd * dt) + ((z * w0) / wd) * Math.sin(wd * dt));
    }
    return 1 - Math.exp(-w0 * dt) * (1 + w0 * dt);
  }
  const SNAP = { damping: 26, stiffness: 260, mass: 1 };
  const POP = { damping: 11, stiffness: 340, mass: 0.7 };
  const SHEET = { damping: 24, stiffness: 220, mass: 1 };
  const MORPH = { damping: 22, stiffness: 240, mass: 1 };
  const UI = { damping: 20, stiffness: 320, mass: 0.8 };

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ dom
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || stage).appendChild(e);
    return e;
  }
  const vis = (e, on) => {
    const d = on ? "" : "none";
    if (e.style.display !== d) e.style.display = d;
  };
  const setHtml = (e, html) => {
    if (e._html === html) return;
    e._html = html;
    e.innerHTML = html;
  };
  const pending = new Set();
  function setSrc(img, url) {
    if (img._src === url) return;
    img._src = url;
    img.src = url;
    pending.add(img);
  }
  async function settle() {
    const list = [...pending];
    pending.clear();
    await Promise.all(list.map((i) => i.decode().catch(() => {})));
  }
  /** Footage frame for a capture at clip time c (seconds). */
  const frameUrl = (game, c) => {
    const n = FR[game] || 1;
    const i = clamp(Math.round(c * FPS), 0, n - 1);
    return `/frames/${game}/f${String(i).padStart(5, "0")}.jpg`;
  };

  const IC = TC.icons;
  function icon(name, size, o = {}) {
    const d = IC[name];
    const color = o.color || "currentColor";
    const sw = o.stroke || 1.75;
    if (o.filled || d.solid) {
      const detail = o.filled && d.filledDetail ? `<path d="${d.filledDetail}" fill="none" stroke="${o.detail || "#0D0D10"}" stroke-width="${sw}" stroke-linecap="square"/>` : "";
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${d.filled || d.d}" fill="${color}"/>${detail}</svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${d.d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
  }

  // ------------------------------------------------------------------ games (manifest copy; no social counts in ads)
  const G = {
    duskrail: { name: "Duskrail", accent: "#FF6A1A", desc: "Three lanes. Zero chill. Swipe to dodge, jump and slide.", tags: ["runner", "3d", "reflex"], kind: "3D runner", input: "Swipe" },
    "neon-chop": { name: "Neon Chop", accent: "#FF3D6E", desc: "The Glow Market is open late. Never cut the static.", tags: ["slash", "reflex", "neon"], kind: "Slasher", input: "Drag" },
    flapjack: { name: "Flapjack", accent: "#FFB23F", desc: "A pancake with ambition. Tap to flip through the forks.", tags: ["onetap", "flyer", "arcade"], kind: "One-tap flyer", input: "Tap" },
    snek: { name: "Snek", accent: "#4DFF88", desc: "Swipe to steer a very hungry snek. Don't eat yourself.", tags: ["snake", "retro", "arcade"], kind: "Snake", input: "Swipe" },
    voltbrick: { name: "Voltbrick", accent: "#4D8DFF", desc: "Split the ball, grab the beam, clear the grid.", tags: ["bricks", "retro", "arcade"], kind: "Brick breaker", input: "Drag" },
    heatfall: { name: "Heatfall", accent: "#FFE14D", desc: "Spin the grates, drop the ember, dodge the coolant.", tags: ["3d", "arcade", "chill"], kind: "3D drop", input: "Drag" },
    kingsnare: { name: "Kingsnare", accent: "#5CF2B8", desc: "Ninety seconds of checkmates. No draws, no mercy.", tags: ["chess", "puzzle", "brain"], kind: "Chess puzzles", input: "Tap" },
    shortwick: { name: "Shortwick", accent: "#B48CFF", desc: "Slide, merge, keep the fuse lit.", tags: ["merge", "puzzle", "brain"], kind: "Merge puzzle", input: "Swipe" },
    pairs: { name: "Pairs", accent: "#FF6FB5", desc: "Peek, flip, match. Every pair buys you two seconds.", tags: ["matching", "brain", "chill"], kind: "Memory", input: "Tap" },
    mines: { name: "Mines", accent: "#7CC4FF", desc: "Sonar says 15 mines. Sonar has been wrong before.", tags: ["logic", "puzzle", "classic"], kind: "Logic", input: "Tap" },
    stackd: { name: "Stackd", accent: "#3DE0FF", desc: "Drop the slab, slice the overhang, build it tall.", tags: ["3d", "stacking", "onetap"], kind: "3D stacker", input: "Tap" },
    kneejerk: { name: "Kneejerk", accent: "#00E5C7", desc: "Four tiny tests, one thumb, three lives. Fast.", tags: ["reflex", "speed", "brain"], kind: "Reflex tests", input: "Tap" },
  };
  G["duskrail-end"] = G.duskrail;
  const base = (g) => g.replace("-end", "");

  // ------------------------------------------------------------------ layers
  const cam = el("div", "layer");
  const bg = el("div", "layer", cam);
  const dots = el("div", "dots", bg);
  const bleedLayer = el("div", "layer", cam);
  const colorLayer = el("div", "layer", cam);
  const cardLayer = el("div", "layer", cam);
  const scrimLayer = el("div", "layer", cam);
  const fxLayer = el("div", "layer", cam);
  const textLayer = el("div", "layer", cam);
  const endLayer = el("div", "layer", cam);
  const touchLayer = el("div", "layer", cam);
  [bg, bleedLayer, colorLayer, cardLayer, scrimLayer, fxLayer, textLayer, endLayer, touchLayer].forEach((l, i) => (l.style.zIndex = i + 1));
  const dotGap = 40;
  dots.style.backgroundSize = `${dotGap}px ${dotGap}px`;

  // Full-bleed footage (object-fit: cover with a focus point and a zoom).
  const bleed = el("img", "bleed", bleedLayer);
  const bleedDim = el("div", "layer", bleedLayer);
  bleedDim.style.background = "#000";
  function setBleed(o) {
    const on = !!o;
    vis(bleedLayer, on);
    if (!on) return;
    setSrc(bleed, frameUrl(o.game, o.clip));
    const s0 = Math.max(W / 1080, H / 1920);
    const s = s0 * (o.zoom || 1);
    const fy = o.focusY ?? 0.5;
    const fx = o.focusX ?? 0.5;
    const x = (W - 1080 * s) * fx + (o.dx || 0);
    const y = (H - 1920 * s) * fy + (o.dy || 0);
    bleed.style.width = "1080px";
    bleed.style.height = "1920px";
    bleed.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    bleedLayer.style.opacity = o.opacity ?? 1;
    bleedDim.style.opacity = o.dim || 0;
    bleedLayer.style.clipPath = o.clipPath || "";
  }

  // Solid color plate (heat poster beats, game accent beats).
  function setColor(c, o = {}) {
    vis(colorLayer, !!c);
    if (!c) return;
    colorLayer.style.background = c;
    colorLayer.style.clipPath = o.clipPath || "";
    colorLayer.style.opacity = o.opacity ?? 1;
  }

  // ------------------------------------------------------------------ the feed card (logical 360 x 640)
  function makeCard() {
    const c = el("div", "card", cardLayer);
    const shot = el("img", "shot", c);
    const dim = el("div", "layer", c);
    dim.style.background = "#0D0D10";
    const scrimT = el("div", "scrim-top", c);
    const scrimB = el("div", "scrim-bottom", c);
    const tabs = el("div", "tabs", c, `<span class="dim">Following</span><span class="on">For You</span>`);
    const search = el("div", "search", c, icon("search", 21, { color: "#F3F0E8", stroke: 2 }));
    const rail = el("div", "rail", c);
    const av = el("div", "item", rail, `<div class="avatar">${BRAND.avatar}</div><div class="follow">${icon("plus", 11, { color: "#0D0D10", stroke: 3 })}</div>`);
    av.style.top = "262px";
    const mk = (name, top) => {
      const it = el("div", "item", rail, icon(name, 29, { color: "#F3F0E8", stroke: 2 }));
      it.style.top = `${top}px`;
      return it;
    };
    mk("like", 330);
    mk("comment", 382);
    mk("save", 434);
    mk("share", 486);
    const cart = el("div", "cart", rail, `<img>`);
    const cartImg = cart.querySelector("img");
    const caption = el("div", "caption", c);
    const bar = el("div", "bar", c);
    const tabbar = el(
      "div",
      "tabbar",
      bar,
      `<div class="t on">${icon("home", 22, { filled: true, color: "#F3F0E8" })}<span>Home</span></div>` +
        `<div class="t">${icon("discover", 22, { color: "#A7A3AE", stroke: 2 })}<span>Discover</span></div>` +
        `<div class="t"><div class="create">${icon("plus", 15, { color: "#0D0D10", stroke: 2.6 })}</div></div>` +
        `<div class="t">${icon("inbox", 22, { color: "#A7A3AE", stroke: 2 })}<span>Inbox</span></div>` +
        `<div class="t">${icon("profile", 22, { color: "#A7A3AE", stroke: 2 })}<span>Profile</span></div>`,
    );
    const dock = el(
      "div",
      "dock",
      bar,
      `<div class="abs" style="left:20px;top:14px">${icon("like", 22, { color: "#F3F0E8", stroke: 2 })}</div>` +
        `<div class="grabber"></div>` +
        `<div class="abs" style="left:280px;top:14px">${icon("soundOn", 22, { color: "#F3F0E8", stroke: 2 })}</div>` +
        `<div class="abs" style="left:318px;top:14px">${icon("more", 22, { color: "#F3F0E8" })}</div>`,
    );
    const grabber = dock.querySelector(".grabber");
    const scan = el("div", "scan", c);
    const scanband = el("div", "scanband", c);
    const ring = el("div", "ring", c);
    const extra = el("div", "layer extra", c);

    let game = null;
    const api = {
      el: c,
      extra,
      shot,
      setGame(g) {
        if (g === game) return;
        game = g;
        const m = G[g];
        c.style.setProperty("--accent", m.accent);
        caption.innerHTML =
          `<div class="handle">@${BRAND.name}<span class="verified">${icon("check", 10, { color: "#0D0D10", stroke: 3.2 })}</span></div>` +
          `<div class="gname">${m.name}</div><div class="desc">${m.desc}</div>` +
          `<div class="chips">${m.tags.map((x) => `<span class="chip">#${x}</span>`).join("")}</div>` +
          `<div class="meta">&#9656; ${m.kind} · ${m.input}</div>`;
        setSrc(cartImg, `/assets/icons/${base(g)}.png`);
      },
      /** feed: chrome opacity 0..1, dock: tab bar -> Dock morph 0..1, bar: show the bottom bar at all. */
      set(o) {
        api.setGame(o.game);
        setSrc(shot, frameUrl(o.game, o.clip));
        const feed = o.feed ?? 0;
        const dk = o.dock ?? 0;
        const showBar = o.bar ?? (feed > 0 || dk > 0);
        for (const e of [scrimT, scrimB, tabs, search, rail, caption]) {
          vis(e, feed > 0.001);
          e.style.opacity = feed;
        }
        rail.style.transform = `translateX(${(1 - feed) * 24}px)`;
        caption.style.transform = `translateY(${(1 - feed) * 18}px)`;
        cart.style.transform = `rotate(${(o.t || 0) * 90}deg)`;
        vis(bar, showBar);
        tabbar.style.opacity = 1 - clamp(dk * 1.6);
        tabbar.style.transform = `scale(${1 - 0.12 * dk})`;
        vis(dock, dk > 0.001);
        dock.style.opacity = clamp(dk * 1.4 - 0.2);
        grabber.style.width = `${44 * clamp(dk)}px`;
        grabber.style.left = `${180 - 22 * clamp(dk)}px`;
        const sc = o.scan ?? -1;
        vis(scan, sc >= 0 && sc <= 1);
        vis(scanband, sc >= 0 && sc <= 1);
        if (sc >= 0 && sc <= 1) {
          scan.style.top = `${sc * 640}px`;
          scanband.style.top = `${sc * 640 - 60}px`;
        }
        dim.style.opacity = o.dim ?? 0;
        vis(dim, (o.dim ?? 0) > 0.001);
        vis(ring, o.ring !== false);
        c.style.opacity = o.opacity ?? 1;
        c.style.clipPath = o.clipPath || "";
        c.style.filter = o.filter || "";
        c.style.zIndex = o.z ?? "";
        c.style.borderRadius = o.radius != null ? `${o.radius}px` : "";
      },
      place(cx, cy, s, extraT = "") {
        c.style.transform = `translate(${cx - 180}px, ${cy - 320}px) ${extraT} scale(${s})`;
      },
    };
    return api;
  }
  const cardPool = [];
  let cardsUsed = 0;
  function card() {
    if (cardsUsed >= cardPool.length) cardPool.push(makeCard());
    const c = cardPool[cardsUsed++];
    vis(c.el, true);
    setHtml(c.extra, "");
    c.shot.style.opacity = "";
    return c;
  }

  // ------------------------------------------------------------------ touches
  const touchPool = [];
  let touchUsed = 0;
  const TOUCH = TALL ? 92 : 80;
  function touch(x, y, alpha, press = 0, ripple = -1) {
    if (alpha <= 0.001 && ripple < 0) return;
    if (touchUsed >= touchPool.length) {
      const d = el("div", "touch", touchLayer);
      d.innerHTML = `<div class="abs" style="width:${TOUCH}px;height:${TOUCH}px;border-radius:50%;background:rgba(243,240,232,0.42);box-shadow:0 0 0 4px rgba(243,240,232,0.95)"></div><div class="abs" style="width:${TOUCH}px;height:${TOUCH}px;border-radius:50%;box-shadow:0 0 0 4px rgba(243,240,232,0.9)"></div>`;
      touchPool.push(d);
    }
    const d = touchPool[touchUsed++];
    vis(d, true);
    d.style.transform = `translate(${x - TOUCH / 2}px, ${y - TOUCH / 2}px)`;
    const [dot, rip] = d.children;
    dot.style.opacity = alpha;
    dot.style.transform = `scale(${1 - 0.18 * press})`;
    vis(rip, ripple >= 0 && ripple <= 1);
    if (ripple >= 0) {
      rip.style.transform = `scale(${1 + 1.6 * outCubic(ripple)})`;
      rip.style.opacity = 1 - ripple;
    }
  }
  /** A swipe-up gesture that peaks at time ts. */
  function swipeTouch(t, ts, x, y0, y1) {
    const a = seg(t, ts - 0.13, ts - 0.07) * (1 - seg(t, ts + 0.12, ts + 0.22));
    if (a <= 0) return;
    const k = outCubic(seg(t, ts - 0.1, ts + 0.16));
    touch(x, lerp(y0, y1, k), a);
  }
  /** A tap with press and ripple around time tt. */
  function tapTouch(t, tt, x, y) {
    const a = seg(t, tt - 0.2, tt - 0.12) * (1 - seg(t, tt + 0.12, tt + 0.22));
    const press = seg(t, tt - 0.08, tt - 0.03) * (1 - seg(t, tt + 0.02, tt + 0.1));
    const rip = t >= tt - 0.03 && t <= tt + 0.35 ? seg(t, tt - 0.03, tt + 0.35) : -1;
    if (a > 0 || rip >= 0) touch(x, y, a, press, rip);
  }

  // ------------------------------------------------------------------ callouts (display type rising out of masks)
  function makeCallout(parent, cls = "") {
    const e = el("div", `callout display ${cls}`, parent || textLayer);
    e._text = null;
    return e;
  }
  function fillCallout(e, text) {
    if (e._text === text) return;
    e._text = text;
    e.innerHTML = text
      .split("|")
      .map((ln) => `<span class="ln"><span class="w">${ln.replace(/([.?])$/, '<span class="dot">$1</span>')}</span></span>`)
      .join("");
  }
  /** Lines rise in from a mask, then leave upward. Returns false when hidden. */
  function animateCallout(e, t, t0, t1, o = {}) {
    const on = t >= t0 - 0.01 && t <= t1 + 0.3;
    vis(e, on);
    if (!on) return false;
    const lines = e.querySelectorAll(".w");
    lines.forEach((w, i) => {
      const a = outExpo(seg(t, t0 + i * 0.07, t0 + i * 0.07 + 0.45));
      const b = o.hold ? 0 : inCubic(seg(t, t1 + i * 0.03, t1 + i * 0.03 + 0.2));
      const punch = o.punch ? 1 + o.punch * (1 - outCubic(seg(t, t0 + i * 0.07, t0 + i * 0.07 + 0.3))) : 1;
      w.style.transform = `translateY(${(1 - a) * 108 - b * 108}%) scale(${punch})`;
    });
    return true;
  }
  const fitCache = {};
  /** Largest font size (<= max) at which every line of `text` fits in `width`. */
  function fitSize(text, width, max) {
    const key = `${text}|${width}|${max}`;
    if (fitCache[key]) return fitCache[key];
    const p = el("div", "callout display", stage);
    fillCallout(p, text);
    p.style.fontSize = "100px";
    p.style.visibility = "hidden";
    p.style.whiteSpace = "nowrap";
    let w = 0;
    p.querySelectorAll(".w").forEach((x) => (w = Math.max(w, x.getBoundingClientRect().width)));
    p.remove();
    fitCache[key] = Math.floor(Math.min(max || 999, (100 * width) / w));
    return fitCache[key];
  }
  /** Place a callout: x = left edge (or "center"), y = top. */
  function placeText(e, size, x, y, align = "left", width = 0) {
    e.style.fontSize = `${size}px`;
    e.style.top = `${y}px`;
    e.style.textAlign = align;
    if (align === "center") {
      e.style.left = "0px";
      e.style.width = `${W}px`;
    } else {
      e.style.left = `${x}px`;
      e.style.width = width ? `${width}px` : "";
    }
  }

  // ------------------------------------------------------------------ odometer
  function odoHtml(digits, h) {
    const col = `<div class="col" style="width:0.62em;height:${h}px"><div>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => `<span style="height:${h}px;line-height:${h}px">${n}</span>`).join("")}</div></div>`;
    return col.repeat(digits);
  }
  /** Roll an odometer (built by odoHtml) to value v; columns tick over with the column to their right. */
  function setOdo(root, v, h) {
    const cols = root.querySelectorAll(".col div");
    const n = cols.length;
    cols.forEach((c, i) => {
      const p = 10 ** (n - 1 - i);
      let pos = (v / p) % 10;
      if (p > 1) {
        const low = v % p;
        const whole = Math.floor(v / p) % 10;
        pos = whole + clamp((low - (p - p / 10)) / (p / 10));
      }
      c.style.transform = `translateY(${-pos * h}px)`;
    });
  }

  // ------------------------------------------------------------------ the button mark + end card
  const MARK_DEFS = `<defs>
  <radialGradient id="m-cap" cx="0.38" cy="0.32" r="0.85"><stop offset="0" stop-color="#FF928B"/><stop offset="0.45" stop-color="#FF4A3D"/><stop offset="1" stop-color="#DB4034"/></radialGradient>
  <linearGradient id="m-housing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E2E36"/><stop offset="1" stop-color="#141418"/></linearGradient>
  <linearGradient id="m-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#942B23"/><stop offset="1" stop-color="#571915"/></linearGradient>
  <clipPath id="m-clip"><circle cx="512" cy="501" r="300"/></clipPath>
  <clipPath id="m-smooth"><rect x="192" y="175" width="640" height="366.5"/></clipPath></defs>`;
  const THUMBPRINT = `<g clip-path="url(#m-clip)" opacity="0.94"><g clip-path="url(#m-smooth)" fill="none" stroke="#0D0D10" stroke-width="46" stroke-linecap="round"><path d="M519.99 449.70 A46.00 46.00 0 1 1 482.43 530.24"/><path d="M649.47 507.03 A138.00 138.00 0 1 1 609.58 397.42"/><path d="M390.12 299.95 A230.00 230.00 0 1 1 298.75 408.84"/></g>
  <path d="M259 541h46v23h-46zM351 541h69v23h-69zM466 541h92v23h-92zM604 541h69v23h-69zM719 541h46v23h-46zM282 564h46v23h-46zM374 564h46v23h-46zM604 564h46v23h-46zM696 564h46v23h-46zM282 587h46v23h-46zM397 587h69v23h-69zM558 587h69v23h-69zM696 587h46v23h-46zM305 610h46v46h-46zM443 610h138v46h-138zM673 610h46v46h-46zM351 656h46v46h-46zM627 656h46v46h-46zM397 702h230v46h-230z" fill="#0D0D10"/></g>`;
  const MARK = `<svg viewBox="0 0 1024 1024" width="100%" height="100%" style="overflow:visible;display:block">${MARK_DEFS}
  <g class="housing"><circle cx="512" cy="512" r="344" fill="url(#m-housing)"/><circle cx="512" cy="512" r="342.5" fill="none" stroke="#3A3A44" stroke-width="3" stroke-opacity="0.9"/><circle cx="512" cy="512" r="319" fill="#08080A"/></g>
  <circle class="side" cx="512" cy="523" r="300" fill="url(#m-side)"/>
  <g class="cap"><circle cx="512" cy="501" r="300" fill="url(#m-cap)"/>
  ${BRAND.engraving || THUMBPRINT}
  <path d="M326 315 A264 264 0 0 1 572 243" fill="none" stroke="#FFEDEC" stroke-width="7" stroke-linecap="round" stroke-opacity="0.32"/></g></svg>`;

  const endBox = el("div", "layer", endLayer);
  endBox.style.background = "#000";
  const endDots = el("div", "dots", endBox);
  endDots.style.backgroundSize = `${dotGap}px ${dotGap}px`;
  const button = el("div", "abs", endBox, MARK);
  const btnCap = button.querySelector(".cap");
  const shock = el("div", "abs", endBox);
  shock.style.borderRadius = "50%";
  const word = el("div", "abs", endBox, `<img src="${BRAND.wordmark}" style="width:100%;display:block">`);
  word.style.overflow = "hidden";
  const wordImg = word.querySelector("img");
  const tagline = el("div", "abs mono", endBox);
  const freeLine = el("div", "abs mono", endBox);
  // Safe zone: 9:16 keeps everything between y 250 and 1270 (Reels/TikTok overlays). 4:5 keeps 60 px margins.
  const END = TALL
    ? { bx: 540, by: 580, bs: 560, wy: 955, ww: 780, tagY: 1075, tagSize: 38, freeY: 1160, freeSize: 32 }
    : { bx: 540, by: 500, bs: 480, wy: 840, ww: 740, tagY: 955, tagSize: 36, freeY: 1035, freeSize: 30 };
  const TAG = "SWIPE UP FOR THE NEXT GAME";
  function placeButton(cx, cy, size, press = 0) {
    button.style.width = `${size}px`;
    button.style.height = `${size}px`;
    button.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px)`;
    btnCap.setAttribute("transform", `translate(0 ${press * 17})`);
  }

  // The icon (BRAND.icon) takes the button's place and footprint (the housing's diameter). The swipe is drawn on by a
  // mask stroked along its centerline; a hairline edge keeps the ink icon readable on the black end card.
  const ICON_SIZE = 688 / 1024;
  const iconEl = ICON ? el("div", "abs", endBox, iconSvg(ICON)) : null;
  const iconReveal = iconEl?.querySelector(".reveal");
  let iconRevealLen = 0;
  if (ICON) {
    endBox.insertBefore(iconEl, shock);
    vis(button, false);
    shock.style.borderRadius = "22.37%";
  }
  function iconSvg(I) {
    const stops = I.ramp.map(([y, o]) => `<stop offset="${(1024 - y) / 1024}" stop-color="${I.color}" stop-opacity="${o}"/>`).join("");
    return `<svg viewBox="0 0 1024 1024" width="100%" height="100%" style="overflow:visible;display:block"><defs>
      <linearGradient id="i-ramp" gradientUnits="userSpaceOnUse" x1="0" y1="1024" x2="0" y2="0">${stops}</linearGradient>
      <clipPath id="i-clip"><rect width="1024" height="1024" rx="${I.radius}"/></clipPath>
      <mask id="i-reveal" maskUnits="userSpaceOnUse" x="-512" y="-512" width="2048" height="2048"><path class="reveal" d="${I.centerline}" fill="none" stroke="#fff" stroke-width="${I.reveal}" stroke-linecap="round"/></mask></defs>
      <g clip-path="url(#i-clip)"><rect width="1024" height="1024" fill="${I.bg}"/><path d="${I.swipe}" fill="url(#i-ramp)" mask="url(#i-reveal)"/></g>
      <rect x="5" y="5" width="1014" height="1014" rx="${I.radius - 5}" fill="none" stroke="#2E2E36" stroke-width="10"/></svg>`;
  }
  /** The icon centered on (cx, cy), `size` wide, with the swipe drawn to `k` (0..1). */
  function placeIcon(cx, cy, size, k) {
    iconEl.style.width = iconEl.style.height = `${size}px`;
    iconEl.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px)`;
    if (!iconRevealLen) iconRevealLen = iconReveal.getTotalLength();
    iconReveal.style.strokeDasharray = `${iconRevealLen} ${iconRevealLen + 1}`;
    iconReveal.style.strokeDashoffset = `${iconRevealLen * (1 - k)}`;
  }
  /**
   * End card starting at t0: the button pops, is pressed on the beat (t0 + 0.3), the wordmark rises,
   * the tagline types out with a heat cursor, then "Free on iPhone + Android".
   * o.wipe: 0..1 circular reveal progress override; o.free: last line text.
   */
  function endCard(t, t0, o = {}) {
    const on = t >= t0;
    vis(endBox, on);
    if (!on) return;
    const E = END;
    const r = Math.hypot(W, H);
    const wipe = outExpo(seg(t, t0, t0 + 0.4));
    endBox.style.clipPath = wipe < 1 ? `circle(${wipe * r}px at ${E.bx}px ${E.by}px)` : "";
    const pop = spring(t - t0 - 0.05, POP);
    const pt = t0 + 0.3;
    const press = outCubic(seg(t, pt - 0.06, pt + 0.02)) * (1 - 0.55 * outCubic(seg(t, pt + 0.14, pt + 0.4)));
    // With an icon, the swipe takes the press: a flick that accelerates across and lands on the beat.
    if (ICON) placeIcon(E.bx, E.by, E.bs * ICON_SIZE * lerp(0.7, 1, pop), inOutCubic(seg(t, pt - 0.16, pt)));
    else placeButton(E.bx, E.by, E.bs * lerp(0.7, 1, pop), press);
    const k = seg(t, pt, pt + 0.5);
    vis(shock, k > 0 && k < 1);
    const rr = E.bs * 0.5 * (1 + 0.9 * outCubic(k));
    shock.style.width = shock.style.height = `${rr * 2}px`;
    shock.style.transform = `translate(${E.bx - rr}px, ${E.by - rr}px)`;
    shock.style.boxShadow = `0 0 0 6px rgba(243,240,232,${0.5 * (1 - k)})`;
    const ww = E.ww * (BRAND.wordmarkWidth / 771);
    const wh = (ww * 150) / BRAND.wordmarkWidth;
    // o.fast (the 6 s cut): the lockup completes about 0.4 s sooner so it holds before the cut ends.
    const f = o.fast ? 0.6 : 1;
    const we = outExpo(seg(t, t0 + 0.35 * f, t0 + 0.35 * f + 0.5));
    word.style.width = `${ww}px`;
    word.style.transform = `translate(${(W - ww) / 2}px, ${E.wy - wh / 2}px)`;
    wordImg.style.transform = `translateY(${(1 - we) * 108}%)`;
    const ts = t0 + 0.75 * f;
    const typ = o.fast ? 0.4 : 0.5;
    const n = Math.floor(clamp((t - ts) / typ) * TAG.length);
    const blink = t > ts + typ && Math.floor(t * 3) % 2 === 1;
    tagline.innerHTML = `${TAG.slice(0, n)}<span style="display:inline-block;width:0.62em;height:0.95em;background:#FF4A3D;vertical-align:-0.1em;margin-left:0.12em;opacity:${t < ts || blink ? 0 : 1}"></span>`;
    Object.assign(tagline.style, { fontSize: `${E.tagSize}px`, color: "#F3F0E8", left: "0", width: `${W}px`, textAlign: "center", top: `${E.tagY}px` });
    const fe = outExpo(seg(t, t0 + 1.2 * f, t0 + 1.2 * f + 0.5));
    freeLine.textContent = o.free || "Free on iPhone + Android";
    Object.assign(freeLine.style, { fontSize: `${E.freeSize}px`, color: "#A7A3AE", left: "0", width: `${W}px`, textAlign: "center", top: `${E.freeY}px`, opacity: fe, transform: `translateY(${(1 - fe) * 20}px)` });
  }

  // ------------------------------------------------------------------ result card (inside a 360 x 640 logical box)
  function resultHtml(o) {
    return `<div class="result ad"><div class="topline"></div><div class="kick">Run over · ${o.name}</div>
      <div class="score odo">${odoHtml(o.digits, 64)}</div>
      <div class="stats">${o.stats.map(([k, v], i) => `<div>${k}<b class="s${i}">${v}</b></div>`).join("")}</div>
      <div class="swipehint">&uarr; Swipe up for the next one</div></div><div class="stamp">NEW BEST</div>`;
  }

  // ------------------------------------------------------------------ shake
  function shakeAt(t, hits) {
    let x = 0;
    let y = 0;
    for (const [th, amp] of hits) {
      const k = t - th;
      if (k < 0 || k > 0.4) continue;
      const e = Math.exp(-k * 14) * amp;
      x += Math.sin(k * 90) * e * 0.6;
      y += Math.cos(k * 76) * e;
    }
    return [x, y];
  }

  // ------------------------------------------------------------------ frame lifecycle
  function begin(t, hits = []) {
    cardsUsed = 0;
    touchUsed = 0;
    const [sx, sy] = shakeAt(t, hits);
    cam.style.transform = `translate(${sx}px, ${sy}px)`;
    dots.style.transform = `translate(${(t * 6) % dotGap}px, ${(-t * 18) % dotGap}px)`;
    setBleed(null);
    setColor(null);
    vis(endBox, false);
  }
  function end() {
    for (let i = cardsUsed; i < cardPool.length; i++) vis(cardPool[i].el, false);
    for (let i = touchUsed; i < touchPool.length; i++) vis(touchPool[i], false);
  }

  window.K = {
    W, H, TALL, FPS, CUT, FR, stage, Q, BRAND,
    clamp, lerp, seg, outCubic, inCubic, inOutCubic, outExpo, inExpo, inOutExpo, spring, SNAP, POP, SHEET, MORPH, UI, mulberry,
    el, vis, setHtml, setSrc, settle, frameUrl, icon, G, base,
    layers: { cam, bg, bleedLayer, colorLayer, cardLayer, scrimLayer, fxLayer, textLayer, endLayer, touchLayer },
    setBleed, setColor, card, touch, swipeTouch, tapTouch,
    makeCallout, fillCallout, animateCallout, fitSize, placeText,
    odoHtml, setOdo, resultHtml, endCard, END, MARK,
    begin, end,
  };
})();
