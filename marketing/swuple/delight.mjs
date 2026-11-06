/**
 * App icons you want to tap: tactile objects with material, light and depth, each about swiping up to the next game.
 * Light comes from the top left. Concepts, not final artwork.
 *
 *   node marketing/swuple/delight.mjs       -> marketing/swuple/concepts/delight-overview.png, delight-homescreen.png
 */
import { P, appIcon, f, label, lerp, loadFont, place, text, writeSheet } from "./sketch-kit.mjs";
import { bezier, curve, stroke } from "./swipe-geometry.mjs";

const BODY = loadFont("MonaSans-Medium.ttf");
const SEMI = loadFont("MonaSans-SemiBold.ttf");

let uid = 0;
const id = (p) => `${p}${uid++}`;

/** A radial gradient def, stops as [offset, color, opacity?]. */
const radial = (gid, cx, cy, r, stops, extra = "") =>
  `<radialGradient id="${gid}" cx="${cx}" cy="${cy}" r="${r}" ${extra}>${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`;
const linear = (gid, x1, y1, x2, y2, stops, extra = "") =>
  `<linearGradient id="${gid}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}>${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
const blur = (fid, sd) => `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

/** The stage most icons sit on: deep ink, a little lighter where the light falls. */
function inkStage() {
  const g = id("stage");
  return { defs: radial(g, "0.35", "0.25", "0.95", [[0, "#26262E"], [0.55, "#121216"], [1, "#060608"]]), fill: `url(#${g})` };
}
const iconOn = (stage, body) => appIcon(`<defs>${stage.defs}</defs><rect width="1024" height="1024" fill="${stage.fill}"/>${body}`, P.ink1);

// ---------------------------------------------------------------------------
// 1 The joystick, pushed up
// ---------------------------------------------------------------------------

function joystick() {
  const [ball, ballHi, shaft, plate, side, shadow] = ["j-ball", "j-hi", "j-shaft", "j-plate", "j-side", "j-sh"].map(id);
  const [bx, by, br] = [578, 330, 204];
  const [px, py, prx, pry, depth] = [512, 740, 350, 132, 46];
  /** An arc of the plate's rim, angles in degrees (0 = right, -90 = the back edge). */
  const arc = (cx, cy, rx, ry, a0, a1) => {
    const pt = (a) => [cx + rx * Math.cos((a * Math.PI) / 180), cy + ry * Math.sin((a * Math.PI) / 180)].map(f).join(" ");
    return `M${pt(a0)}A${rx} ${ry} 0 0 1 ${pt(a1)}`;
  };
  // Direction marks on the plate, in perspective; up is the back of the rim, lit.
  const mark = (x, y, rot, fill) => `<path d="M0 -26 L30 18 L-30 18 Z" fill="${fill}" transform="translate(${x} ${y}) rotate(${rot}) scale(1 ${rot % 180 ? 1 : 0.55})"/>`;
  return iconOn(
    inkStage(),
    `<defs>
      ${radial(ball, "0.36", "0.3", "0.8", [[0, "#FFB2A8"], [0.18, "#FF6A5C"], [0.55, P.heat], [0.85, "#B8261C"], [1, "#6E120C"]])}
      ${radial(ballHi, "0.5", "0.5", "0.5", [[0, "#FFFFFF", 0.95], [1, "#FFFFFF", 0]])}
      ${linear(shaft, 0, 0, 1, 0, [[0, "#2A2A30"], [0.3, "#A9A9B2"], [0.5, "#EDEDF2"], [1, "#35353D"]])}
      ${radial(plate, "0.45", "0.25", "0.75", [[0, "#3C3C46"], [0.65, "#1C1C22"], [1, "#0E0E12"]])}
      ${linear(side, 0, 0, 0, 1, [[0, "#26262D"], [1, "#09090B"]])}
      ${blur(shadow, 26)}
    </defs>
    <ellipse cx="${px}" cy="${py + depth + 30}" rx="${prx + 10}" ry="${pry}" fill="#000" opacity="0.65" filter="url(#${shadow})"/>
    <path d="M${px - prx} ${py} V${py + depth} A${prx} ${pry} 0 0 0 ${px + prx} ${py + depth} V${py} Z" fill="url(#${side})"/>
    <ellipse cx="${px}" cy="${py}" rx="${prx}" ry="${pry}" fill="url(#${plate})"/>
    <ellipse cx="${px}" cy="${py - 2}" rx="${prx - 3}" ry="${pry - 3}" fill="none" stroke="#5A5A66" stroke-width="5" opacity="0.7"/>
    ${mark(px - 238, py, -90, "#4A4A55")}${mark(px + 238, py, 90, "#4A4A55")}${mark(px, py + 96, 180, "#4A4A55")}
    <path d="${arc(px, py - 2, prx - 3, pry - 3, -142, -38)}" fill="none" stroke="${P.heat}" stroke-width="12" stroke-linecap="round"/>
    <ellipse cx="${px}" cy="${py}" rx="112" ry="44" fill="#08080A"/>
    <path d="M${px - 34} ${py} L${px + 34} ${py} L ${bx + 30} ${by + 150} L ${bx - 30} ${by + 150} Z" fill="url(#${shaft})"/>
    <ellipse cx="${bx + 34}" cy="${by + 170}" rx="150" ry="40" fill="#000" opacity="0.35" filter="url(#${shadow})"/>
    <circle cx="${bx}" cy="${by}" r="${br}" fill="url(#${ball})"/>
    <ellipse cx="${bx - 72}" cy="${by - 96}" rx="76" ry="48" fill="url(#${ballHi})" transform="rotate(-28 ${bx - 72} ${by - 96})"/>
    <path d="M${bx - 156} ${by + 62} A ${br - 22} ${br - 22} 0 0 0 ${bx + 92} ${by + 166}" fill="none" stroke="#FF9A8E" stroke-width="10" stroke-linecap="round" opacity="0.45"/>`,
  );
}

