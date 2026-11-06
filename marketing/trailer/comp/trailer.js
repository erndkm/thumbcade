/* Thumbcade teaser compositor. Every pixel is a pure function of t (seconds), so frames can be
   rendered in any order and sub-sampled for motion blur. 120 BPM: one beat = 0.5 s. */
(() => {
  const Q = new URLSearchParams(location.search);
  const W = Number(Q.get("w")) || 1080;
  const H = Number(Q.get("h")) || 1920;
  const V = H > W;
  const FPS = 60;
  // ?cut=15 renders the 15 s spot: hook, title, feed, tap, six verbs, then an iris onto the sign-off.
  const CUT = Q.get("cut") === "15";
  const DURATION = CUT ? 15.0 : 26.5;
  const FR = window.FRAMES || {};
  // The brand on screen: Thumbcade, unless the renderer injects window.BRAND (render.mjs --brand, see marketing/swipesu).
  // engraving: the cap artwork in the 1024 mark space (null keeps the thumbprint). wordmarkWidth: the wordmark's
  // width at the 150-unit height of wordmark.svg, so other names keep the same type size.
  // dive: where the opening camera dives into the cap.
  const BRAND = { name: "thumbcade", site: "thumbcade.com", engraving: null, dive: 501, wordmark: "assets/wordmark.svg", wordmarkWidth: 771, avatar: TC.avatars.thumbcade, ...window.BRAND };
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
  const outQuart = (k) => 1 - (1 - k) ** 4;
  const outBack = (k, s = 1.7) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;

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
  const BOUNCE = { damping: 9, stiffness: 190, mass: 0.8 };

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

  // ------------------------------------------------------------------ games
  const G = {
    duskrail: { name: "Duskrail", accent: "#FF6A1A", desc: "Three lanes. Zero chill. Swipe to dodge, jump and slide.", tags: ["runner", "3d", "reflex"], n: ["48.2K", "1.2K", "9.1K", "3.3K"], plays: "1.2M", best: "531", input: "Swipe" },
    "neon-chop": { name: "Neon Chop", accent: "#FF3D6E", desc: "The Glow Market is open late. Never cut the static.", tags: ["slash", "reflex", "neon"], n: ["31.7K", "842", "6.4K", "2.1K"], plays: "880K", best: "212", input: "Drag" },
    flapjack: { name: "Flapjack", accent: "#FFB23F", desc: "A pancake with ambition. Tap to flip through the forks.", tags: ["onetap", "flyer", "arcade"], n: ["22.9K", "613", "4.0K", "1.7K"], plays: "640K", best: "36", input: "Tap" },
    snek: { name: "Snek", accent: "#4DFF88", desc: "Swipe to steer a very hungry snek. Don't eat yourself.", tags: ["snake", "retro", "arcade"], n: ["19.4K", "527", "3.2K", "988"], plays: "512K", best: "400", input: "Swipe" },
    voltbrick: { name: "Voltbrick", accent: "#4D8DFF", desc: "Split the ball, grab the beam, clear the grid.", tags: ["bricks", "retro", "arcade"], n: ["17.8K", "402", "2.9K", "870"], plays: "455K", best: "2,450", input: "Drag" },
    heatfall: { name: "Heatfall", accent: "#FFE14D", desc: "Spin the grates, drop the ember, dodge the coolant.", tags: ["3d", "arcade", "chill"], n: ["26.1K", "733", "5.2K", "1.4K"], plays: "702K", best: "38", input: "Drag" },
    kingsnare: { name: "Kingsnare", accent: "#5CF2B8", desc: "Ninety seconds of checkmates. No draws, no mercy.", tags: ["chess", "puzzle", "brain"], n: ["14.6K", "1.9K", "7.7K", "2.6K"], plays: "390K", best: "1,925", input: "Tap" },
    shortwick: { name: "Shortwick", accent: "#B48CFF", desc: "Slide, merge, keep the fuse lit.", tags: ["merge", "puzzle", "brain"], n: ["16.2K", "390", "3.8K", "760"], plays: "430K", best: "1,024", input: "Swipe" },
    pairs: { name: "Pairs", accent: "#FF6FB5", desc: "Peek, flip, match. Every pair buys you two seconds.", tags: ["matching", "brain", "chill"], n: ["12.3K", "288", "2.2K", "540"], plays: "301K", best: "740", input: "Tap" },
    mines: { name: "Mines", accent: "#7CC4FF", desc: "Sonar says 15 mines. Sonar has been wrong before.", tags: ["logic", "puzzle", "classic"], n: ["11.1K", "356", "2.7K", "610"], plays: "288K", best: "1,610", input: "Tap" },
    stackd: { name: "Stackd", accent: "#3DE0FF", desc: "Drop the slab, slice the overhang, build it tall.", tags: ["3d", "stacking", "onetap"], n: ["39.5K", "1.1K", "8.3K", "2.9K"], plays: "1.0M", best: "48", input: "Tap" },
    kneejerk: { name: "Kneejerk", accent: "#00E5C7", desc: "Four tiny tests, one thumb, three lives. Fast.", tags: ["reflex", "speed", "brain"], n: ["13.7K", "301", "1.9K", "720"], plays: "344K", best: "9,120", input: "Tap" },
  };
  G["duskrail-end"] = G.duskrail;

  // ------------------------------------------------------------------ layers
  const cam = el("div", "layer");
  const bg = el("div", "layer", cam);
  const dots = el("div", "dots", bg);
  const accentBg = el("div", "layer", cam);
  const wallpaper = el("div", "layer", cam);
  const cardLayer = el("div", "layer", cam);
  const fxLayer = el("div", "layer", cam);
  const scrimLayer = el("div", "layer", cam);
  const textLayer = el("div", "layer", cam);
  const termLayer = el("div", "layer", cam);
  const endLayer = el("div", "layer", cam);
  const titleLayer = el("div", "layer", cam);
  const openLayer = el("div", "layer", cam);
  const touchLayer = el("div", "layer", cam);
  const flash = el("div", "layer", stage);
  [bg, accentBg, wallpaper, cardLayer, fxLayer, scrimLayer, textLayer, termLayer, endLayer, titleLayer, openLayer, touchLayer].forEach((l, i) => (l.style.zIndex = i + 1));

  const dotGap = V ? 40 : 36;
  dots.style.backgroundSize = `${dotGap}px ${dotGap}px`;

  // ------------------------------------------------------------------ layout
  const L = V
    ? {
        feed: { cx: 540, cy: 1030, s: 2.06 },
        pitch: 2.06 * 640 + 420,
        callout: { x: 169, bottom: 1920 - 300, size: 96, width: 760 },
        montage: { cx: 540, cy: 960, s: 1.94 },
        wall: { cols: 3, cellH: 540, gapX: 28, gapY: 30 },
        title: { size: 0, left: 86, width: 908 },
      }
    : {
        feed: { cx: 1430, cy: 540, s: 1.43 },
        pitch: 1.43 * 640 + 44,
        callout: { x: 140, cy: 540, size: 150, width: 960 },
        montage: { cx: 960, cy: 540, s: 1.48 },
        wall: { cols: 6, cellH: 470, gapX: 24, gapY: 26 },
        title: { size: 0, left: 150, width: 1500 },
      };

  // ------------------------------------------------------------------ the feed card
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
    av.style.top = "246px";
    const mk = (name, top) => {
      const it = el("div", "item", rail, `${icon(name, 29, { filled: name === "like", color: "#F3F0E8", stroke: 2 })}<div class="count"></div>`);
      it.style.top = `${top}px`;
      return it;
    };
    const like = mk("like", 312);
    const comment = mk("comment", 370);
    const save = mk("save", 428);
    const share = mk("share", 486);
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
        `<div class="t">${icon("inbox", 22, { color: "#A7A3AE", stroke: 2 })}<span>Inbox</span><div class="badge">15</div></div>` +
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
          `<div class="meta">&#9656; ${m.plays} plays · best ${m.best} · ${m.input}</div>`;
        like.querySelector(".count").textContent = m.n[0];
        comment.querySelector(".count").textContent = m.n[1];
        save.querySelector(".count").textContent = m.n[2];
        share.querySelector(".count").textContent = m.n[3];
        setSrc(cartImg, `assets/icons/${g.replace("-end", "")}.png`);
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
    c.extra.innerHTML = "";
    // Pooled cards are reused across scenes: clear anything a one-off effect may have set.
    c.shot.style.opacity = "";
    c.el.style.background = "";
    c.el.style.overflow = "";
    return c;
  }

  // ------------------------------------------------------------------ touches
  const touchPool = [];
  let touchUsed = 0;
  const TOUCH = V ? 92 : 64;
  function touch(x, y, alpha, press = 0, ripple = -1) {
    if (alpha <= 0.001 && ripple < 0) return;
    if (touchUsed >= touchPool.length) {
      const d = el("div", "touch", touchLayer);
      d.innerHTML = `<div class="abs" style="width:${TOUCH}px;height:${TOUCH}px;border-radius:50%;background:rgba(243,240,232,0.42);box-shadow:0 0 0 ${V ? 4 : 3}px rgba(243,240,232,0.95)"></div><div class="abs" style="width:${TOUCH}px;height:${TOUCH}px;border-radius:50%;box-shadow:0 0 0 ${V ? 4 : 3}px rgba(243,240,232,0.9)"></div>`;
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

  // ------------------------------------------------------------------ callouts
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
      .map((ln) => `<span class="ln"><span class="w">${ln.replace(/\.$/, '<span class="dot">.</span>')}</span></span>`)
      .join("");
  }
  /** Lines rise in from a mask, then leave upward. */
  function animateCallout(e, t, t0, t1) {
    const on = t >= t0 - 0.01 && t <= t1 + 0.3;
    vis(e, on);
    if (!on) return;
    const lines = e.querySelectorAll(".w");
    lines.forEach((w, i) => {
      const a = outExpo(seg(t, t0 + i * 0.07, t0 + i * 0.07 + 0.45));
      const b = inCubic(seg(t, t1 + i * 0.03, t1 + i * 0.03 + 0.2));
      w.style.transform = `translateY(${(1 - a) * 108 - b * 108}%)`;
    });
  }
  const callA = makeCallout();
  const callB = makeCallout();
  function placeCallout(e, size) {
    const c = L.callout;
    e.style.fontSize = `${size || c.size}px`;
    if (V) {
      e.style.left = `${c.x}px`;
      e.style.top = "";
      e.style.bottom = `${c.bottom}px`;
      e.style.transform = "";
    } else {
      e.style.left = `${c.x}px`;
      e.style.top = `${c.cy}px`;
      e.style.bottom = "";
      e.style.transform = "translateY(-50%)";
    }
  }
  const CALLS = [
    { text: "No installs.", t0: 3.02, t1: 3.84 },
    { text: "No menus.", t0: 4.02, t1: 4.84 },
    { text: "No loading|bars.", t0: 5.02, t1: 5.84 },
    { text: "Just swipe.", t0: 6.02, t1: 7.84 },
    { text: "Tap to play.", t0: 8.02, t1: 8.7 },
    { text: "Five seconds.|Or five minutes.", t0: 8.95, t1: 9.84 },
    { text: "Beat your|best.", t0: 16.95, t1: 17.92 },
    { text: "Then dare|your friends.", t0: 18.18, t1: 19.86 },
    { text: "Anyone can|ship a game.", t0: 20.12, t1: 21.72, hw: 760 },
  ];
  const CALLS_15 = [
    { text: "No installs.", t0: 3.02, t1: 3.78 },
    { text: "Just swipe.", t0: 4.02, t1: 5.84 },
    { text: "Tap to play.", t0: 6.02, t1: 6.7 },
    { text: "Five seconds.|Or five minutes.", t0: 6.95, t1: 7.84 },
  ];

  // ------------------------------------------------------------------ opening / end button
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

  const button = el("div", "abs", openLayer, MARK);
  const btnCap = button.querySelector(".cap");
  const btnHousing = button.querySelector(".housing");
  const btnSide = button.querySelector(".side");
  const pressLabel = el("div", "abs mono", openLayer, "Press start");
  const shock = el("div", "abs", openLayer);
  shock.style.borderRadius = "50%";
  const heatCover = el("div", "layer", openLayer);
  heatCover.style.background = "#FF4A3D";
  const BTN = V ? 860 : 720;

  function placeButton(cx, cy, size, zoom = 1, press = 0, originY = 512) {
    button.style.width = `${size}px`;
    button.style.height = `${size}px`;
    const ox = size / 2;
    const oy = (originY / 1024) * size;
    button.style.transformOrigin = `${ox}px ${oy}px`;
    button.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px) scale(${zoom})`;
    btnCap.setAttribute("transform", `translate(0 ${press * 17})`);
  }

  // ------------------------------------------------------------------ the icon (BRAND.icon)
  // Takes the button's place and footprint (the housing's diameter). The swipe is drawn on by a mask stroked along its
  // centerline; a hairline edge keeps the ink icon readable on the ink stage.
  const ICON_SIZE = 688 / 1024;
  const iconEl = ICON ? el("div", "abs", openLayer, iconSvg(ICON)) : null;
  const iconReveal = iconEl?.querySelector(".reveal");
  let iconRevealLen = 0;
  if (ICON) {
    vis(button, false);
    pressLabel.textContent = "Swipe to start";
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
  /** The icon centered on (cx, cy), `size` wide, zoomed around `origin` in its 1024 box; the swipe drawn to `k` (0..1). */
  function placeIcon(cx, cy, size, k, zoom = 1, origin = [512, 512]) {
    vis(iconEl, true);
    iconEl.style.width = iconEl.style.height = `${size}px`;
    iconEl.style.transformOrigin = `${(origin[0] / 1024) * size}px ${(origin[1] / 1024) * size}px`;
    iconEl.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px) scale(${zoom})`;
    if (!iconRevealLen) iconRevealLen = iconReveal.getTotalLength();
    iconReveal.style.strokeDasharray = `${iconRevealLen} ${iconRevealLen + 1}`;
    iconReveal.style.strokeDashoffset = `${iconRevealLen * (1 - k)}`;
  }
  /** Arc length along the swipe's centerline where it reaches height y of the 1024 box (it rises monotonically). */
  function iconLenAtY(y) {
    let lo = 0, hi = iconRevealLen;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (iconReveal.getPointAtLength(mid).y > y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ------------------------------------------------------------------ title card
  // A justified poster stack: every line is sized to the same measure.
  const title = el("div", "layer", titleLayer);
  title.style.background = "#FF4A3D";
  const titleBox = el("div", "abs display", title);
  titleBox.style.color = "#0D0D10";
  const TITLE = V
    ? { lines: ["The", "feed", "is now", "playable."], at: [1.0, 1.25, 1.5, 2.0], width: 940 }
    : { lines: ["The feed", "is now", "playable."], at: [1.0, 1.5, 2.0], width: 1480, widths: [930, 930, 1480] };
  const titleLines = TITLE.lines.map((s, i) => {
    const ln = el("div", "", titleBox);
    // Masked at the bottom only (the lines rise in from there), so the punch and the pixel blocks can overhang.
    ln.style.clipPath = "inset(-50% -20% 0 -20%)";
    const inner = el("div", "", ln, i === TITLE.lines.length - 1 ? "" : s);
    inner.style.whiteSpace = "nowrap";
    inner.style.transformOrigin = "0% 100%";
    return { ln, inner, s };
  });
  const pixCanvas = el("canvas", "", titleLines[titleLines.length - 1].inner);
  pixCanvas.style.display = "block";
  let pixW = 0;
  let pixH = 0;
  let pixSize = 100;
  let pixInk = null;
  const PIX_PAD = 48;
  const pixSrc = document.createElement("canvas");
  const pixTmp = document.createElement("canvas");
  function measure(text, size) {
    const probe = el("span", "display", stage, text);
    probe.style.fontSize = `${size}px`;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    const r = probe.getBoundingClientRect().width;
    probe.remove();
    return r;
  }
  function initTitle() {
    let total = 0;
    const sizes = titleLines.map(({ s }, i) => Math.floor(((TITLE.widths?.[i] ?? TITLE.width) / measure(s, 100)) * 100));
    if (TITLE.widths) sizes[1] = sizes[0] = Math.min(sizes[0], sizes[1]);
    titleLines.forEach(({ ln }, i) => {
      ln.style.fontSize = `${sizes[i]}px`;
      // em tracking resolves where it is declared: restate it at the line's size, as measure() saw it.
      ln.style.letterSpacing = "-0.02em";
      ln.style.height = `${sizes[i] * 0.86}px`;
      ln.style.lineHeight = `${sizes[i] * 0.86}px`;
      ln.style.marginBottom = `${sizes[i] * 0.05}px`;
      total += sizes[i] * 0.91;
    });
    titleBox.style.width = `${TITLE.width}px`;
    titleBox.style.left = `${(W - TITLE.width) / 2}px`;
    titleBox.style.top = `${(H - total) / 2}px`;
    pixSize = sizes[sizes.length - 1];
    pixW = Math.ceil(measure("PLAYABLE.", pixSize)) + 6;
    pixH = Math.ceil(pixSize * 0.86);
    // Padded so blocks can overhang the letters; the negative margin keeps the text where the line expects it.
    for (const cv of [pixCanvas, pixSrc]) {
      cv.width = pixW + 2 * PIX_PAD;
      cv.height = pixH + 2 * PIX_PAD;
    }
    pixCanvas.style.width = `${pixW + 2 * PIX_PAD}px`;
    pixCanvas.style.height = `${pixH + 2 * PIX_PAD}px`;
    pixCanvas.style.margin = `${-PIX_PAD}px`;
    pixCanvas.parentElement.style.display = "flow-root"; // keep the negative margins from collapsing into the line
    const x = pixSrc.getContext("2d");
    x.fillStyle = "#0D0D10";
    x.font = `900 ${pixSize}px "Mona Sans"`;
    x.fontStretch = "expanded";
    x.letterSpacing = `${-0.02 * pixSize}px`;
    x.textBaseline = "alphabetic";
    x.fillText("PLAYABLE.", PIX_PAD, PIX_PAD + pixSize * 0.8);
    // Ink bounds, so the pixel grid can sit on the letters instead of the canvas corner.
    const d = x.getImageData(0, 0, pixSrc.width, pixSrc.height).data;
    const ink = { x0: Infinity, y0: Infinity, x1: 0, y1: 0 };
    for (let yy = 0; yy < pixSrc.height; yy++)
      for (let xx = 0; xx < pixSrc.width; xx++)
        if (d[(yy * pixSrc.width + xx) * 4 + 3] > 8) {
          ink.x0 = Math.min(ink.x0, xx);
          ink.x1 = Math.max(ink.x1, xx + 1);
          ink.y0 = Math.min(ink.y0, yy);
          ink.y1 = Math.max(ink.y1, yy + 1);
        }
    pixInk = ink;
    lastBlock = -1;
  }
  let lastBlock = -1;
  function drawPixelated(block) {
    if (block === lastBlock) return;
    lastBlock = block;
    const ctx = pixCanvas.getContext("2d");
    ctx.clearRect(0, 0, pixCanvas.width, pixCanvas.height);
    if (block <= 1) {
      ctx.drawImage(pixSrc, 0, 0);
      return;
    }
    // The grid hangs from the baseline and is centred on the ink, so no row of blocks drops below the line's mask.
    const { x0, x1, y0, y1 } = pixInk;
    const w = Math.ceil((x1 - x0) / block);
    const h = Math.ceil((y1 - y0) / block);
    const gx = Math.round(x0 - (w * block - (x1 - x0)) / 2);
    const gy = y1 - h * block;
    pixTmp.width = w;
    pixTmp.height = h;
    const t = pixTmp.getContext("2d");
    t.imageSmoothingEnabled = true;
    t.clearRect(0, 0, w, h);
    t.drawImage(pixSrc, gx, gy, w * block, h * block, 0, 0, w, h);
    // Hard threshold so the blocks read as pixels, not blur.
    const img = t.getImageData(0, 0, w, h);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 70 ? 255 : 0;
    t.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixTmp, 0, 0, w, h, gx, gy, w * block, h * block);
  }

  // ------------------------------------------------------------------ montage
  const MONT = [
    { g: "stackd", verb: "Stack", t: 10.0 },
    { g: "duskrail", verb: "Dodge", t: 10.5, c0: 8.55, tr: "dodge" },
    { g: "neon-chop", verb: "Slice", t: 11.0, c0: 7.1, tr: "slice" },
    { g: "flapjack", verb: "Flip", t: 11.5, c0: 6.2, tr: "flip" },
    { g: "shortwick", verb: "Merge", t: 12.0, c0: 8.35, tr: "merge" },
    { g: "voltbrick", verb: "Break", t: 12.5, c0: 8.4, tr: "break" },
    { g: "heatfall", verb: "Drop", t: 13.0, c0: 9.1, tr: "drop" },
    { g: "kingsnare", verb: "Checkmate", t: 13.5, c0: 6.3, tr: "scan" },
  ];
  // The tap at 8.5 s starts Stackd's captured run (clip 3.0 s); the run plays at 1.5x so it builds faster.
  const STACKD_CLIP = (t) => (t < 8.5 ? t - 5.5 : 3.0 + (t - 8.5) * 1.5);
  const montClip = (m, t) => (m.g === "stackd" ? STACKD_CLIP(t) : m.c0 + (t - m.t));

  const WP_SIZE = V ? 168 : 196;
  const WP_ROW = WP_SIZE * 0.9;
  const wpRows = [];
  for (let i = 0; i < Math.ceil(H / WP_ROW) + 2; i++) {
    const r = el("div", "wall-row display", wallpaper);
    r.style.fontSize = `${WP_SIZE}px`;
    r.style.top = `${(i - 0.5) * WP_ROW + (H % WP_ROW) / 2 - WP_ROW * 0.12}px`;
    wpRows.push(r);
  }
  const wpWidths = {};
  function verbWidth(v) {
    if (wpWidths[v]) return wpWidths[v];
    const p = el("span", "display", stage, `${v}&nbsp;`);
    p.style.fontSize = `${WP_SIZE}px`;
    p.style.position = "absolute";
    p.style.visibility = "hidden";
    p.style.whiteSpace = "nowrap";
    wpWidths[v] = p.getBoundingClientRect().width;
    p.remove();
    return wpWidths[v];
  }
  const montLabel = el("div", "abs mono", textLayer);
  montLabel.style.color = "#0D0D10";
  montLabel.style.fontSize = V ? "30px" : "24px";

  // Shatter tiles for BREAK.
  const shatter = el("div", "abs", fxLayer);
  shatter.style.width = "360px";
  shatter.style.height = "640px";
  shatter.style.transformOrigin = "180px 320px";
  const TILE_C = 6;
  const TILE_R = 10;
  const tiles = [];
  {
    const r = mulberry(42);
    for (let y = 0; y < TILE_R; y++)
      for (let x = 0; x < TILE_C; x++) {
        const d = el("div", "abs", shatter);
        d.style.width = `${360 / TILE_C + 0.6}px`;
        d.style.height = `${640 / TILE_R + 0.6}px`;
        d.style.overflow = "hidden";
        const img = el("img", "abs", d);
        img.style.width = "360px";
        img.style.height = "640px";
        img.style.left = `${(-x * 360) / TILE_C}px`;
        img.style.top = `${(-y * 640) / TILE_R}px`;
        const cx = (x + 0.5) * (360 / TILE_C);
        const cy = (y + 0.5) * (640 / TILE_R);
        const dx = cx - 180;
        const dy = cy - 140;
        const dist = Math.hypot(dx, dy);
        tiles.push({ d, img, x, y, vx: (dx / (dist + 1)) * (140 + r() * 260), vy: (dy / (dist + 1)) * 160 - 120 - r() * 220, vr: (r() - 0.5) * 900, delay: dist / 2600 + r() * 0.04 });
      }
  }

  // ------------------------------------------------------------------ result + challenge (inside the card's extra layer)
  function resultHtml() {
    const col = (d) => `<div class="col"><div>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => `<span>${n}</span>`).join("")}</div></div>`;
    return `<div class="result"><div class="topline"></div><div class="kick">Run over · Duskrail</div>
      <div class="score">${col()}${col()}${col()}</div>
      <div class="stats"><div>Best<b class="bestv">412</b></div><div>Today<b>Top 4%</b></div><div>Rank<b>#12</b></div></div>
      <div class="btn primary">${icon("replay", 18, { color: "#0D0D10", stroke: 2.4 })}Play again</div>
      <div class="btn ghost">${icon("bolt", 18, { color: "#F3F0E8", stroke: 2 })}Challenge a friend</div>
      <div class="swipehint">&uarr; Swipe up for the next one</div></div><div class="stamp">NEW BEST</div>`;
  }
  function sheetHtml() {
    return `<div class="sheet"><div class="grab"></div><div class="head">Challenge · Duskrail</div>
      <div class="bubble out"><div class="linkcard"><img src="assets/icons/duskrail.png"><div><b>Duskrail</b><i>${BRAND.site}/c/7KQ2</i></div></div>531. your move.</div>
      <div class="mini-av">${TC.avatars.mira}</div>
      <div class="bubble in typing">&bull; &bull; &bull;</div>
      <div class="bubble in reply">give me five minutes.</div>
      <div class="tapback">${icon("like", 18, { filled: true, color: "#FF4A3D" })}</div></div>`;
  }

  // Deterministic like-burst particles (heat + game accent, with tiny pixel hearts).
  const burstCanvas = el("canvas", "abs", fxLayer);
  burstCanvas.width = W;
  burstCanvas.height = H;
  const PIXEL_HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
  const burstParts = (() => {
    const r = mulberry(7);
    const list = [];
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2;
      const sp = 260 + r() * 620;
      list.push({ a, sp, life: 0.55 + r() * 0.5, size: 5 + r() * 9, heart: i % 4 === 0, col: i % 3 === 0 ? "#FF6A1A" : i % 5 === 0 ? "#F3F0E8" : "#FF4A3D", spin: (r() - 0.5) * 8 });
    }
    return list;
  })();
  function drawBurst(t, tb, x, y, scale) {
    const ctx = burstCanvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const tau = t - tb;
    if (tau < 0 || tau > 1.2) {
      vis(burstCanvas, false);
      return;
    }
    vis(burstCanvas, true);
    // Ring
    const rk = outCubic(clamp(tau / 0.4));
    ctx.strokeStyle = `rgba(255,74,61,${1 - rk})`;
    ctx.lineWidth = 6 * scale * (1 - rk) + 1;
    ctx.beginPath();
    ctx.arc(x, y, 16 * scale + 70 * scale * rk, 0, Math.PI * 2);
    ctx.stroke();
    for (const p of burstParts) {
      const k = tau / p.life;
      if (k >= 1) continue;
      const drag = (1 - Math.exp(-3.2 * tau)) / 3.2;
      const px = x + Math.cos(p.a) * p.sp * drag * scale * 0.5;
      const py = y + Math.sin(p.a) * p.sp * drag * scale * 0.5 + 260 * scale * 0.5 * tau * tau;
      const s = p.size * scale * 0.5 * (1 - k * 0.6);
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = p.col;
      if (p.heart) {
        const u = Math.max(1, Math.round(s / 3));
        PIXEL_HEART.forEach((row, ry) => [...row].forEach((v, rx) => v === "1" && ctx.fillRect(Math.round(px + (rx - 3.5) * u), Math.round(py + (ry - 3) * u), u, u)));
      } else {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.spin * tau);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ terminal
  const term = el("div", "term", termLayer, `<div class="tbar">~/my-game</div><div class="body"></div>`);
  const termBody = term.querySelector(".body");
  const TERM = V ? { x: 60, w: 960, cy: 860, size: 45 } : { x: 1000, w: 800, cy: 540, size: 29 };
  term.style.left = `${TERM.x}px`;
  term.style.width = `${TERM.w}px`;
  term.style.fontSize = `${TERM.size}px`;
  const TL = [
    { at: 20.12, type: 0.42, p: "$ ", text: `npm create ${BRAND.name}-game` },
    { at: 20.62, out: '<span class="ok">&#10003;</span> created <span class="dim">my-game/</span>' },
    { at: 20.78, type: 0.3, p: "$ ", text: `${BRAND.name} publish` },
    { at: 21.12, bar: [21.12, 21.42] },
    { at: 21.48, out: '<span class="ok">&#10003;</span> review passed' },
    { at: 21.66, out: '<span class="live" style="color:#FF4A3D">&#9679;</span> LIVE IN THE FEED' },
  ];
  function termHtml(t) {
    let html = "";
    let cursorPlaced = false;
    for (const l of TL) {
      if (t < l.at) break;
      if (l.type != null) {
        const n = Math.floor(clamp((t - l.at) / l.type) * l.text.length);
        const done = n >= l.text.length;
        html += `<span class="p">${l.p}</span>${l.text.slice(0, n)}`;
        const next = TL[TL.indexOf(l) + 1];
        if (!next || t < next.at) {
          html += `<span class="cursor" style="opacity:${done && Math.floor(t * 4) % 2 ? 0 : 1}"></span>`;
          cursorPlaced = true;
        }
        html += "\n";
      } else if (l.bar) {
        const k = clamp((t - l.bar[0]) / (l.bar[1] - l.bar[0]));
        const cells = 14;
        const on = Math.round(k * cells);
        html += `<span class="dim">&#9650; uploading </span>${"&#9608;".repeat(on)}<span style="color:#34343D">${"&#9608;".repeat(cells - on)}</span> ${String(Math.round(k * 100)).padStart(3, " ")}%\n`;
      } else html += `${l.out}\n`;
    }
    if (!cursorPlaced && t >= 20.12) html += `<span class="p">$ </span><span class="cursor" style="opacity:${Math.floor(t * 4) % 2 ? 0 : 1}"></span>`;
    return html;
  }

  // ------------------------------------------------------------------ end card
  const endBox = el("div", "layer", endLayer);
  const word = el("div", "abs", endBox, `<img src="${BRAND.wordmark}" style="width:100%;display:block">`);
  word.style.overflow = "hidden";
  const wordImg = word.querySelector("img");
  const tagline = el("div", "abs mono", endBox);
  const cta = el("div", "abs mono", endBox);
  const site = el("div", "abs", endBox);
  site.style.fontWeight = "700";
  site.style.fontStretch = "125%";
  const morphDot = el("div", "abs", endLayer);
  morphDot.style.borderRadius = "50%";
  morphDot.style.background = "#FF4A3D";
  const irisRing = el("div", "abs", endLayer);
  irisRing.style.borderRadius = "50%";
  const endRing = el("div", "abs", endLayer);
  endRing.style.borderRadius = "50%";
  const END = V
    ? { bx: 540, by: 690, bs: 600, wx: 540, wy: 1085, ww: 800, tagY: 1220, tagSize: 34, ctaY: 1430, ctaSize: 26, siteY: 1478, siteSize: 36 }
    : { bx: 500, by: 470, bs: 530, wx: 1165, wy: 455, ww: 900, tagY: 610, tagSize: 33, ctaY: 912, ctaSize: 22, siteY: 950, siteSize: 30 };
  // A narrower wordmark keeps its type size; in 16:9 the button moves in by half the difference so the lockup stays centered.
  if (!V) END.bx += (END.ww * (1 - BRAND.wordmarkWidth / 771)) / 2;
  const TAG = "SWIPE UP FOR THE NEXT GAME";

  // ------------------------------------------------------------------ wall
  // Hand-arranged so neighbours never repeat; Kingsnare sits at the centre, Duskrail is the dive target.
  const WALL = V
    ? [
        ["mines", "voltbrick", "flapjack", "neon-chop", "pairs", "shortwick", "snek"],
        ["heatfall", "stackd", "duskrail", "kingsnare", "kneejerk", "voltbrick", "flapjack"],
        ["shortwick", "pairs", "kneejerk", "mines", "stackd", "heatfall", "neon-chop"],
      ]
    : [
        ["pairs", "snek", "voltbrick", "heatfall", "mines"],
        ["shortwick", "flapjack", "neon-chop", "stackd", "kneejerk"],
        ["mines", "heatfall", "kingsnare", "voltbrick", "snek"],
        ["kneejerk", "duskrail", "stackd", "flapjack", "pairs"],
        ["neon-chop", "pairs", "snek", "shortwick", "heatfall"],
        ["voltbrick", "kneejerk", "flapjack", "mines", "neon-chop"],
      ];
  const wallScrim = el("div", "layer", scrimLayer);
  wallScrim.style.background = "#000";
  const wallText = makeCallout(textLayer);
  fillCallout(wallText, "A new game|every swipe.");
  wallText.style.textAlign = "center";

  // ------------------------------------------------------------------ helpers
  const cardH = (s) => 640 * s;
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
  const HITS = [
    [0.5, 14],
    [1.0, 10],
    [1.25, 6],
    [1.5, 10],
    [2.0, 16],
    [8.5, 8],
    [10.0, 12],
    [16.23, 14],
    [17.5, 10],
    [22.5, 12],
  ];
  const HITS_15 = [
    [0.5, 14],
    [1.0, 10],
    [1.25, 6],
    [1.5, 10],
    [2.0, 16],
    [6.5, 8],
    [8.0, 12],
    [11.5, 12],
  ];

  // Feed sequence. The 15 s cut runs the feed and the montage 2 s ahead of its own clock (scene time =
  // t + 2), so it goes straight from Duskrail ("No installs.") to Snek and the flicks.
  const TITLE_OUT = 2.62;
  const FEED = CUT
    ? ["duskrail", "snek", "voltbrick", "heatfall", "kingsnare", "shortwick", "pairs", "mines", "stackd"]
    : ["duskrail", "neon-chop", "flapjack", "snek", "voltbrick", "heatfall", "kingsnare", "shortwick", "pairs", "mines", "stackd"];
  const SW = CUT ? [TITLE_OUT + 2, 5.88, 6.38, 6.63, 6.88, 7.13, 7.38, 7.63, 7.88] : [TITLE_OUT, 3.88, 4.88, 5.88, 6.38, 6.63, 6.88, 7.13, 7.38, 7.63, 7.88];
  const SHIFT = CUT ? 2.0 : 0;
  const END_SHIFT = 11.0;
  const feedPos = (t) => SW.reduce((a, ts) => a + spring(t - ts, SNAP), 0);
  const feedClip = (g, i, t) => (g === "stackd" ? STACKD_CLIP(t) : t - (SW[i] + 0.12) + 1.25);

  // ------------------------------------------------------------------ RENDER
  function render(t) {
    cardsUsed = 0;
    touchUsed = 0;
    const [sx, sy] = shakeAt(t, CUT ? HITS_15 : HITS);
    cam.style.transform = `translate(${sx}px, ${sy}px)`;

    // Background: ink with a drifting dot grid that follows the feed.
    const fp = feedPos(t + SHIFT);
    dots.style.transform = `translate(${(t * 6) % dotGap}px, ${(-(fp * L.pitch * 0.18) - t * 10) % dotGap}px)`;
    vis(accentBg, false);
    for (const r of wpRows) vis(r, false);
    vis(montLabel, false);
    vis(shatter, false);
    vis(burstCanvas, false);
    vis(wallScrim, false);
    vis(wallText, false);
    vis(term, false);
    vis(endBox, false);
    vis(morphDot, false);
    vis(endRing, false);
    vis(irisRing, false);
    flash.style.background = "transparent";

    sceneOpen(t);
    sceneTitle(t);
    if (CUT) {
      const ts = t + SHIFT;
      if (ts >= 4.5 && ts < 10.05) sceneFeed(ts, fp);
      if (ts >= 9.98 && t < IRIS[1] - 0.08) sceneMontage(ts);
      if (t + END_SHIFT >= 21.8) sceneEnd(t + END_SHIFT);
      sceneIris(t);
    } else {
      if (t >= 2.5 && t < 10.05) sceneFeed(t, fp);
      if (t >= 9.98 && t < 14.02) sceneMontage(t);
      if (t >= 14.0 && t < 16.05) sceneWall(t);
      if (t >= 15.98 && t < 20.3) sceneResult(t);
      if (t >= 19.9 && t < 22.4) sceneCreators(t);
      if (t >= 21.8) sceneEnd(t);
    }

    // Callouts
    let used = 0;
    for (const c of CUT ? CALLS_15 : CALLS) {
      if (t < c.t0 - 0.01 || t > c.t1 + 0.3) continue;
      const e = used++ === 0 ? callA : callB;
      fillCallout(e, c.text);
      placeCallout(e, fitSize(c.text, V ? null : c.hw));
      animateCallout(e, t, c.t0, c.t1);
    }
    if (used < 2) vis(callB, false);
    if (used < 1) vis(callA, false);

    for (let i = cardsUsed; i < cardPool.length; i++) vis(cardPool[i].el, false);
    for (let i = touchUsed; i < touchPool.length; i++) vis(touchPool[i], false);
  }

  const fitCache = {};
  function fitSize(text, maxW) {
    const key = `${text}|${maxW}`;
    if (fitCache[key]) return fitCache[key];
    const p = el("div", "callout display", stage);
    fillCallout(p, text);
    p.style.fontSize = `${L.callout.size}px`;
    p.style.visibility = "hidden";
    p.style.whiteSpace = "nowrap";
    let w = 0;
    p.querySelectorAll(".w").forEach((x) => (w = Math.max(w, x.getBoundingClientRect().width)));
    p.remove();
    fitCache[key] = Math.floor(L.callout.size * Math.min(1, (maxW || L.callout.width) / w));
    return fitCache[key];
  }

  // ---- 0.0 - 1.0: the button
  function sceneOpen(t) {
    const on = t < 1.02;
    vis(openLayer, on);
    if (!on) return;
    if (ICON) return iconOpen(t);
    const pop = spring(t + 0.06, POP);
    const scale = lerp(0.55, 1, pop);
    const press = outCubic(seg(t, 0.42, 0.5));
    const zoom = 1 + inExpo(seg(t, 0.56, 1.0)) * 110;
    vis(button, true);
    // The dive starts at 0.56; before that the origin is only the pivot of the pop's rotation, so it stays on the cap center.
    placeButton(W / 2, H / 2, BTN * scale, zoom, press, (t < 0.56 ? 501 : BRAND.dive) + press * 17);
    button.style.rotate = `${lerp(-14, 0, pop)}deg`;
    pressLabel.style.fontSize = V ? "36px" : "28px";
    pressLabel.style.color = "#F3F0E8";
    pressLabel.style.left = "0";
    pressLabel.style.width = `${W}px`;
    pressLabel.style.textAlign = "center";
    pressLabel.style.top = `${H / 2 + BTN * 0.34 * scale + (V ? 90 : 56)}px`;
    pressLabel.style.opacity = (Math.floor(t * 8) % 2 ? 0.35 : 1) * (1 - seg(t, 0.44, 0.5)) * seg(t, 0.0, 0.08);
    // Shockwave ring at the press.
    const k = seg(t, 0.5, 0.9);
    vis(shock, k > 0 && k < 1);
    const r = BTN * 0.52 * (1 + 1.6 * outCubic(k));
    shock.style.width = shock.style.height = `${r * 2}px`;
    shock.style.transform = `translate(${W / 2 - r}px, ${H / 2 - r}px)`;
    shock.style.boxShadow = `0 0 0 ${V ? 10 : 8}px rgba(255,74,61,${1 - k})`;
    heatCover.style.opacity = seg(t, 0.86, 0.98);
  }

  // ---- 0.0 - 1.0 with BRAND.icon: the icon pops in, its swipe draws across it where the button would be pressed,
  // and the camera dives into the swipe where it is solid red.
  function iconOpen(t) {
    const pop = spring(t + 0.06, POP);
    const scale = lerp(0.55, 1, pop);
    const zoom = 1 + inExpo(seg(t, 0.56, 1.0)) * 110;
    // A flick: it accelerates off the bottom edge and lands on the beat where the button would be pressed.
    placeIcon(W / 2, H / 2, BTN * ICON_SIZE * scale, inOutCubic(seg(t, 0.34, 0.5)), zoom, t < 0.56 ? [512, 512] : ICON.dive);
    iconEl.style.opacity = 1;
    iconEl.style.rotate = `${lerp(-14, 0, pop)}deg`;
    pressLabel.style.fontSize = V ? "36px" : "28px";
    pressLabel.style.color = "#F3F0E8";
    pressLabel.style.left = "0";
    pressLabel.style.width = `${W}px`;
    pressLabel.style.textAlign = "center";
    pressLabel.style.top = `${H / 2 + BTN * 0.34 * scale + (V ? 90 : 56)}px`;
    pressLabel.style.opacity = (Math.floor(t * 8) % 2 ? 0.35 : 1) * (1 - seg(t, 0.34, 0.4)) * seg(t, 0.0, 0.08);
    // The button's shockwave, squared off like the icon.
    const k = seg(t, 0.5, 0.9);
    vis(shock, k > 0 && k < 1);
    const r = BTN * 0.52 * (1 + 1.6 * outCubic(k));
    shock.style.width = shock.style.height = `${r * 2}px`;
    shock.style.transform = `translate(${W / 2 - r}px, ${H / 2 - r}px)`;
    shock.style.boxShadow = `0 0 0 ${V ? 10 : 8}px rgba(255,74,61,${1 - k})`;
    heatCover.style.opacity = seg(t, 0.86, 0.98);
  }

  // ---- 1.0 - 3.0: THE FEED IS NOW PLAYABLE.
  function sceneTitle(t) {
    const on = t >= 0.98 && t < 3.25;
    vis(titleLayer, on);
    if (!on) return;
    const out = spring(t - TITLE_OUT, SNAP);
    title.style.transform = `translateY(${-out * H * 1.02}px)`;
    titleLines.forEach(({ inner }, i) => {
      const ti = TITLE.at[i];
      const a = outExpo(seg(t, ti - 0.02, ti + 0.28));
      const punch = 1 + 0.07 * (1 - outCubic(seg(t, ti, ti + 0.25)));
      inner.style.transform = `translateY(${(1 - a) * 105}%) scale(${punch})`;
    });
    // PLAYABLE resolves out of pixels.
    const k = seg(t, 2.0, 2.32);
    const blocks = [40, 26, 16, 10, 5, 1];
    pixCanvas.style.opacity = t >= 1.99 ? 1 : 0;
    drawPixelated(blocks[Math.min(blocks.length - 1, Math.floor(k * blocks.length))]);
    // A swipe that pulls the title up into the feed.
    swipeTouch(t, TITLE_OUT + 0.05, W * 0.62, H * 0.82, H * 0.36);
  }

  // ---- 2.5 - 10.0: the feed
  function sceneFeed(t, fp) {
    const F = L.feed;
    // After the tap, the Stackd card glides to the montage spot.
    const toMont = inOutCubic(seg(t, 9.55, 10.0));
    for (let i = 0; i < FEED.length; i++) {
      const rel = i + 1 - fp;
      if (rel < -1.3 || rel > 1.3) continue;
      const g = FEED[i];
      const c = card();
      let cx = F.cx;
      let cy = F.cy + rel * L.pitch;
      let s = F.s;
      let feed = 1;
      let dock = 0;
      let scan = -1;
      if (g === "stackd") {
        feed = 1 - outCubic(seg(t, 8.5, 8.72));
        dock = spring(t - 8.5, MORPH);
        scan = seg(t, 8.52, 8.88);
        if (scan <= 0 || scan >= 1) scan = -1;
        const push = 1 + 0.035 * inOutCubic(seg(t, 8.6, 9.6));
        s *= push;
        cx = lerp(cx, L.montage.cx, toMont);
        cy = lerp(cy, L.montage.cy, toMont);
        s = lerp(s, L.montage.s, toMont);
      }
      c.set({ game: g, clip: feedClip(g, i, t), feed, dock, scan, t, bar: g === "stackd" ? 1 - toMont : true });
      c.place(cx, cy, s);
      if (Math.abs(rel) < 0.02 && i > 0) c.el.style.zIndex = 2;
    }
    // Gestures
    const tx = V ? L.feed.cx + 120 : L.feed.cx + 70;
    const ch = cardH(L.feed.s);
    for (let i = 1; i < SW.length; i++) swipeTouch(t, SW[i] + 0.05, tx, L.feed.cy + ch * 0.3, L.feed.cy - ch * 0.12);
    // The tap on Stackd.
    const tapA = seg(t, 8.3, 8.38) * (1 - seg(t, 8.62, 8.72));
    const press = seg(t, 8.42, 8.47) * (1 - seg(t, 8.52, 8.6));
    const rip = t >= 8.47 && t <= 8.85 ? seg(t, 8.47, 8.85) : -1;
    if (tapA > 0 || rip >= 0) touch(L.feed.cx, L.feed.cy + ch * 0.06, tapA, press, rip);
  }

  // ---- 10.0 - 14.0: verbs
  function sceneMontage(t) {
    const M = L.montage;
    let k = 0;
    // The 15 s cut stops on BREAK and irises out of it.
    for (let i = 0; i < (CUT ? 6 : MONT.length); i++) if (t >= MONT[i].t) k = i;
    const cur = MONT[k];
    const prev = MONT[k - 1];
    if (t < 10.0) return;

    vis(accentBg, true);
    accentBg.style.background = G[cur.g].accent;
    const vw = verbWidth(cur.verb.toUpperCase());
    const local = t - cur.t;
    wpRows.forEach((r, i) => {
      vis(r, true);
      const txt = `${cur.verb}&nbsp;`.repeat(Math.ceil(W / vw) + 3);
      if (r._t !== txt) {
        r._t = txt;
        r.innerHTML = txt;
      }
      const dir = i % 2 ? 1 : -1;
      const off = (((i * 0.37 + k * 0.21) % 1) * vw + dir * local * (V ? 260 : 300) + vw * 4) % vw;
      const slam = 1 - outExpo(seg(local, 0, 0.3));
      r.style.transform = `translateX(${-off}px) translateY(${slam * (i % 2 ? -1 : 1) * 40}px)`;
      r.style.opacity = 1 - slam * 0.5;
    });
    vis(montLabel, false);
    montLabel.textContent = `${String(k + 1).padStart(2, "0")}/08 — ${G[cur.g].name}`;
    montLabel.style.left = `${V ? 64 : 64}px`;
    montLabel.style.top = `${V ? 120 : 48}px`;

    const A = (m, extra = {}) => {
      const c = card();
      c.set({ game: m.g, clip: montClip(m, Math.min(t, m === cur ? t : cur.t)), bar: false, ring: false, ...extra });
      return c;
    };
    const p = local;
    const tr = cur.tr;
    // Every transition settles inside ~0.3 s.
    if (!prev || p > 0.36) {
      const c = A(cur);
      // Gentle drift so the frame never sits dead still.
      const b = 1 + 0.02 * outCubic(seg(p, 0, 0.5));
      c.place(M.cx, M.cy, M.s * b);
      return;
    }
    if (tr === "dodge") {
      const e = outExpo(seg(p, 0, 0.32));
      const a = A(prev);
      a.place(M.cx - e * W * 0.95, M.cy, M.s, `rotate(${-6 * e}deg)`);
      const b = A(cur);
      b.place(M.cx + (1 - e) * W * 0.95, M.cy, M.s, `rotate(${6 * (1 - e)}deg)`);
    } else if (tr === "slice") {
      const b = A(cur);
      b.place(M.cx, M.cy, M.s * lerp(0.94, 1, outCubic(seg(p, 0, 0.3))));
      const e = outCubic(seg(p, 0.03, 0.34));
      const top = A(prev, { clipPath: "polygon(0 0, 100% 0, 100% 36%, 0 64%)", opacity: 1 - seg(p, 0.2, 0.34) });
      top.place(M.cx - e * W * 0.32, M.cy - e * H * 0.16, M.s, `rotate(${-7 * e}deg)`);
      const bot = A(prev, { clipPath: "polygon(0 64%, 100% 36%, 100% 100%, 0 100%)", opacity: 1 - seg(p, 0.2, 0.34) });
      bot.place(M.cx + e * W * 0.32, M.cy + e * H * 0.16, M.s, `rotate(${7 * e}deg)`);
      // The blade.
      const bl = seg(p, 0, 0.1);
      if (bl > 0 && bl < 1) {
        const c = card();
        c.set({ game: cur.g, clip: 0, bar: false, ring: false, opacity: 1 - bl });
        c.shot.style.opacity = 0;
        c.el.style.background = "transparent";
        c.extra.innerHTML = `<svg width="360" height="640" style="position:absolute;left:0;top:0;overflow:visible"><line x1="-60" y1="${640 * 0.64 + 60 * 0.28 / 360 * 640}" x2="${360 * bl * 1.4}" y2="${640 * 0.64 - (360 * bl * 1.4 + 60) * (0.28 * 640 / 360)}" stroke="#F3F0E8" stroke-width="7" stroke-linecap="square"/></svg>`;
        c.el.style.overflow = "visible";
        c.place(M.cx, M.cy, M.s);
      }
    } else if (tr === "flip") {
      const e = inOutCubic(seg(p, 0, 0.34));
      const ang = e * 180;
      const lift = 1 - 0.12 * Math.sin(e * Math.PI);
      if (ang < 90) {
        const a = A(prev);
        a.place(M.cx, M.cy, M.s * lift, `perspective(2400px) rotateY(${ang}deg)`);
      } else {
        const b = A(cur);
        b.place(M.cx, M.cy, M.s * lift, `perspective(2400px) rotateY(${ang - 180}deg)`);
      }
    } else if (tr === "merge") {
      const a = A(prev, { dim: 0.5 * seg(p, 0, 0.2) });
      a.place(M.cx, M.cy, M.s * lerp(1, 0.92, outCubic(seg(p, 0, 0.3))));
      const e = outExpo(seg(p, 0, 0.3));
      const off = (1 - e) * W * 0.62;
      const l = A(cur, { clipPath: "inset(0 50% 0 0)", radius: 26 });
      l.place(M.cx - off, M.cy, M.s);
      const r = A(cur, { clipPath: "inset(0 0 0 50%)" });
      r.place(M.cx + off, M.cy, M.s);
    } else if (tr === "break") {
      const b = A(cur);
      b.place(M.cx, M.cy, M.s * lerp(0.9, 1, outCubic(seg(p, 0.02, 0.3))));
      // Tiles of the previous card fall away.
      vis(shatter, true);
      shatter.style.transform = `translate(${M.cx - 180}px, ${M.cy - 320}px) scale(${M.s})`;
      const url = frameUrl(prev.g, montClip(prev, cur.t));
      for (const tl of tiles) {
        setSrc(tl.img, url);
        const tau = Math.max(0, p - tl.delay);
        const x = (tl.x * 360) / TILE_C + tl.vx * tau;
        const y = (tl.y * 640) / TILE_R + tl.vy * tau + 0.5 * 2600 * tau * tau;
        tl.d.style.transform = `translate(${x}px, ${y}px) rotate(${tl.vr * tau}deg) scale(${1 - 0.25 * clamp(tau * 3)})`;
        tl.d.style.opacity = 1 - seg(tau, 0.2, 0.32);
      }
    } else if (tr === "drop") {
      const a = A(prev);
      const ea = inCubic(seg(p, 0, 0.26));
      a.place(M.cx, M.cy + ea * H * 1.05, M.s, `rotate(${3 * ea}deg)`);
      const eb = spring(p, BOUNCE);
      const b = A(cur);
      b.place(M.cx, M.cy - (1 - eb) * H * 1.05, M.s);
    } else if (tr === "scan") {
      const a = A(prev);
      a.place(M.cx, M.cy, M.s);
      const e = inOutCubic(seg(p, 0, 0.3));
      const b = A(cur, { clipPath: `inset(0 0 ${(1 - e) * 100}% 0)`, scan: e < 1 ? e : -1 });
      b.place(M.cx, M.cy, M.s);
    }
    // Snap flash on each cut.
    const fl = 1 - seg(p, 0, 0.12);
    if (fl > 0 && k > 0) flash.style.background = `rgba(243,240,232,${0.08 * fl})`;
  }

  // ---- 14.0 - 16.0: the wall
  const wallTarget = { j: V ? 1 : 3, r: -1 };
  function wallLayout(t) {
    const Wl = L.wall;
    const cellH = Wl.cellH;
    const cellW = (cellH * 9) / 16;
    const s = cellH / 640;
    const pitchX = cellW + Wl.gapX;
    const pitchY = cellH + Wl.gapY;
    const cols = [];
    for (let j = 0; j < Wl.cols; j++) {
      const x = W / 2 + (j - (Wl.cols - 1) / 2) * pitchX;
      const dir = j % 2 ? 1 : -1;
      const off = dir * (t - 14) * (V ? 150 : 110) + (j % 2 ? pitchY * 0.5 : 0);
      cols.push({ x, off });
    }
    return { cellH, cellW, s, pitchX, pitchY, cols };
  }
  function sceneWall(t) {
    const lay = wallLayout(t);
    const M = L.montage;
    const F = L.feed;
    // The zoom into Duskrail at the end.
    const z = inOutExpo(seg(t, 15.42, 16.0));
    const tc = lay.cols[wallTarget.j];
    const targetY = H / 2 + tc.off + wallTarget.r * lay.pitchY;
    const Z = lerp(1, F.s / lay.s, z);
    const tx = lerp(0, F.cx - tc.x, z);
    const ty = lerp(0, F.cy - targetY, z);
    const map = (x, y) => [tc.x + (x - tc.x) * Z + tx, targetY + (y - targetY) * Z + ty];
    let n = 0;
    for (let j = 0; j < lay.cols.length; j++) {
      const col = lay.cols[j];
      const rows = Math.ceil(H / lay.pitchY) + 2;
      for (let r = -rows; r <= rows; r++) {
        const y = H / 2 + col.off + r * lay.pitchY;
        if (y < -lay.cellH && Z < 1.01) continue;
        if (y > H + lay.cellH && Z < 1.01) continue;
        const isTarget = j === wallTarget.j && r === wallTarget.r;
        const isCenter = j === (V ? 1 : 2) && r === 0;
        const colList = WALL[j];
        const mid = (colList.length - 1) / 2;
        const g = colList[(((r + mid) % colList.length) + colList.length) % colList.length];
        const [mx, my] = map(col.x, y);
        const cs = lay.s * Z;
        if (mx < -cs * 200 || mx > W + cs * 200 || my < -cs * 340 || my > H + cs * 340) continue;
        // Staggered entrance from the center.
        const d = Math.hypot(col.x - W / 2, y - H / 2) / Math.hypot(W, H);
        const ent = isCenter ? 1 : spring(t - 13.97 - d * 0.22, UI);
        const c = card();
        const clip = 0.9 + (t - 14) * 0.98 + ((j * 0.13 + r * 0.07) % 0.06);
        if (isTarget && z > 0) {
          c.set({ game: z > 0.5 ? "duskrail-end" : g, clip: z > 0.5 ? 0.02 : clip, dock: clamp(z * 2 - 1), bar: z > 0.5, ring: true });
        } else c.set({ game: g, clip, bar: false, ring: true, opacity: clamp(ent) * (isTarget ? 1 : 1 - z) });
        if (isCenter && t < 14.45) {
          // Kingsnare arrives from the montage and settles into its cell.
          const e = outExpo(seg(t, 14.0, 14.45));
          c.place(lerp(M.cx, mx, e), lerp(M.cy, my, e), lerp(M.s, cs, e));
          c.set({ game: e < 0.02 ? "kingsnare" : g, clip: e < 0.02 ? montClip(MONT[7], t) : clip, bar: false });
          c.el.style.zIndex = 5;
        } else c.place(mx, my, cs * lerp(0.7, 1, clamp(ent)));
        if (isTarget) c.el.style.zIndex = 6;
        n++;
      }
    }
    // Headline over a dimmed wall.
    const dim = seg(t, 14.3, 14.5) * (1 - seg(t, 15.35, 15.6));
    vis(wallScrim, dim > 0);
    wallScrim.style.opacity = 0.62 * dim;
    wallScrim.style.zIndex = 0;
    wallText.style.fontSize = `${V ? 112 : 150}px`;
    wallText.style.left = "0";
    wallText.style.width = `${W}px`;
    wallText.style.top = `${H / 2}px`;
    wallText.style.bottom = "";
    wallText.style.transform = "translateY(-50%)";
    animateCallout(wallText, t, 14.32, 15.3);
    cardLayer.style.zIndex = "";
  }

  // ---- 16.0 - 20.0: result, NEW BEST, challenge
  const SHEET_TOP = 300;
  function sceneResult(t) {
    const F = L.feed;
    const c = card();
    const exit = inExpo(seg(t, 19.92, 20.2));
    const clip = t - 16.0 + 0.0;
    c.set({ game: "duskrail-end", clip, feed: 0, dock: 1, bar: true, dim: 0.5 * outCubic(seg(t, 16.75, 17.0)), t });
    // Small camera push and a nudge when the stamp lands.
    const stampHit = Math.exp(-Math.max(0, t - 17.5) * 18) * (t >= 17.5 ? 1 : 0);
    c.place(F.cx - exit * W, F.cy, F.s * (1 + 0.012 * stampHit), `rotate(${-exit * 8}deg)`);
    c.el.style.zIndex = 3;
    // Result card
    if (t >= 16.7 && t < 18.6) {
      c.extra.innerHTML = resultHtml();
      const r = c.extra.querySelector(".result");
      const e = spring(t - 16.8, SHEET);
      const gone = inCubic(seg(t, 18.12, 18.34));
      r.style.transform = `translateY(${(1 - e) * 90 + gone * 140}px) scale(${1 - 0.04 * gone})`;
      r.style.opacity = clamp(e * 2) * (1 - gone);
      // Odometer 0 -> 531
      const v = 531 * outCubic(seg(t, 16.95, 17.6));
      const cols = r.querySelectorAll(".col div");
      [100, 10, 1].forEach((p, i) => {
        let pos = (v / p) % 10;
        if (p > 1) {
          // Columns tick over with the column to their right.
          const low = v % p;
          const whole = Math.floor(v / p) % 10;
          pos = whole + clamp((low - (p - p / 10)) / (p / 10));
        }
        cols[i].style.transform = `translateY(${-pos * 64}px)`;
      });
      if (t > 17.5) r.querySelector(".bestv").textContent = "531";
      const st = c.extra.querySelector(".stamp");
      const se = spring(t - 17.5, POP);
      st.style.opacity = (t >= 17.5 ? 1 : 0) * (1 - gone);
      st.style.transform = `rotate(${lerp(-16, -8, se)}deg) scale(${lerp(2.4, 1, se)})`;
      // Press on "Challenge a friend".
      const ghost = r.querySelector(".ghost");
      const pr = seg(t, 18.0, 18.05) * (1 - seg(t, 18.1, 18.18));
      ghost.style.transform = `scale(${1 - 0.04 * pr})`;
    }
    // Touch on the challenge button (logical 180, 418 inside the card).
    const ta = seg(t, 17.84, 17.92) * (1 - seg(t, 18.12, 18.22));
    const tp = seg(t, 17.98, 18.03) * (1 - seg(t, 18.08, 18.14));
    const trip = t >= 18.03 && t <= 18.4 ? seg(t, 18.03, 18.4) : -1;
    if (ta > 0 || trip >= 0) touch(F.cx, F.cy + (418 - 320) * F.s, ta, tp, trip);
    // Challenge sheet
    if (t >= 18.14) {
      const holder = el("div", "", c.extra);
      holder.innerHTML = sheetHtml();
      const sh = holder.querySelector(".sheet");
      const e = spring(t - 18.16, SHEET);
      sh.style.transform = `translateY(${lerp(640, SHEET_TOP, e)}px)`;
      const out = sh.querySelector(".out");
      const typing = sh.querySelector(".typing");
      const reply = sh.querySelector(".reply");
      const av = sh.querySelector(".mini-av");
      const tb = sh.querySelector(".tapback");
      Object.assign(out.style, { right: "16px", top: "62px", width: "250px", transformOrigin: "100% 100%" });
      const eo = spring(t - 18.42, POP);
      out.style.transform = `scale(${lerp(0.5, 1, eo)})`;
      out.style.opacity = clamp(eo * 3);
      Object.assign(av.style, { left: "16px", top: "214px" });
      av.style.opacity = seg(t, 18.85, 18.95);
      Object.assign(typing.style, { left: "52px", top: "204px", fontSize: "14px", color: "#A7A3AE", letterSpacing: "1px" });
      const showTyping = t >= 18.85 && t < 19.15;
      vis(typing, showTyping);
      typing.style.opacity = showTyping ? 0.5 + 0.5 * Math.abs(Math.sin(t * 14)) : 0;
      Object.assign(reply.style, { left: "52px", top: "204px", transformOrigin: "0% 100%" });
      const er = spring(t - 19.15, POP);
      vis(reply, t >= 19.15);
      reply.style.transform = `scale(${lerp(0.5, 1, er)})`;
      // Heart tapback on our bubble, with the like burst.
      Object.assign(tb.style, { left: "78px", top: "46px" });
      const eh = spring(t - 19.45, POP);
      vis(tb, t >= 19.45);
      tb.style.transform = `scale(${lerp(0, 1, eh)})`;
      const sheetTop = lerp(640, SHEET_TOP, e);
      const hx = F.cx + (78 + 17 - 180) * F.s - exit * W;
      const hy = F.cy + (sheetTop + 46 + 17 - 320) * F.s;
      drawBurst(t, 19.45, hx, hy, F.s);
    }
  }

  // ---- 20.0 - 22.0: creators
  function sceneCreators(t) {
    vis(term, true);
    const enter = outExpo(seg(t, 19.95, 20.3));
    const leave = seg(t, 21.85, 22.2);
    termBody.innerHTML = termHtml(t);
    const hgt = term.offsetHeight;
    term.style.top = `${TERM.cy - hgt / 2}px`;
    term.style.transform = `translateX(${(1 - enter) * W}px) scale(${1 - 0.05 * outCubic(leave)})`;
    term.style.opacity = 1 - outCubic(leave);
  }

  // ---- 21.8 - 26.5: the button again, the lockup
  function sceneEnd(t) {
    // A last swipe up: the lockup rubber-bands, there is nothing after the sign-off.
    const pull = outCubic(seg(t, 25.12, 25.32));
    const rb = (V ? 46 : 30) * pull * (1 - spring(t - 25.32, UI));
    const E = { ...END, by: END.by - rb, wy: END.wy - rb, tagY: END.tagY - rb, ctaY: END.ctaY - rb, siteY: END.siteY - rb };
    swipeTouch(t, 25.3, W / 2 + (V ? 140 : 260), H * 0.86, H * 0.66);
    if (ICON) iconEnd(t, E);
    else {
      // The LIVE dot grows into the button.
      const live = termBody.querySelector(".live");
      const m = inOutExpo(seg(t, 21.86, 22.24));
      if (t < 22.3 && live) {
        const r = live.getBoundingClientRect();
        const sx = r.left + r.width / 2;
        const sy = r.top + r.height / 2;
        const d0 = r.height * 0.62;
        const d1 = E.bs * (600 / 1024);
        const d = lerp(d0, d1, m);
        vis(morphDot, true);
        morphDot.style.width = morphDot.style.height = `${d}px`;
        morphDot.style.transform = `translate(${lerp(sx, E.bx, m) - d / 2}px, ${lerp(sy, E.by - (11 / 1024) * E.bs, m) - d / 2}px)`;
        morphDot.style.opacity = 1 - seg(t, 22.16, 22.26);
      }
      vis(openLayer, t >= 22.14);
      if (t >= 22.14) {
        vis(heatCover, false);
        vis(pressLabel, false);
        const pop = spring(t - 22.14, POP);
        const press = outCubic(seg(t, 22.42, 22.5)) * (1 - 0.55 * outCubic(seg(t, 22.62, 22.9)));
        placeButton(E.bx, E.by, E.bs * lerp(0.92, 1, pop), 1, press);
        button.style.rotate = "0deg";
        btnHousing.style.opacity = seg(t, 22.14, 22.3);
        btnSide.style.opacity = seg(t, 22.14, 22.3);
        const k = seg(t, 22.5, 23.0);
        vis(shock, k > 0 && k < 1);
        const rr = E.bs * 0.5 * (1 + 0.9 * outCubic(k));
        shock.style.width = shock.style.height = `${rr * 2}px`;
        shock.style.transform = `translate(${E.bx - rr}px, ${E.by - rr}px)`;
        shock.style.boxShadow = `0 0 0 ${V ? 6 : 5}px rgba(243,240,232,${0.5 * (1 - k)})`;
      }
    }
    vis(endBox, t >= 22.5);
    if (t < 22.5) return;
    const ww = E.ww * (BRAND.wordmarkWidth / 771);
    const wh = (ww * 150) / BRAND.wordmarkWidth;
    const we = outExpo(seg(t, 22.55, 23.05));
    word.style.width = `${ww}px`;
    word.style.transform = `translate(${E.wx - ww / 2}px, ${E.wy - wh / 2 - (V ? 0 : 8)}px)`;
    wordImg.style.transform = `translateY(${(1 - we) * 108}%)`;
    // Tagline types out with a heat block cursor.
    const n = Math.floor(clamp((t - 23.0) / 0.55) * TAG.length);
    const blink = t > 23.55 && Math.floor(t * 3) % 2 === 1;
    tagline.innerHTML = `${TAG.slice(0, n)}<span style="display:inline-block;width:0.62em;height:0.95em;background:#FF4A3D;vertical-align:-0.1em;margin-left:0.12em;opacity:${t < 23.0 || blink ? 0 : 1}"></span>`;
    tagline.style.fontSize = `${E.tagSize}px`;
    tagline.style.color = "#F3F0E8";
    if (V) {
      tagline.style.left = "0";
      tagline.style.width = `${W}px`;
      tagline.style.textAlign = "center";
      tagline.style.top = `${E.tagY}px`;
    } else {
      tagline.style.left = `${E.wx - ww / 2 + 6}px`;
      tagline.style.top = `${E.tagY}px`;
    }
    const ce = outExpo(seg(t, 23.8, 24.3));
    cta.textContent = "Coming soon · iPhone + Android";
    cta.style.fontSize = `${E.ctaSize}px`;
    cta.style.color = "#A7A3AE";
    cta.style.left = "0";
    cta.style.width = `${W}px`;
    cta.style.textAlign = "center";
    cta.style.top = `${E.ctaY}px`;
    cta.style.opacity = ce;
    cta.style.transform = `translateY(${(1 - ce) * 20}px)`;
    const se = outExpo(seg(t, 23.95, 24.45));
    site.textContent = BRAND.site;
    site.style.fontSize = `${E.siteSize}px`;
    site.style.color = "#F3F0E8";
    site.style.left = "0";
    site.style.width = `${W}px`;
    site.style.textAlign = "center";
    site.style.top = `${E.siteY}px`;
    site.style.opacity = se;
    site.style.transform = `translateY(${(1 - se) * 20}px)`;
  }

  /**
   * 21.8 - 23.0 with BRAND.icon. The LIVE dot travels to the icon's bottom edge, where the swipe comes in, and becomes
   * the fingertip: the icon pops in around it, and on the beat the dot swipes up across it, drawing the swipe behind it.
   * (The 15 s cut has no terminal: its iris lands on the icon instead, see iconIris.)
   */
  function iconEnd(t, E) {
    vis(openLayer, t >= 22.14);
    const pop = t >= 22.14 ? spring(t - 22.14, POP) : 0;
    const size = E.bs * ICON_SIZE * lerp(0.92, 1, pop);
    const k = inOutCubic(seg(t, 22.34, 22.5));
    if (t >= 22.14) {
      vis(heatCover, false);
      vis(pressLabel, false);
      placeIcon(E.bx, E.by, size, k);
      iconEl.style.rotate = "0deg";
      iconEl.style.opacity = seg(t, 22.14, 22.3);
      const s = seg(t, 22.5, 23.0);
      vis(shock, s > 0 && s < 1);
      const rr = E.bs * 0.5 * (1 + 0.9 * outCubic(s));
      shock.style.width = shock.style.height = `${rr * 2}px`;
      shock.style.transform = `translate(${E.bx - rr}px, ${E.by - rr}px)`;
      shock.style.boxShadow = `0 0 0 ${V ? 6 : 5}px rgba(243,240,232,${0.5 * (1 - s)})`;
    }
    if (CUT || t >= 22.5) return;
    // The fingertip: the swipe's width where it enters, waiting on the bottom edge until the drawn swipe reaches it.
    if (!iconRevealLen) placeIcon(E.bx, E.by, size, k);
    const [ex, ew] = ICON.entry;
    const onIcon = (x, y) => [E.bx + ((x - 512) / 1024) * size, E.by + ((y - 512) / 1024) * size];
    const entryLen = iconLenAtY(1024);
    const tip = iconReveal.getPointAtLength(Math.max(entryLen, iconRevealLen * k));
    let [tx, ty] = onIcon(tip.x, tip.y);
    const d1 = (ew / 1024) * size;
    let d = d1;
    const m = inOutExpo(seg(t, 21.86, 22.24));
    const live = termBody.querySelector(".live");
    if (m < 1 && live) {
      const r = live.getBoundingClientRect();
      d = lerp(r.height * 0.62, d1, m);
      [tx, ty] = [lerp(r.left + r.width / 2, tx, m), lerp(r.top + r.height / 2, ty, m)];
    }
    vis(morphDot, true);
    morphDot.style.borderRadius = "50%";
    morphDot.style.background = ICON.color;
    morphDot.style.width = morphDot.style.height = `${d}px`;
    morphDot.style.transform = `translate(${tx - d / 2}px, ${ty - d / 2}px)`;
    // It melts into the swipe as it climbs into the solid part.
    morphDot.style.opacity = 1 - seg(k, 0.55, 0.9);
  }

  // ---- 15 s cut, 10.86 - 11.24: the frame irises down onto the button cap, which turns heat red.
  // Mirrors the LIVE-dot morph of the long cut, so the sign-off picks up at its 22.14 pop.
  const IRIS = [10.86, 11.24];
  const IRIS_LAYERS = [accentBg, wallpaper, cardLayer, fxLayer];
  function sceneIris(t) {
    if (ICON) return iconIris(t);
    const k = inOutExpo(seg(t, IRIS[0], IRIS[1]));
    const active = t >= IRIS[0] && t < IRIS[1] - 0.08;
    // The iris starts on the game card and carries it onto the cap, shrinking it a little on the way.
    const M0 = L.montage;
    const cx = lerp(M0.cx, END.bx, k);
    const cy = lerp(M0.cy, END.by - (11 / 1024) * END.bs, k);
    const r1 = (END.bs * (600 / 1024)) / 2;
    const r0 = Math.hypot(Math.max(M0.cx, W - M0.cx), Math.max(M0.cy, H - M0.cy)) + 40;
    const r = lerp(r0, r1, k);
    const s = lerp(1, 0.7, k);
    for (const l of IRIS_LAYERS) {
      l.style.clipPath = active ? `circle(${r / s}px at ${M0.cx}px ${M0.cy}px)` : "";
      l.style.transformOrigin = `${M0.cx}px ${M0.cy}px`;
      l.style.transform = active ? `translate(${cx - M0.cx}px, ${cy - M0.cy}px) scale(${s})` : "";
    }
    if (t < IRIS[0] || t >= 11.3) return;
    // Heat rim on the closing edge, then the disc fills in as it lands.
    const rim = V ? 12 : 10;
    vis(irisRing, k < 0.995);
    irisRing.style.width = irisRing.style.height = `${r * 2}px`;
    irisRing.style.transform = `translate(${cx - r}px, ${cy - r}px)`;
    irisRing.style.boxShadow = `inset 0 0 0 ${rim}px #FF4A3D`;
    const fill = seg(k, 0.55, 0.96);
    vis(morphDot, fill > 0);
    morphDot.style.width = morphDot.style.height = `${r * 2}px`;
    morphDot.style.transform = `translate(${cx - r}px, ${cy - r}px)`;
    morphDot.style.opacity = fill * (1 - seg(t + END_SHIFT, 22.16, 22.26));
  }

  /** The 15 s cut with BRAND.icon: the iris is the icon's rounded square, and it lands as the empty ink icon. */
  function iconIris(t) {
    const k = inOutExpo(seg(t, IRIS[0], IRIS[1]));
    const active = t >= IRIS[0] && t < IRIS[1] - 0.08;
    const M0 = L.montage;
    const cx = lerp(M0.cx, END.bx, k);
    const cy = lerp(M0.cy, END.by, k);
    const h1 = (END.bs * ICON_SIZE) / 2;
    const h0 = Math.hypot(Math.max(M0.cx, W - M0.cx), Math.max(M0.cy, H - M0.cy)) + 40;
    const h = lerp(h0, h1, k);
    const s = lerp(1, 0.7, k);
    /** The icon's corner radius at half-size hh. */
    const round = (hh) => hh * 2 * 0.2237;
    const hs = h / s;
    for (const l of IRIS_LAYERS) {
      l.style.clipPath = active ? `inset(${M0.cy - hs}px ${W - M0.cx - hs}px ${H - M0.cy - hs}px ${M0.cx - hs}px round ${round(hs)}px)` : "";
      l.style.transformOrigin = `${M0.cx}px ${M0.cy}px`;
      l.style.transform = active ? `translate(${cx - M0.cx}px, ${cy - M0.cy}px) scale(${s})` : "";
    }
    if (t < IRIS[0] || t >= 11.3) return;
    const rim = V ? 12 : 10;
    vis(irisRing, k < 0.995);
    irisRing.style.borderRadius = `${round(h)}px`;
    irisRing.style.width = irisRing.style.height = `${h * 2}px`;
    irisRing.style.transform = `translate(${cx - h}px, ${cy - h}px)`;
    irisRing.style.boxShadow = `inset 0 0 0 ${rim}px #FF4A3D`;
    const fill = seg(k, 0.55, 0.96);
    vis(morphDot, fill > 0);
    morphDot.style.borderRadius = `${round(h)}px`;
    morphDot.style.background = ICON.bg;
    morphDot.style.width = morphDot.style.height = `${h * 2}px`;
    morphDot.style.transform = `translate(${cx - h}px, ${cy - h}px)`;
    morphDot.style.opacity = fill * (1 - seg(t + END_SHIFT, 22.16, 22.26));
  }

  // ------------------------------------------------------------------ api
  let ready = false;
  window.TRAILER = {
    W,
    H,
    FPS,
    DURATION,
    async init() {
      await document.fonts.load('900 100px "Mona Sans"');
      await document.fonts.load('400 20px "Departure Mono"');
      await document.fonts.ready;
      initTitle();
      ready = true;
    },
    async frame(t) {
      if (!ready) await this.init();
      render(t);
      await settle();
      // Never screenshot a card whose frame has not been decoded yet.
      for (let tries = 0; tries < 40; tries++) {
        const missing = [...stage.querySelectorAll(".card img, #stage .abs img")].filter((i) => i._src && i.offsetParent !== null && (!i.complete || i.naturalWidth === 0));
        if (!missing.length) break;
        for (const i of missing) {
          if (tries % 5 === 4) i.src = `${i._src}${i._src.includes("?") ? "&" : "?"}r=${tries}`;
          await i.decode().catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      // Sheet / result html is rebuilt per frame: wait for any images inside.
      const imgs = [...stage.querySelectorAll(".card .extra img, .sheet img")].filter((i) => !i.complete);
      await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    },
  };
})();
