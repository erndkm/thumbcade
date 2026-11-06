// Builds the Thumbcade playable ad: three real launch games in a mini feed, one self-contained HTML
// file per ad network. Game sources are built with Vite exactly as they ship, plus two in-memory
// patches (never written to disk): the kit fonts resolve to strings the shell injects once, and the
// SDK's standalone fallback never fetches its manifest.
//
//   node marketing/studio/playable/build.mjs
//
// Writes marketing/campaigns/05-the-ad-is-the-game/:
//   thumbcade-playable-meta.html     Meta (FbPlayableAd.onCTAClick), hard limit 2 MB
//   thumbcade-playable-mraid.html    AppLovin, Unity, ironSource, Mintegral, Liftoff (MRAID 2.0, mraid.open)
//   thumbcade-playable-tiktok.zip    TikTok Smart+ App Promotion (index.html + config.json, window.openAppStore)
//   thumbcade-playable-google.zip    Google App campaigns HTML5 (exitapi.js, ExitApi.exit)
//   thumbcade-playable-preview.html  local preview with a CTA toast (what the overview page embeds)
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import subsetFont from "subset-font";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../..");
const OUT = path.join(REPO, "marketing/campaigns/05-the-ad-is-the-game");
const { build } = await import(pathToFileURL(`${REPO}/node_modules/vite/dist/node/index.js`).href);
const sharp = createRequire(`${REPO}/games/_kit/package.json`)("sharp");

/** The feed, in order. All three take taps only (`controls.vertical: false`), so a swipe up is never ambiguous. */
const FEED = ["stackd", "flapjack", "kneejerk"];
/** Every launch game, for the end card's "3 of 12" row. */
const ALL = ["stackd", "flapjack", "kneejerk", "duskrail", "neon-chop", "snek", "voltbrick", "heatfall", "shortwick", "pairs", "kingsnare", "mines"];
/** Per network: the click-through call lives in src/adapter-<name>.js; these are the extra tags each one needs. */
const NETWORKS = {
  meta: { file: "thumbcade-playable-meta.html", limit: 2 * 1024 * 1024 },
  mraid: { file: "thumbcade-playable-mraid.html", limit: 5 * 1024 * 1024, head: '<script src="mraid.js"></script>' },
  tiktok: {
    zip: "thumbcade-playable-tiktok.zip",
    limit: 5 * 1024 * 1024,
    // TikTok's playable SDK goes at the bottom of <body>, before our own scripts (ads.tiktok.com/help/article/playable-ads).
    sdk: '<script src="https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/Playable/sdk/Playable-sdk.js"></script>',
    extra: { "config.json": `${JSON.stringify({ Playable_orientation: 1 })}\n` },
  },
  google: {
    zip: "thumbcade-playable-google.zip",
    limit: 5 * 1024 * 1024,
    head:
      '<meta name="ad.orientation" content="portrait">' +
      '<script type="text/javascript" src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>',
  },
  preview: {
    file: "thumbcade-playable-preview.html",
    limit: 5 * 1024 * 1024,
    // The preview enforces "no network" itself, so a local check proves what the ad networks require.
    head:
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; ' +
      'img-src data: blob:; font-src data:; media-src data: blob:; connect-src \'none\'">',
  },
};