// ---------------------------------------------------------------------------
// 2 The candy swipe: the swipe's S as a glossy tube
// ---------------------------------------------------------------------------

const CANDY = curve({ from: [376, 880], to: [650, 150], bend: 1.6 });
function tube(pts, w, layers) {
  return layers.map(([dw, dx, dy, fill, o = 1, filt = ""]) => `<path d="${stroke(pts, w * dw, w * dw)}" fill="${fill}" opacity="${o}" transform="translate(${dx} ${dy})" ${filt}/>`).join("");
}
function candy() {
  const [soft, softer, hi] = [id("c-b"), id("c-b2"), id("c-hi")];
  return iconOn(
    inkStage(),
    `<defs>${blur(soft, 22)}${blur(softer, 9)}${blur(hi, 5)}</defs>
    ${tube(CANDY, 210, [
      [1.04, 26, 40, "#000", 0.55, `filter="url(#${soft})"`],
      [1, 0, 0, "#7E140E"],
      [0.9, -6, -7, "#C2271C"],
      [0.74, -12, -14, P.heat, 1, `filter="url(#${softer})"`],
      [0.44, -20, -24, "#FF8576", 0.9, `filter="url(#${softer})"`],
      [0.13, -34, -40, "#FFFFFF", 0.85, `filter="url(#${hi})"`],
    ])}`,
  );
}

// ---------------------------------------------------------------------------
// 3 The button: the arcade button from the start, as an object you can press, the swipe engraved on its cap
// ---------------------------------------------------------------------------

