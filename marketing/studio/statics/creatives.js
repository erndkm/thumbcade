/* Every static and carousel card, by campaign. `out` is relative to marketing/campaigns/.
   Safe zones (9:16): headlines and logos stay between y 250 and ~1250 (Stories/Reels/TikTok overlays). */
(() => {
  const { G, ORDER, frame, card, lockup, gicon, text, justified, upNext, FREE, icon } = KIT;
  const C = [];
  const add = (c) => C.push(c);
  const cv = (w, h, bg, inner, cls = "") => `<div class="cv ${cls}" style="width:${w}px;height:${h}px;background:${bg}">${inner}</div>`;
  const HEAT = "#FF4A3D";
  const INK = "#0D0D10";

  // ======================================================================= 01 THE FEED IS NOW PLAYABLE
  const C1 = "01-the-feed-is-playable/images";

  const Q = ["duskrail", "kingsnare", "neon-chop", "flapjack", "snek", "shortwick"];
  add({
    id: "01-poster-9x16", out: `${C1}/01-poster-9x16.png`, w: 1080, h: 1920,
    html: () => cv(1080, 1920, HEAT, `
      ${lockup(72, 282, 64, { ink: true })}
      ${text(FREE, 72, 302, 26, { cls: "mono", align: "right", color: INK })}
      ${justified(["The feed", "is now", "playable."], 72, 400, 936, { color: INK })}
      ${card("stackd", 497, 975, 1.42)}
      ${upNext(72, 1000, Q.slice(0, 5), { color: INK, size: 28 })}
    `),
  });
  add({
    id: "01-poster-4x5", out: `${C1}/01-poster-4x5.png`, w: 1080, h: 1350,
    html: () => cv(1080, 1350, HEAT, `
      ${lockup(64, 64, 56, { ink: true })}
      ${justified(["The feed", "is now", "playable."], 64, 168, 600, { color: INK })}
      ${card("stackd", 420, 520, 1.68)}
      ${upNext(64, 600, Q.slice(0, 5), { color: INK, size: 24 })}
      ${text(FREE, 64, 1250, 22, { cls: "mono", color: INK })}
    `),
  });
  add({
    id: "01-poster-1x1", out: `${C1}/01-poster-1x1.png`, w: 1080, h: 1080,
    html: () => cv(1080, 1080, HEAT, `
      ${lockup(64, 64, 52, { ink: true })}
      ${justified(["The", "feed", "is now", "playable."], 64, 196, 540, { color: INK })}
      ${card("stackd", 660, 64, 1.48)}
      ${text(FREE, 64, 978, 22, { cls: "mono", color: INK })}
    `),
  });
  add({
    id: "01-poster-1200x628", out: `${C1}/01-poster-1200x628.png`, w: 1200, h: 628,
    html: () => cv(1200, 628, HEAT, `
      ${lockup(56, 52, 44, { ink: true })}
      ${justified(["The feed", "is now", "playable."], 56, 150, 600, { color: INK })}
      ${text(FREE, 56, 560, 20, { cls: "mono", color: INK })}
      ${card("stackd", 790, 40, 1.12)}
    `),
  });

  const playIt = (x, y, size, br = "<br>") => text(`Your${br}feed.<br>But you<br><span class="heat">play it.</span>`, x, y, size, { lh: 0.9 });
  add({
    id: "01-play-it-9x16", out: `${C1}/01-play-it-9x16.png`, w: 1080, h: 1920,
    html: () => cv(1080, 1920, "#000", `<div class="dots"></div>
      ${lockup(72, 282, 56)}
      ${text(FREE, 72, 298, 24, { cls: "mono dim", align: "right" })}
      ${playIt(72, 400, 124, " ")}
      ${card("duskrail", 225, 790, 1.75)}
    `),
  });
  add({
    id: "01-play-it-4x5", out: `${C1}/01-play-it-4x5.png`, w: 1080, h: 1350,
    html: () => cv(1080, 1350, "#000", `<div class="dots"></div>
      ${lockup(64, 64, 52)}
      ${playIt(64, 176, 92)}
      ${upNext(64, 610, Q.slice(1, 6), { size: 24, start: 2 })}
      ${text(FREE, 64, 1250, 22, { cls: "mono dim" })}
      ${card("duskrail", 560, 64, 1.9)}
    `),
  });
  add({
    id: "01-play-it-1x1", out: `${C1}/01-play-it-1x1.png`, w: 1080, h: 1080,
    html: () => cv(1080, 1080, "#000", `<div class="dots"></div>
      ${lockup(64, 64, 48)}
      ${playIt(64, 180, 86)}
      ${text("Swipe up for<br>the next game", 64, 590, 26, { cls: "mono dim", lh: 1.35 })}
      ${text(FREE, 64, 982, 22, { cls: "mono dim" })}
      ${card("duskrail", 620, 64, 1.48)}
    `),
  });

  // ======================================================================= 02 SWIPE FOR THE NEXT GAME
  const C2 = "02-swipe-for-the-next-game";
  const CAROUSEL = ["stackd", "duskrail", "kingsnare", "neon-chop", "flapjack", "shortwick", "heatfall", "snek", "pairs"];
  const arrow = (x, y, w, color, stroke = 10) =>
    `<svg class="abs" style="left:${x}px;top:${y - 30}px;overflow:visible" width="${w}" height="60" viewBox="0 0 ${w} 60"><path d="M0 30 H${w - 6} M${w - 34} 4 L${w - 6} 30 L${w - 34} 56" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="square"/></svg>`;

  add({
    id: "02-carousel", out: `${C2}/carousel/02-carousel-{n}.png`, w: 1080, h: 1080, tiles: 10,
    html: () => {
      let h = `<div class="dots"></div><div class="rule" style="left:72px;top:1012px;width:${9 * 1080 + 936}px;background:rgba(243,240,232,.22)"></div>`;
      CAROUSEL.forEach((g, i) => {
        const X = i * 1080;
        const m = G[g];
        h += card(g, X + 548, 112, 1.3);
        h += `<div class="abs" style="left:${X + 72}px;top:1006px;width:14px;height:14px;background:${i === 0 ? HEAT : "var(--paper)"}"></div>`;
        h += text(`Swipe &rarr;`, X + 72, 1036, 22, { cls: "mono dim", align: "right", style: `right:auto;left:${X + 860}px` });
        if (i === 0) {
          h += lockup(X + 72, 112, 46);
          h += justified(["Swipe", "for the", "next", "game."], X + 72, 236, 420);
          h += text(`12 games &middot; 0 installs`, X + 72, 1036, 22, { cls: "mono dim" });
        } else {
          h += text(`${String(i + 1).padStart(2, "0")} / 12`, X + 72, 116, 26, { cls: "mono dim" });
          h += text(m.name, X + 72, 214, 84, { cls: "display", fit: 430 });
          h += text(m.desc, X + 72, 330, 31, { cls: "body", wrap: true, width: 420, lh: 1.32, style: "color:var(--paper-dim)" });
          h += `<div class="abs" style="left:${X + 72}px;top:690px;display:flex;flex-direction:column;gap:14px;align-items:flex-start">
            <span class="tag" style="font-size:24px;color:${m.accent}">${m.input} to play</span>
            <span class="mono" style="font-size:22px;color:var(--paper-dim)">${m.tags.map((t) => `#${t}`).join(" ")}</span></div>`;
          h += text(`${String(i + 1).padStart(2, "0")}`, X + 72, 1036, 22, { cls: "mono dim" });
        }
      });
      // End card
      const X = 9 * 1080;
      h += text("12 games.", X + 72, 112, 100, { fit: 936 });
      h += text(`<span class="heat">0 installs.</span>`, X + 72, 214, 100, { fit: 936 });
      ORDER.forEach((g, k) => {
        const col = k % 6, row = Math.floor(k / 6);
        h += gicon(g, X + 72 + col * 160, 400 + row * 170, 136);
      });
      h += text("One app. Swipe up for the next game.", X + 72, 760, 28, { cls: "mono dim" });
      h += lockup(X + 72, 880, 56);
      h += text(FREE, X + 72, 1036, 22, { cls: "mono dim" });
      return cv(10800, 1080, "#000", h);
    },
  });

  // Mid-swipe: the current card leaves upward, the next one is already running underneath.
  const swipeTrail = (x, y0, y1, s) => `<svg class="abs" style="left:${x - 60 * s}px;top:${y1 - 10}px;overflow:visible" width="${120 * s}" height="${y0 - y1 + 60 * s}">
      <line x1="${60 * s}" y1="${y0 - y1 + 10}" x2="${60 * s}" y2="10" stroke="rgba(243,240,232,.55)" stroke-width="${10 * s}" stroke-linecap="round"/>
    </svg>
    <div class="abs" style="left:${x - 46 * s}px;top:${y0 - 46 * s}px;width:${92 * s}px;height:${92 * s}px;border-radius:50%;background:rgba(243,240,232,.42);box-shadow:0 0 0 ${4 * s}px rgba(243,240,232,.95)"></div>`;
  const strip = (x, y, w, h, inner) => `<div class="abs" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:hidden">${inner}</div>`;
  add({
    id: "02-every-swipe-9x16", out: `${C2}/images/02-every-swipe-9x16.png`, w: 1080, h: 1920,
    html: () => cv(1080, 1920, "#000", `<div class="dots"></div>
      ${lockup(72, 282, 56)}
      ${text(FREE, 72, 298, 24, { cls: "mono dim", align: "right" })}
      ${justified(["Every swipe", "is a new", "game."], 72, 396, 936)}
      ${strip(0, 930, 1080, 990, card("stackd", 261, 250 - 992, 1.55) + card("duskrail", 261, 274, 1.55))}
      ${swipeTrail(660, 1700, 1380, 1)}
    `),
  });
  add({
    id: "02-every-swipe-4x5", out: `${C2}/images/02-every-swipe-4x5.png`, w: 1080, h: 1350,
    html: () => cv(1080, 1350, "#000", `<div class="dots"></div>
      ${lockup(64, 64, 52)}
      ${justified(["Every", "swipe is", "a new", "game."], 64, 170, 440)}
      ${upNext(64, 600, ["neon-chop", "flapjack", "snek"], { size: 24, start: 3 })}
      ${text(FREE, 64, 1250, 22, { cls: "mono dim" })}
      ${card("stackd", 584, 290 - 768, 1.2)}
      ${card("duskrail", 584, 314, 1.2)}
      ${card("neon-chop", 584, 314 + 768 + 24, 1.2, { chrome: false })}
      ${swipeTrail(860, 980, 660, 0.9)}
    `),
  });

  // ======================================================================= 03 BEAT THIS
  const C3 = "03-beat-this/images";
  // Real runs: the score in the headline is the score in the frame.
  const BEATS = {
    duskrail: { src: "../../trailer/frames/duskrail-end/f00280.jpg", head: "Beat this.", sub: "Duskrail &middot; a real run &middot; 531", crop: 300 },
    snek: { src: frame("snek", 719), head: "Beat 450.", sub: "Snek &middot; a real run &middot; swipe to steer", crop: 0 },
    kingsnare: { src: frame("kingsnare", 400), head: "Beat 375.", sub: "Kingsnare &middot; 90 seconds of checkmates", crop: 0 },
  };
  const beat = (g, w, h, band, L) => {
    const b = BEATS[g];
    const m = G[g];
    return cv(w, h, "#000", `
      <img class="frame" src="${b.src}" style="left:0;top:${band - b.crop * (w / 1080)}px;width:${w}px;height:${(1920 * w) / 1080}px">
      <div class="abs" style="left:0;top:0;width:${w}px;height:${band}px;background:#000"></div>
      <div class="abs" style="left:0;top:${band}px;width:${w}px;height:6px;background:${m.accent}"></div>
      ${lockup(L.x, L.ly, L.lh)}
      ${text(FREE, L.x, L.ly + L.lh * 0.28, L.fs, { cls: "mono dim", align: "right" })}
      ${justified([b.head], L.x, L.hy, w - 2 * L.x)}
      ${text(b.sub, L.x, L.sy, L.fs + 2, { cls: "mono", color: m.accent })}
    `);
  };
  for (const g of Object.keys(BEATS)) {
    add({ id: `03-beat-${g}-9x16`, out: `${C3}/03-beat-${g}-9x16.png`, w: 1080, h: 1920, html: () => beat(g, 1080, 1920, 660, { x: 72, ly: 282, lh: 56, fs: 24, hy: 392, sy: 580 }) });
    add({ id: `03-beat-${g}-4x5`, out: `${C3}/03-beat-${g}-4x5.png`, w: 1080, h: 1350, html: () => beat(g, 1080, 1350, 400, { x: 64, ly: 60, lh: 52, fs: 22, hy: 160, sy: 330 }) });
  }
  add({ id: "03-beat-duskrail-1x1", out: `${C3}/03-beat-duskrail-1x1.png`, w: 1080, h: 1080, html: () => beat("duskrail", 1080, 1080, 360, { x: 64, ly: 56, lh: 48, fs: 22, hy: 146, sy: 296 }) });

  // ======================================================================= 04 ZERO INSTALLS
  const C4 = "04-zero-installs/images";
  const grid = (x, y, cols, size, gx, gy, labels = true, fs = 20) =>
    ORDER.map((g, k) => {
      const cx = x + (k % cols) * (size + gx);
      const cy = y + Math.floor(k / cols) * (size + gy);
      return gicon(g, cx, cy, size) + (labels ? text(G[g].name, cx, cy + size + fs * 0.7, fs, { cls: "mono dim" }) : "");
    }).join("");
  const zero = (x, y, w) => justified(["12 games.", `<span class="heat">0 installs.</span>`], x, y, w);

  add({
    id: "04-grid-9x16", out: `${C4}/04-grid-9x16.png`, w: 1080, h: 1920,
    html: () => cv(1080, 1920, "#000", `<div class="dots"></div>
      ${lockup(72, 282, 56)}
      ${text(FREE, 72, 298, 24, { cls: "mono dim", align: "right" })}
      ${zero(72, 396, 936)}
      ${text("One app. Swipe between them.", 72, 740, 28, { cls: "mono dim" })}
      ${grid(72, 840, 4, 200, 45, 92, true, 24)}
    `),
  });
  add({
    id: "04-grid-4x5", out: `${C4}/04-grid-4x5.png`, w: 1080, h: 1350,
    html: () => cv(1080, 1350, "#000", `<div class="dots"></div>
      ${lockup(64, 64, 52)}
      ${zero(64, 172, 952)}
      ${grid(64, 520, 6, 136, 27, 84, true, 18)}
      ${text("No installs. No menus. No loading bars.<br>Swipe up and the next game is already running.", 64, 1010, 26, { cls: "mono dim", lh: 1.5 })}
      ${text(FREE, 64, 1250, 22, { cls: "mono dim" })}
    `),
  });
  add({
    id: "04-grid-1x1", out: `${C4}/04-grid-1x1.png`, w: 1080, h: 1080,
    html: () => cv(1080, 1080, "#000", `<div class="dots"></div>
      ${zero(64, 72, 952)}
      ${grid(64, 420, 6, 136, 27, 84, true, 18)}
      ${lockup(64, 960, 52)}
      ${text(FREE, 64, 978, 22, { cls: "mono dim", align: "right" })}
    `),
  });
  add({
    id: "04-grid-1200x628", out: `${C4}/04-grid-1200x628.png`, w: 1200, h: 628,
    html: () => cv(1200, 628, "#000", `<div class="dots"></div>
      ${lockup(56, 52, 44)}
      ${justified(["12 games.", `<span class="heat">0 installs.</span>`], 56, 160, 520)}
      ${text(FREE, 56, 560, 20, { cls: "mono dim" })}
      ${grid(600, 106, 4, 128, 16, 16, false)}
    `),
  });

  const USUAL = ["Find it in the store", "Download it", "Wait", "Skip the intro", "Do the tutorial", "Make an account", "Play. Maybe."];
  const usual = (x, y, size, row) =>
    USUAL.map((s, i) => `<div class="abs mono" style="left:${x}px;top:${y + i * row}px;font-size:${size}px;color:var(--paper-dim)">
      <span style="color:var(--paper-mute);margin-right:${size * 0.8}px">${String(i + 1).padStart(2, "0")}</span><span style="text-decoration:line-through;text-decoration-color:var(--paper-mute);text-decoration-thickness:${Math.max(2, size / 14)}px">${s}</span></div>`).join("");
  add({
    id: "04-the-usual-way-9x16", out: `${C4}/04-the-usual-way-9x16.png`, w: 1080, h: 1920,
    html: () => cv(1080, 1920, "#000", `<div class="dots"></div>
      ${lockup(72, 282, 56)}
      ${text(FREE, 72, 298, 24, { cls: "mono dim", align: "right" })}
      ${text("A new game, the usual way", 72, 400, 26, { cls: "mono", color: "var(--paper-mute)" })}
      ${usual(72, 456, 38, 58)}
      <div class="rule" style="left:72px;top:888px;width:936px"></div>
      ${text("A new game on Thumbcade", 72, 920, 26, { cls: "mono", color: "var(--paper-mute)" })}
      ${text(`<span class="mono" style="font-size:38px;color:var(--paper-mute);letter-spacing:.04em;vertical-align:top;margin-right:24px">01</span>Swipe.`, 72, 980, 196, { fit: 936, color: HEAT })}
      ${text("The next game is already running.", 72, 1182, 28, { cls: "mono dim" })}
      ${card("stackd", 72, 1300, 1.0, { chrome: false })} ${card("duskrail", 360 + 72 + 24, 1300, 1.0, { chrome: false })} ${card("snek", 2 * 384 + 72, 1300, 1.0, { chrome: false })}
    `),
  });
  add({
    id: "04-the-usual-way-4x5", out: `${C4}/04-the-usual-way-4x5.png`, w: 1080, h: 1350,
    html: () => cv(1080, 1350, "#000", `<div class="dots"></div>
      ${lockup(64, 64, 52)}
      ${text("A new game, the usual way", 64, 172, 24, { cls: "mono", color: "var(--paper-mute)" })}
      ${usual(64, 222, 36, 54)}
      <div class="rule" style="left:64px;top:628px;width:952px"></div>
      ${text("A new game on Thumbcade", 64, 664, 24, { cls: "mono", color: "var(--paper-mute)" })}
      ${text(`<span class="mono" style="font-size:36px;color:var(--paper-mute);letter-spacing:.04em;vertical-align:top;margin-right:24px">01</span>Swipe.`, 64, 720, 200, { fit: 952, color: HEAT })}
      ${text("The next game is already running.", 64, 940, 28, { cls: "mono dim" })}
      ${text(FREE, 64, 1250, 22, { cls: "mono dim" })}
    `),
  });

  // ======================================================================= 06 SHIP TO THE FEED (creators)
  const C6 = "06-ship-to-the-feed";
  const term = (x, y, w, size, lines) => `<div class="term" style="left:${x}px;top:${y}px;width:${w}px;font-size:${size}px;line-height:${size * 1.7}px">
      <div class="bar3"><i></i><i></i><i></i></div><div class="lines">${lines.map((l) => `<div class="ln">${l}</div>`).join("")}</div></div>`;
  const P = `<span class="mute">$</span> `;
  const SHIP = [
    `${P}npm create thumbcade-game@latest`,
    `<span class="mute">  template</span>  three`,
    `${P}thumbcade dev`,
    `<span class="mute">  simulator running the real feed chrome</span>`,
    `${P}thumbcade publish`,
    `<span class="mute">  review   </span><span style="color:var(--success)">budgets ok &middot; contract ok</span>`,
    `<span class="heat">&#9679;</span> live in the feed<span class="caret" style="width:${0.55}em;height:1em;margin-left:.3em"></span>`,
  ];
  const ENGINES = "Canvas &middot; Phaser &middot; PixiJS &middot; Three.js &middot; HTML";
  add({
    id: "06-terminal-1x1", out: `${C6}/images/06-terminal-1x1.png`, w: 1080, h: 1080,
    html: () => cv(1080, 1080, "#000", `<div class="dots"></div>
      ${lockup(64, 64, 48)}
      ${text("For web game developers", 64, 76, 22, { cls: "mono dim", align: "right" })}
      ${text("Your game<br>in this feed<br><span class=heat>by Friday.</span>", 64, 168, 88, { lh: 0.92 })}
      ${term(64, 470, 952, 27, SHIP)}
      ${text(ENGINES, 64, 990, 22, { cls: "mono dim" })}
      ${text("thumbcade.com/docs", 64, 990, 22, { cls: "mono", align: "right" })}
    `),
  });
  add({
    id: "06-terminal-4x5", out: `${C6}/images/06-terminal-4x5.png`, w: 1080, h: 1350,
    html: () => cv(1080, 1350, "#000", `<div class="dots"></div>
      ${lockup(64, 64, 52)}
      ${text("For web game developers", 64, 80, 22, { cls: "mono dim", align: "right" })}
      ${text("Your game<br>in this feed<br><span class=heat>by Friday.</span>", 64, 180, 104, { lh: 0.92 })}
      ${text("Bring your engine. 8 KB SDK. A simulator that behaves like the phone.", 64, 500, 30, { cls: "body", wrap: true, width: 900, lh: 1.35, style: "color:var(--paper-dim)" })}
      ${term(64, 620, 952, 28, SHIP)}
      ${text(ENGINES, 64, 1250, 22, { cls: "mono dim" })}
      ${text("thumbcade.com/docs", 64, 1250, 22, { cls: "mono", align: "right" })}
    `),
  });
  add({
    id: "06-terminal-1200x628", out: `${C6}/images/06-terminal-1200x628.png`, w: 1200, h: 628,
    html: () => cv(1200, 628, "#000", `<div class="dots"></div>
      ${lockup(56, 52, 40)}
      ${text("Your game<br>in this feed<br><span class=heat>by Friday.</span>", 56, 150, 62, { lh: 0.92 })}
      ${text("For web game developers", 56, 390, 18, { cls: "mono dim" })}
      ${text("thumbcade.com/docs", 56, 560, 20, { cls: "mono" })}
      ${term(560, 52, 590, 18, SHIP)}
    `),
  });

  const STEPS = [
    { n: "01", t: "Scaffold", cmd: "npm create thumbcade-game@latest", body: "Pick a template: Canvas 2D, Phaser, PixiJS, Three.js or blank HTML. You get a small, complete game with the SDK already wired in." },
    { n: "02", t: "Play it in the feed", cmd: "thumbcade dev", body: "The simulator runs your game inside the real feed chrome, with the Swipe Contract enforced live." },
    { n: "03", t: "Ship", cmd: "thumbcade publish", body: "Automated review checks the budgets and the contract. A human plays it. Then it's live. No app update." },
  ];
  add({
    id: "06-carousel", out: `${C6}/carousel/06-carousel-{n}.png`, w: 1080, h: 1080, tiles: 5,
    html: () => {
      let h = `<div class="dots"></div><div class="rule" style="left:64px;top:1012px;width:${4 * 1080 + 952}px;background:rgba(243,240,232,.22)"></div>`;
      // 1: hook
      h += lockup(64, 64, 48);
      h += text("Your web game.<br><span class=heat>In a feed.</span>", 64, 170, 76, { lh: 0.95, fit: 470 });
      h += text("The launch games are built on the same 8 KB SDK you get.", 64, 380, 30, { cls: "body", wrap: true, width: 440, lh: 1.35, style: "color:var(--paper-dim)" });
      h += card("voltbrick", 580, 64, 1.3);
      h += text("For web game developers", 64, 1036, 22, { cls: "mono dim" });
      h += text("3 steps &rarr;", 0, 1036, 22, { cls: "mono dim", style: "left:860px" });
      // 2-4: steps
      STEPS.forEach((s, i) => {
        const X = (i + 1) * 1080;
        h += text(s.n, X + 64, 72, 30, { cls: "mono heat" });
        h += text(s.t, X + 64, 150, 96, { fit: 952 });
        h += term(X + 64, 330, 952, 34, [`${P}${s.cmd}<span class="caret" style="width:.55em;height:1em;margin-left:.3em"></span>`]);
        h += text(s.body, X + 64, 560, 40, { cls: "body", wrap: true, width: 900, lh: 1.32, style: "color:var(--paper-dim)" });
        h += text(`${s.n} / 03`, X + 64, 1036, 22, { cls: "mono dim" });
        h += text("Swipe &rarr;", 0, 1036, 22, { cls: "mono dim", style: `left:${X + 880}px` });
      });
      // 5: budgets + CTA
      const X = 4 * 1080;
      h += text("Any engine.<br>8 KB SDK.", X + 64, 72, 100, { lh: 0.92, fit: 952 });
      const stats = [["SDK", "8 KB", "gzipped, zero deps"], ["Payload", "3 MB", "gzipped, before ready()"], ["Ready in", "2.5 s", "on a mid-range phone"], ["Frame rate", "55+ fps", "in attract mode"]];
      stats.forEach(([k, v, sub], j) => {
        const cx = X + 64 + (j % 2) * 480, cy = 330 + Math.floor(j / 2) * 220;
        h += `<div class="abs" style="left:${cx}px;top:${cy}px;width:452px;height:196px;border:2px solid var(--ink3);border-radius:14px;padding:26px 28px">
          <div class="mono dim" style="font-size:20px">${k}</div><div class="mono" style="font-size:52px;margin-top:14px">${v}</div><div class="body mute" style="font-size:22px;margin-top:8px">${sub}</div></div>`;
      });
      h += lockup(X + 64, 820, 52);
      h += text("thumbcade.com/docs", X + 64, 1036, 22, { cls: "mono" });
      return cv(5400, 1080, "#000", h);
    },
  });

  window.CREATIVES = C;

  window.renderCreative = async (id, tile = 0) => {
    const c = C.find((x) => x.id === id);
    if (!c) throw new Error(`unknown creative ${id}`);
    const stage = document.getElementById("stage");
    stage.style.width = `${c.w}px`;
    stage.style.height = `${c.h}px`;
    stage.innerHTML = c.html();
    const root = stage.firstElementChild;
    if (c.tiles) root.style.transform = `translateX(${-tile * c.w}px)`;
    await KIT.layout(stage);
    return { w: c.w, h: c.h };
  };
})();