const read = (p) => fs.readFileSync(p);
const b64 = (buf, mime) => `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;

// ------------------------------------------------------------------ games
/** Whole sentences of the manifest description that fit a two-line feed caption (the app truncates; an ad shouldn't). */
function caption(text, max = 80) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = "";
  for (const s of sentences.map((x) => x.trim())) {
    if (out && (out + " " + s).length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out;
}
async function buildGame(slug) {
  const root = `${REPO}/games/${slug}`;
  let patched = 0;
  const plugin = {
    name: "playable-patch",
    enforce: "pre",
    // The kit's two fonts become `globalThis.__TCF.*`: the shell holds one copy and injects it into each frame.
    resolveId(id) {
      const m = /assets\/fonts\/(display|mono)\.woff2\?url$/.exec(id);
      return m ? `\0tc-font:${m[1]}` : null;
    },
    load(id) {
      if (!id.startsWith("\0tc-font:")) return null;
      patched++;
      return `export default (globalThis.__TCF && globalThis.__TCF.${id.slice(9)}) || "";`;
    },
    transform(code, id) {
      if (!id.endsWith("/packages/sdk/src/standalone.ts")) return null;
      // The standalone host (only reached if the shell never answers) must not make a network request.
      const next = code
        .replace(/win\s*\.fetch\("thumbcade\.json"\)/, () => (patched++, 'Promise.resolve({ ok: false, json: () => null } as unknown as Response)'))
        .replace("doc.body.appendChild(hud);", () => (patched++, 'hud.style.display = "none"; doc.body.appendChild(hud);'))
        .replace("return win.localStorage;", () => (patched++, "return null;"));
      return next;
    },
  };
  const result = await build({
    root,
    configFile: `${root}/vite.config.ts`,
    logLevel: "warn",
    plugins: [plugin],
    build: {
      write: false,
      minify: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunks = output.filter((o) => o.type === "chunk");
  if (chunks.length !== 1) throw new Error(`${slug}: expected one JS chunk, got ${chunks.map((c) => c.fileName).join(", ")}`);
  const asset = (name) => output.find((o) => o.type === "asset" && o.fileName === name);
  const css = output.filter((o) => o.type === "asset" && o.fileName.endsWith(".css")).map((o) => String(o.source)).join("\n");
  const html = String(asset("index.html").source);
  const headStyle = (/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "").trim();
  const bodyHtml = (/<body[^>]*>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? "").replace(/<script[\s\S]*?<\/script>/g, "").trim();
  const manifest = JSON.parse(String(asset("thumbcade.json").source));
  const libraries = String(asset("licenses/libraries.txt")?.source ?? "").trim();
  let code = chunks[0].code;
  if (/\bfetch\(|XMLHttpRequest|importScripts|new Worker\(/.test(code)) console.warn(`  ! ${slug}: bundle mentions a network API, check it`);
  // Raw-text safety inside <script> blocks: never close the element or open an HTML comment.
  code = code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
  if (patched < 4) throw new Error(`${slug}: only ${patched} patches applied (fonts + standalone)`);
  return {
    slug,
    code,
    css,
    headStyle,
    bodyHtml,
    bg: /background:\s*(#[0-9a-fA-F]{3,8})/.exec(headStyle)?.[1] ?? "#000000",
    meta: {
      slug,
      name: manifest.name,
      description: caption(manifest.description),
      accent: manifest.accentColor,
      tags: manifest.tags.slice(0, 3),
      order: manifest.score?.order ?? "desc",
    },
    libraries,
  };
}

// ------------------------------------------------------------------ fonts and art
async function shellAssets() {
  const tokensFonts = `${REPO}/packages/design-tokens/fonts/web`;
  const kitFonts = `${REPO}/games/_kit/assets/fonts`;
  // Mona Sans for UI text: printable ASCII plus the few marks the copy uses, width pinned to normal.
  const chars = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") + "·–—’“”…→↑";
  const ui = await subsetFont(read(`${tokensFonts}/MonaSansVF.woff2`), chars, {
    targetFormat: "woff2",
    variationAxes: { wght: { min: 500, max: 700 }, wdth: 100 },
  });
  const fonts = {
    // The kit's own faces, shared by the shell and every game frame.
    display: b64(read(`${kitFonts}/display.woff2`), "font/woff2"),
    mono: b64(read(`${kitFonts}/mono.woff2`), "font/woff2"),
    ui: b64(ui, "font/woff2"),
  };
  const icons = {};
  for (const g of ALL) {
    const src = `${REPO}/dist/games/${g}/bundle/assets/icon.png`;
    if (!fs.existsSync(src)) throw new Error(`missing ${src}: run pnpm games:build first`);
    icons[g] = b64(await sharp(read(src)).resize(112, 112).webp({ quality: 82, alphaQuality: 90 }).toBuffer(), "image/webp");
  }
  const mark = fs.readFileSync(`${REPO}/packages/design-tokens/brand/mark.svg`, "utf8").trim();
  const wordmark = fs.readFileSync(`${REPO}/packages/design-tokens/brand/wordmark.svg`, "utf8").trim();
  const licenses = {
    mona: fs.readFileSync(`${REPO}/packages/design-tokens/fonts/OFL-MonaSans.txt`, "utf8").trim(),
    departure: fs.readFileSync(`${REPO}/packages/design-tokens/fonts/OFL-DepartureMono.txt`, "utf8").trim(),
  };
  return { fonts, icons, mark, wordmark, licenses };
}

// ------------------------------------------------------------------ assemble
/** Explicit end tags in inline SVG (`<path></path>`, not `<path/>`): Google's HTML5 validator rejects self-closing forms. */
const explicitEnds = (svgText) => svgText.replace(/<([a-zA-Z][\w:-]*)([^<>]*?)\s*\/>/g, "<$1$2></$1>");

function assemble(name, net, games, assets) {
  const src = (f) => fs.readFileSync(path.join(HERE, "src", f), "utf8");
  const data = {
    network: name,
    feed: games.map((g) => ({ ...g.meta, bg: g.bg, headStyle: g.headStyle, css: g.css, body: g.bodyHtml })),
    all: ALL,
    icons: assets.icons,
    fonts: assets.fonts,
  };
  // JSON inside a classic <script>: escape "<" so no sequence can end the element.
  const dataJs = `window.TC_PLAYABLE = ${JSON.stringify(data).replace(/</g, "\\u003c")};`;
  const gameBlocks = games.map((g) => `<script type="text/x-tc-game" id="tc-game-${g.slug}">${g.code}</script>`).join("\n");
  const notices = [
    "Third-party notices",
    "",
    'Fonts: Mona Sans (an ASCII subset; the title face "TC Display" is a renamed printable-ASCII subset of Mona Sans Display Expanded Black) and Departure Mono, both under the SIL Open Font License 1.1:',
    "",
    assets.licenses.mona,
    "",
    assets.licenses.departure,
    "",
    ...games.filter((g) => g.libraries).map((g) => `Libraries bundled in ${g.meta.name}:\n${g.libraries}`),
  ].join("\n").replace(/--/g, "- -");
  // The mark appears twice (landscape side panel, end card): each copy needs its own gradient ids, or the
  // copy inside a hidden panel swallows the references and the other renders flat.
  let copies = 0;
  const markCopy = () => {
    const p = `mk${++copies}`;
    return explicitEnds(assets.mark).replace(/<svg /, '<svg aria-hidden="true" ').replace(/(id="|url\(#)m-/g, `$1${p}-`);
  };
  const wordmark = explicitEnds(assets.wordmark).replace(/<svg /, '<svg aria-hidden="true" ');
  return src("shell.html")
    .replace("<!--HEAD-->", () => net.head ?? "")
    .replace("/*CSS*/", () => src("shell.css"))
    .replaceAll("<!--MARK-->", () => markCopy())
    .replaceAll("<!--WORDMARK-->", () => wordmark)
    .replace("<!--GAMES-->", () => gameBlocks)
    .replace("<!--SDK-->", () => net.sdk ?? "")
    // Only the MRAID build navigates by itself; the others never carry store URLs.
    .replace("/*CONFIG*/", () => (name === "mraid" ? src("config.js") : ""))
    .replace("/*DATA*/", () => dataJs)
    .replace("/*PROBE*/", () => JSON.stringify(src("probe.js")).replace(/</g, "\\u003c"))
    .replace("/*ADAPTER*/", () => src(`adapter-${name}.js`))
    .replace("/*SHELL*/", () => src("shell.js"))
    .replace("<!--NOTICES-->", () => `<!--\n${notices}\n-->`);
}

/** Minimal ZIP writer (deflate, no extra fields): enough for the ad networks' uploaders. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 17;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const crc = zlib.crc32(raw);
    const fname = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fname.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(fname.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fname, deflated);
    centrals.push(central, fname);
    offset += local.length + fname.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const t0 = Date.now();
const games = [];
for (const g of FEED) {
  const built = await buildGame(g);
  console.log(`built ${g}: ${(built.code.length / 1024).toFixed(0)} KB JS`);
  games.push(built);
}
const assets = await shellAssets();
fs.mkdirSync(OUT, { recursive: true });
// Unzipped copies of the zip variants, for verify.mjs.
const STAGING = path.join(HERE, ".cache");
fs.rmSync(STAGING, { recursive: true, force: true });
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
for (const [name, net] of Object.entries(NETWORKS)) {
  const html = assemble(name, net, games, assets);
  const htmlBytes = Buffer.byteLength(html);
  let file, bytes;
  if (net.zip) {
    const dir = path.join(STAGING, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
    for (const [k, v] of Object.entries(net.extra ?? {})) fs.writeFileSync(path.join(dir, k), v);
    const buf = zip({ "index.html": html, ...(net.extra ?? {}) });
    file = path.join(OUT, net.zip);
    fs.writeFileSync(file, buf);
    bytes = buf.length;
  } else {
    file = path.join(OUT, net.file);
    fs.writeFileSync(file, html);
    bytes = htmlBytes;
  }
  console.log(`${path.relative(REPO, file)}: ${bytes} bytes (${mb(bytes)} of ${mb(net.limit)})${net.zip ? `, index.html ${htmlBytes} bytes` : ""}`);
  if (bytes > net.limit) throw new Error(`${name} build is over its ${net.limit} byte limit`);
  if (name === "meta" && htmlBytes > 2 * 1024 * 1024) throw new Error("Meta's single HTML must stay under 2 MB");
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