function button() {
  const [bezel, bezelSide, capTop, capSide, hi, soft] = ["k-bz", "k-bzs", "k-top", "k-side", "k-hi", "k-soft"].map(id);
  const [cx, cy, rx, ry] = [512, 560, 380, 262];
  const [crx, cry, lift] = [290, 200, 92];
  const capY = cy - 26;
  // The swipe, squashed onto the cap's tilted face.
  const s = curve({ from: [452, 690], to: [576, 330], bend: 1.6 });
  const onCap = (d) => `<g transform="translate(0 ${capY - lift}) scale(1 ${cry / crx}) translate(0 ${-512})">${d}</g>`;
  return iconOn(
    inkStage(),
    `<defs>
      ${radial(bezel, "0.45", "0.25", "0.8", [[0, "#3E3E48"], [0.6, "#1E1E24"], [1, "#0C0C0F"]])}
      ${linear(bezelSide, 0, 0, 0, 1, [[0, "#22222A"], [1, "#060608"]])}
      ${radial(capTop, "0.36", "0.25", "0.85", [[0, "#FF9C90"], [0.35, "#FF5A4B"], [0.75, P.heat], [1, "#C42A1F"]])}
      ${linear(capSide, 0, 0, 1, 0, [[0, "#6E120C"], [0.3, "#B8261C"], [0.6, "#D6342A"], [1, "#5E100B"]])}
      ${radial(hi, "0.5", "0.5", "0.5", [[0, "#FFFFFF", 0.9], [1, "#FFFFFF", 0]])}
      ${blur(soft, 24)}
    </defs>
    <ellipse cx="${cx}" cy="${cy + 90}" rx="${rx + 10}" ry="${ry}" fill="#000" opacity="0.6" filter="url(#${soft})"/>
    <path d="M${cx - rx} ${cy} V${cy + 58} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy + 58} V${cy} Z" fill="url(#${bezelSide})"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${bezel})"/>
    <ellipse cx="${cx}" cy="${cy - 2}" rx="${rx - 4}" ry="${ry - 4}" fill="none" stroke="#5A5A66" stroke-width="5" opacity="0.6"/>
    <ellipse cx="${cx}" cy="${capY + 14}" rx="${crx + 22}" ry="${cry + 18}" fill="#050506"/>
    <path d="M${cx - crx} ${capY} V${capY - lift} A${crx} ${cry} 0 0 1 ${cx + crx} ${capY - lift} V${capY} A${crx} ${cry} 0 0 1 ${cx - crx} ${capY} Z" fill="url(#${capSide})"/>
    <ellipse cx="${cx}" cy="${capY - lift}" rx="${crx}" ry="${cry}" fill="url(#${capTop})"/>
    ${onCap(`<path d="${stroke(s, 82, 82)}" fill="#7E140E" opacity="0.55" transform="translate(-5 -7)"/><path d="${stroke(s, 82, 82)}" fill="#FFD9D3" opacity="0.9"/>`)}
    <ellipse cx="${cx - 110}" cy="${capY - lift - 96}" rx="96" ry="38" fill="url(#${hi})" transform="rotate(-14 ${cx - 110} ${capY - lift - 96})"/>`,
  );
}

// ---------------------------------------------------------------------------
// 4 The ruby: a gem cut as an arrow pointing up
// ---------------------------------------------------------------------------

function ruby() {
  const [glow, spark] = [id("r-glow"), id("r-sp")];
  // Outline: apex, crown shoulders, girdle corners, pavilion point (short: the gem points up).
  const A = [512, 120], L1 = [250, 470], R1 = [774, 470], L2 = [300, 600], R2 = [724, 600], B = [512, 900];
  const T1 = [420, 420], T2 = [604, 420], M = [512, 560];
  const facet = (pts, fill, o = 1) => `<path d="M${pts.map((p) => p.join(" ")).join("L")}Z" fill="${fill}" opacity="${o}"/>`;
  const star = (x, y, r) => `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z" fill="#FFFFFF"/>`;
  return iconOn(
    inkStage(),
    `<defs>${radial(glow, "0.5", "0.5", "0.5", [[0, P.heat, 0.4], [1, P.heat, 0]])}${blur(spark, 3)}</defs>
    <circle cx="512" cy="520" r="430" fill="url(#${glow})"/>
    ${facet([A, T1, L1], "#FF7C6E")}${facet([A, T2, T1], "#FFB0A6")}${facet([A, R1, T2], "#E5372B")}
    ${facet([T1, M, L1], "#FF5A4C")}${facet([T1, T2, M], "#FF8E82")}${facet([T2, R1, M], "#C42A1F")}
    ${facet([L1, M, L2], "#D93226")}${facet([M, R1, R2], "#8F1A12")}${facet([L2, M, B], "#B2241A")}${facet([M, R2, B], "#6A120C")}
    <path d="M${[A, R1, R2, B, L2, L1].map((p) => p.join(" ")).join("L")}Z" fill="none" stroke="#FFD2CC" stroke-width="4" stroke-linejoin="round" opacity="0.5"/>
    ${star(452, 250, 46)}${star(708, 640, 26)}${star(330, 760, 18)}`,
  );
}

// ---------------------------------------------------------------------------
// 5 The token: insert coin. Red enamel, a bright rim, the swipe embossed.
// ---------------------------------------------------------------------------

