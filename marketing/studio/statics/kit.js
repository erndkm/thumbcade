/* Building blocks for the ad statics: game data, the feed card, the lockup, frames, text fitting.
   Every creative in creatives.js is a function that returns HTML for one canvas. */
(() => {
  const ASSETS = "../assets";
  const FRAMES = "../../trailer/frames";

  // Real launch-game data (games/<slug>/thumbcade.json). Copy is shortened from each manifest description.
  const G = {
    stackd: { name: "Stackd", accent: "#3DE0FF", input: "Tap", tags: ["3d", "stacking", "onetap"], desc: "Drop the slab, slice the overhang, build a skyscraper above the city lights." },
    duskrail: { name: "Duskrail", accent: "#FF6A1A", input: "Swipe", tags: ["runner", "3d", "reflex"], desc: "Three lanes. Zero chill. Swipe to dodge, jump and slide down a sunset viaduct." },
    kingsnare: { name: "Kingsnare", accent: "#5CF2B8", input: "Tap", tags: ["chess", "puzzle", "brain"], desc: "Ninety seconds of checkmates. Mate in one, two, three. No draws, no mercy." },
    "neon-chop": { name: "Neon Chop", accent: "#FF3D6E", input: "Drag", tags: ["slash", "reflex", "neon"], desc: "Swipe through neon produce, chain combos, and never, ever cut the static." },
    flapjack: { name: "Flapjack", accent: "#FFB23F", input: "Tap", tags: ["onetap", "flyer", "arcade"], desc: "A pancake with ambition. Tap to flip through the forks of a midnight diner." },
    shortwick: { name: "Shortwick", accent: "#B48CFF", input: "Swipe", tags: ["merge", "puzzle", "brain"], desc: "Slide, merge, keep the fuse lit. Every merge buys you time." },
    heatfall: { name: "Heatfall", accent: "#FFE14D", input: "Drag", tags: ["3d", "arcade", "chill"], desc: "Spin the grates, drop the ember, dodge the coolant. The heat is right behind you." },
    snek: { name: "Snek", accent: "#4DFF88", input: "Swipe", tags: ["snake", "retro", "arcade"], desc: "Swipe to steer a very hungry snek. Eat fast for combos. Don't eat yourself." },
    pairs: { name: "Pairs", accent: "#FF6FB5", input: "Tap", tags: ["matching", "brain", "chill"], desc: "Peek, flip, match. Every pair buys you two seconds." },
    voltbrick: { name: "Voltbrick", accent: "#4D8DFF", input: "Drag", tags: ["bricks", "retro", "arcade"], desc: "Drag anywhere to steer. Split the ball, grab the beam, clear the grid." },
    kneejerk: { name: "Kneejerk", accent: "#00E5C7", input: "Tap", tags: ["reflex", "speed", "brain"], desc: "Four tiny tests, one thumb, three lives. Wait for it. Fast." },
    mines: { name: "Mines", accent: "#7CC4FF", input: "Tap", tags: ["logic", "puzzle", "classic"], desc: "Sonar says 15 mines. Sonar has been wrong before." },
  };
  // The best real frame of each captured run (marketing/trailer/frames, 60 fps).
  const BEST = { stackd: 719, duskrail: 560, kingsnare: 400, "neon-chop": 719, flapjack: 240, shortwick: 719, heatfall: 719, snek: 719, pairs: 240, voltbrick: 560, kneejerk: 480, mines: 719 };
  const ORDER = ["stackd", "duskrail", "kingsnare", "neon-chop", "flapjack", "shortwick", "heatfall", "snek", "pairs", "voltbrick", "kneejerk", "mines"];

  const frame = (g, i = BEST[g]) => (g === "mines" ? `${ASSETS}/posters/mines.jpg` : `${FRAMES}/${g}/f${String(i).padStart(5, "0")}.jpg`);
  const iconUrl = (g) => `${ASSETS}/icons/${g}.png`;

  const IC = TC.icons;
  function icon(name, size, o = {}) {
    const d = IC[name];
    const color = o.color || "currentColor";
    const sw = o.stroke || 1.75;
    if (o.filled || d.solid) return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${d.filled || d.d}" fill="${color}"/></svg>`;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${d.d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
  }

  /** The app's feed card (logical 360x640) placed at x,y with scale s. No fabricated counts: the rail shows icons only. */
  function card(game, x, y, s, o = {}) {
    const m = G[game];
    const src = o.src || frame(game, o.frame);
    const chrome = o.chrome !== false;
    const ui = chrome
      ? `<div class="scrim-top"></div><div class="scrim-bottom"></div>
        <div class="tabs"><span class="off">Following</span><span class="on">For You</span></div>
        <div class="search">${icon("search", 21, { color: "#F3F0E8", stroke: 2 })}</div>
        <div class="rail">
          <div class="item" style="top:262px"><div class="avatar">${TC.avatars.thumbcade}</div><div class="follow">${icon("plus", 11, { color: "#0D0D10", stroke: 3 })}</div></div>
          <div class="item" style="top:330px">${icon("like", 29, { filled: true, color: o.liked ? "#FF4A3D" : "#F3F0E8" })}</div>
          <div class="item" style="top:378px">${icon("comment", 29, { color: "#F3F0E8", stroke: 2 })}</div>
          <div class="item" style="top:426px">${icon("save", 29, { color: "#F3F0E8", stroke: 2 })}</div>
          <div class="item" style="top:474px">${icon("share", 29, { color: "#F3F0E8", stroke: 2 })}</div>
          <div class="cart"><img src="${iconUrl(game)}"></div>
        </div>
        <div class="caption">
          <div class="handle">@thumbcade<span class="verified">${icon("check", 10, { color: "#0D0D10", stroke: 3.2 })}</span></div>
          <div class="gname">${m.name}</div><div class="desc">${m.desc}</div>
          <div class="chips">${m.tags.map((t) => `<span class="chip">#${t}</span>`).join("")}</div>
          <div class="meta">&#9656; ${m.input} to play</div>
        </div>
        <div class="bar"><div class="tabbar">
          <div class="t on">${icon("home", 22, { filled: true, color: "#F3F0E8" })}<span>Home</span></div>
          <div class="t">${icon("discover", 22, { color: "#A7A3AE", stroke: 2 })}<span>Discover</span></div>
          <div class="t"><div class="create">${icon("plus", 15, { color: "#0D0D10", stroke: 2.6 })}</div></div>
          <div class="t">${icon("inbox", 22, { color: "#A7A3AE", stroke: 2 })}<span>Inbox</span></div>
          <div class="t">${icon("profile", 22, { color: "#A7A3AE", stroke: 2 })}<span>Profile</span></div>
        </div></div>`
      : "";
    const rot = o.rotate ? ` rotate(${o.rotate}deg)` : "";
    return `<div class="card${o.square ? " square" : ""}" style="--accent:${m.accent};transform:translate(${x}px,${y}px) scale(${s})${rot}">
      <img class="shot" src="${src}">${ui}<div class="ring"></div></div>`;
  }

  /** Mark + wordmark. h = button diameter in px. */
  function lockup(x, y, h, o = {}) {
    const box = h / 0.672; // the button is 688 of the mark's 1024 viewBox
    const pad = (box - h) / 2;
    const wm = o.ink ? "wordmark-ink.svg" : "wordmark.svg";
    return `<div class="abs lockup" style="left:${x}px;top:${y}px;height:${h}px;gap:${h * 0.26}px">
      <img src="${ASSETS}/mark.svg" style="width:${box}px;height:${box}px;margin:${-pad}px ${-pad}px ${-pad}px ${-pad}px">
      <img src="${ASSETS}/${wm}" style="height:${h * 0.6}px;margin-top:${-h * 0.04}px"></div>`;
  }

  const gicon = (g, x, y, size) => `<div class="abs gicon" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px"><img src="${iconUrl(g)}"></div>`;

  /** Absolutely positioned text. fit: max width in px (font shrinks until the line fits). */
  function text(str, x, y, size, o = {}) {
    const cls = o.cls || "display";
    const fit = o.fit ? ` data-fit="${o.fit}"` : "";
    const align = o.align === "right" ? `right:${x}px;text-align:right` : `left:${x}px`;
    const style = `${align};top:${y}px;font-size:${size}px;${o.color ? `color:${o.color};` : ""}${o.lh ? `line-height:${o.lh};` : ""}${o.style || ""}`;
    return `<div class="abs ${cls}"${fit} style="${style};white-space:${o.wrap ? "normal" : "nowrap"}${o.width ? `;width:${o.width}px` : ""}">${str}</div>`;
  }

  /** A block of display lines, each scaled to exactly fill width w (poster typesetting). */
  function justified(lines, x, y, w, o = {}) {
    return `<div class="abs" data-justify="${w}" data-gap="${o.gap ?? 0.04}" style="left:${x}px;top:${y}px;width:${w}px">${lines
      .map((l) => `<div class="display" style="white-space:nowrap;line-height:0.86;${o.color ? `color:${o.color};` : ""}">${l}</div>`)
      .join("")}</div>`;
  }

  /** A feed queue: "UP NEXT" and numbered rows with the game icon. */
  function upNext(x, y, games, o = {}) {
    const size = o.size || 26;
    const row = o.row || size * 2.1;
    const color = o.color || "var(--paper)";
    const label = o.label ?? "Up next";
    const start = o.start ?? 2;
    return `<div class="abs mono" style="left:${x}px;top:${y}px;font-size:${size}px;color:${color}">
      ${label ? `<div style="opacity:.62;margin-bottom:${size * 0.9}px">${label}</div>` : ""}
      ${games
        .map((g, i) => `<div style="display:flex;align-items:center;gap:${size * 0.6}px;height:${row}px">
          <span style="opacity:.62;width:${size * 1.5}px">${String(i + start).padStart(2, "0")}</span>
          <span class="gicon" style="width:${size * 1.55}px;height:${size * 1.55}px"><img src="${iconUrl(g)}"></span>
          <span>${G[g].name}</span></div>`)
        .join("")}</div>`;
  }

  const FREE = "Free on iPhone + Android";

  async function layout(root) {
    await document.fonts.ready;
    await Promise.all([...root.querySelectorAll("img")].map((i) => (i.complete ? i.decode().catch(() => {}) : new Promise((r) => { i.onload = i.onerror = r; }).then(() => i.decode().catch(() => {})))));
    for (const e of root.querySelectorAll("[data-fit]")) {
      const max = Number(e.dataset.fit);
      let s = parseFloat(getComputedStyle(e).fontSize);
      while (e.scrollWidth > max && s > 8) e.style.fontSize = `${(s -= 1)}px`;
    }
    for (const b of root.querySelectorAll("[data-justify]")) {
      const w = Number(b.dataset.justify);
      const gap = Number(b.dataset.gap);
      for (const l of b.children) {
        l.style.fontSize = "100px";
        l.style.display = "inline-block";
        const nat = l.getBoundingClientRect().width;
        l.style.fontSize = `${(100 * w) / nat}px`;
        l.style.display = "block";
        l.style.marginBottom = `${gap * parseFloat(l.style.fontSize)}px`;
      }
    }
    // Fail loudly on broken images so a render never ships a hole.
    const bad = [...root.querySelectorAll("img")].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"));
    if (bad.length) throw new Error(`missing images: ${bad.join(", ")}`);
  }

  window.KIT = { G, BEST, ORDER, frame, iconUrl, icon, card, lockup, gicon, text, justified, upNext, FREE, layout };
})();