function token() {
  const [rim, enamel, edge, shine, soft] = [id("t-rim"), id("t-en"), id("t-edge"), id("t-sh"), id("t-soft")];
  const [cx, cy, rx, ry, depth] = [512, 470, 360, 330, 64];
  const emb = curve({ from: [452, 610], to: [578, 270], bend: 1.6 });
  return iconOn(
    inkStage(),
    `<defs>
      ${linear(rim, 0, 0, 1, 1, [[0, "#FFFFFF"], [0.3, "#E7E3DA"], [0.6, "#A9A49A"], [1, "#6E6A62"]])}
      ${radial(enamel, "0.38", "0.3", "0.85", [[0, "#FF8072"], [0.45, P.heat], [1, "#A01E15"]])}
      ${linear(edge, 0, 0, 1, 0, [[0, "#5C5850"], [0.4, "#BDB8AE"], [1, "#4A4740"]])}
      ${linear(shine, 0, 0, 1, 1, [[0, "#FFFFFF", 0], [0.45, "#FFFFFF", 0], [0.5, "#FFFFFF", 0.35], [0.56, "#FFFFFF", 0], [1, "#FFFFFF", 0]])}
      ${blur(soft, 24)}
    </defs>
    <ellipse cx="${cx + 20}" cy="${cy + depth + 70}" rx="${rx}" ry="${ry * 0.5}" fill="#000" opacity="0.6" filter="url(#${soft})"/>
    <path d="M${cx - rx} ${cy} V${cy + depth} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy + depth} V${cy} Z" fill="url(#${edge})"/>
    ${Array.from({ length: 36 }, (_, i) => {
      const a = Math.PI * (i / 35);
      const x = cx - rx * Math.cos(a);
      const y = cy + ry * Math.sin(a);
      return `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x)}" y2="${f(y + depth)}" stroke="#2E2C28" stroke-width="5" opacity="0.5"/>`;
    }).join("")}
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${rim})"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx - 46}" ry="${ry - 44}" fill="url(#${enamel})"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx - 46}" ry="${ry - 44}" fill="none" stroke="#5A0E09" stroke-width="6" opacity="0.6"/>
    <path d="${stroke(emb, 96, 96)}" fill="#6E120C" transform="translate(6 8)" opacity="0.8"/>
    <path d="${stroke(emb, 96, 96)}" fill="url(#${rim})"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${shine})"/>`,
  );
}

// ---------------------------------------------------------------------------
// 6 The glass swipe: iOS's layered glass, a frosted S over hot red
// ---------------------------------------------------------------------------

const GLASS = curve({ from: [400, 1080], to: [640, -60], bend: 1.45 });
function glass() {
  const [bg, light, frost, rimG, soft, hiBlur] = [id("g-bg"), id("g-light"), id("g-frost"), id("g-rim"), id("g-soft"), id("g-hb")];
  const d = stroke(GLASS, 200, 200);
  return appIcon(
    `<defs>
      ${linear(bg, 0, 0, 1, 1, [[0, "#FF7A5C"], [0.5, P.heat], [1, "#C21E14"]])}
      ${radial(light, "0.3", "0.15", "0.7", [[0, "#FFFFFF", 0.35], [1, "#FFFFFF", 0]])}
      ${linear(frost, 0, 0, 1, 1, [[0, "#FFFFFF", 0.62], [0.5, "#FFFFFF", 0.34], [1, "#FFFFFF", 0.22]])}
      ${linear(rimG, 0, 0, 1, 1, [[0, "#FFFFFF", 1], [0.4, "#FFFFFF", 0.3], [0.6, "#FFFFFF", 0.1], [1, "#FFFFFF", 0.7]])}
      ${blur(soft, 28)}${blur(hiBlur, 8)}
    </defs>
    <rect width="1024" height="1024" fill="url(#${bg})"/><rect width="1024" height="1024" fill="url(#${light})"/>
    <path d="${d}" fill="#7A0F08" opacity="0.45" transform="translate(26 36)" filter="url(#${soft})"/>
    <path d="${d}" fill="url(#${frost})"/>
    <path d="${d}" fill="none" stroke="url(#${rimG})" stroke-width="14"/>
    <path d="${stroke(GLASS, 34, 34)}" fill="#FFFFFF" opacity="0.5" transform="translate(-52 -18)" filter="url(#${hiBlur})"/>`,
    P.heat,
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const ICONS = [
  { name: "THE JOYSTICK", line: "The arcade stick, pushed up. You want to grab it.", draw: joystick },
  { name: "THE CANDY SWIPE", line: "The swipe as a glossy tube you could bite.", draw: candy },
  { name: "THE BUTTON", line: "The arcade button you can press, the swipe on its cap.", draw: button },
  { name: "THE RUBY", line: "Loot. A gem cut as an arrow pointing up.", draw: ruby },
  { name: "THE TOKEN", line: "Insert coin: red enamel, the swipe embossed.", draw: token },
  { name: "THE GLASS SWIPE", line: "iOS's layered glass: a frosted S on hot red.", draw: glass },
];
const arts = ICONS.map((c) => c.draw());

// Overview: big icons, names, one line each.
{
  const W = 2400, H = 1640;
  let o = `<rect width="${W}" height="${H}" fill="#000000"/>`;
  o += `<path d="${text("Icons you want to tap", 64, 110, 150).d}" fill="${P.paper}"/>`;
  arts.forEach((art, i) => {
    const x = 110 + (i % 3) * 760, y = 230 + Math.floor(i / 3) * 690;
    o += place(art, x, y, 520);
    o += label(`${i + 1}  ${ICONS[i].name}`, x, y + 580, P.paper, 26);
    o += `<path d="${text(ICONS[i].line, 26, x, y + 625, { font: BODY, tracking: 0 }).d}" fill="${P.paperDim}"/>`;
  });
  await writeSheet(o, W, H, "delight-overview.png");
}

// Home screens: every candidate at real size among neutral placeholder apps, on a dark and a light wallpaper.
{
  const W = 2400, H = 1500;
  const ICON = 180, GAP = 82, COLS = 4;
  const placeholder = (x, y, i, light) => {
    const tones = light ? ["#D9D5CC", "#C9C4BA", "#E4E0D8", "#BDB8AE"] : ["#2A2A31", "#34343C", "#202026", "#3A3A44"];
    const glyphs = [`<circle cx="0.5" cy="0.5" r="0.2"/>`, `<rect x="0.3" y="0.3" width="0.4" height="0.4" rx="0.08"/>`, `<path d="M0.5 0.28 L0.72 0.68 L0.28 0.68Z"/>`, `<rect x="0.26" y="0.44" width="0.48" height="0.12" rx="0.06"/>`];
    return `<g transform="translate(${x} ${y}) scale(${ICON})"><rect width="1" height="1" rx="0.2237" fill="${tones[i % 4]}"/><g fill="${light ? "#FFFFFF" : "#55555F"}" opacity="0.8">${glyphs[i % 4]}</g></g>`;
  };
  const appLabel = (str, x, y, light) => `<path d="${text(str, 24, 0, 0, { font: SEMI, tracking: 0 }).d}" transform="translate(${x + ICON / 2 - text(str, 24, 0, 0, { font: SEMI, tracking: 0 }).width / 2} ${y + ICON + 38})" fill="${light ? "#1A1A1F" : "#FFFFFF"}"/>`;
  let h = `<rect width="${W}" height="${H}" fill="#000000"/>`;
  for (const [wi, light] of [false, true].entries()) {
    const x0 = 80 + wi * 1180, y0 = 80;
    const wg = id("wall");
    h += `<defs>${linear(wg, 0, 0, 1, 1, light ? [[0, "#F6F1E7"], [1, "#D8D2C6"]] : [[0, "#1B1730"], [0.6, "#0E0E14"], [1, "#2A1410"]])}</defs>`;
    h += `<rect x="${x0}" y="${y0}" width="1080" height="1340" rx="60" fill="url(#${wg})"/>`;
    // Rows of four: the six candidates fill the first two rows, placeholders around them.
    const slots = 16;
    for (let s = 0; s < slots; s++) {
      const cx = x0 + 80 + (s % COLS) * (ICON + GAP), cy = y0 + 70 + Math.floor(s / COLS) * (ICON + 110);
      const cand = s < 6 ? s : -1;
      if (cand >= 0) {
        h += place(arts[cand], cx, cy, ICON);
        h += appLabel(`${cand + 1} swuple`, cx, cy, light);
      } else {
        h += placeholder(cx, cy, s, light);
        h += appLabel("App", cx, cy, light);
      }
    }
  }
  await writeSheet(h, W, H, "delight-homescreen.png");
}
