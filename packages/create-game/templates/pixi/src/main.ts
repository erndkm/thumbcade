/**
 * __NAME__ — a PixiJS starter: bubbles drift up, tap them before they escape. Three escapes end the run.
 * Shows how to wire Pixi into Thumbcade: no auto-started ticker (tc.loop renders, so pause stops
 * rendering), insets for layout, and a run that starts on a tap.
 */
import "pixi.js/unsafe-eval"; // despite the name, this lets Pixi run without eval (the game CSP forbids it)
import { Application, Container, Graphics, Text, Ticker } from "pixi.js";
import { thumbcade as tc } from "@thumbcade/sdk";
import { createSound } from "./sound.ts";
import { onTap } from "./tap.ts";

const ACCENT = "__ACCENT__";
const PAPER = "#F3F0E8";

const ctx = await tc.init();
const sound = createSound();
let best = Math.max(ctx.best ?? 0, (await tc.storage.get<number>("best").catch(() => null)) ?? 0);

const app = new Application();
await app.init({
  resizeTo: window,
  background: "__BG__",
  antialias: true,
  autoStart: false, // tc.loop drives rendering
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
// Pixi's own tickers would keep requestAnimationFrame running through a pause (Swipe Contract rule 5).
// Stop them all and drive Pixi from tc.loop instead.
app.ticker.stop();
for (const t of [Ticker.shared, Ticker.system]) {
  t.autoStart = false;
  t.stop();
}
document.body.appendChild(app.canvas);

type Phase = "attract" | "playing" | "over";
interface Bubble {
  g: Graphics;
  r: number;
  vy: number;
  wobble: number;
}
let phase: Phase = "attract";
let bubbles: Bubble[] = [];
let spawnIn = 0;
let rise = 90;
let score = 0;
let escapes = 0;
let time = 0;

const field = new Container();
app.stage.addChild(field);
const style = { fontFamily: "system-ui, sans-serif", fontWeight: "900", fill: PAPER } as const;
const title = new Text({ text: "__NAME_UPPER__", style: { ...style, fontSize: 44, fill: ACCENT } });
const bestText = new Text({ text: "", style: { ...style, fontSize: 14 } });
const prompt = new Text({ text: "TAP TO PLAY", style: { ...style, fontSize: 16 } });
const hud = new Text({ text: "", style: { ...style, fontSize: 40 } });
for (const t of [title, bestText, prompt, hud]) {
  t.anchor.set(0.5);
  app.stage.addChild(t);
}

function layout() {
  const W = app.screen.width;
  const H = app.screen.height;
  const p = ctx.insets.preview; // what the feed overlay covers before a run
  const cx = (p.left + W - p.right) / 2;
  title.position.set(cx, p.top + 70);
  bestText.position.set(cx, p.top + 112);
  prompt.position.set(cx, H - p.bottom - 40);
  hud.position.set(W / 2, tc.insets.top + 48);
  title.visible = prompt.visible = phase === "attract";
  bestText.visible = phase === "attract" && best > 0;
  bestText.text = `BEST ${best}`;
  hud.visible = phase === "playing";
  hud.text = `${score}`;
}

function spawn() {
  const r = 22 + Math.random() * 18;
  const g = new Graphics().circle(0, 0, r).fill({ color: ACCENT, alpha: 0.25 }).stroke({ color: ACCENT, width: 3 });
  g.position.set(r + Math.random() * (app.screen.width - r * 2), app.screen.height + r);
  field.addChild(g);
  bubbles.push({ g, r, vy: rise * (0.8 + Math.random() * 0.4), wobble: Math.random() * 6 });
}

function pop(b: Bubble) {
  field.removeChild(b.g);
  b.g.destroy();
  bubbles = bubbles.filter((x) => x !== b);
}

function start() {
  if (phase === "playing") return;
  bubbles.slice().forEach(pop);
  score = 0;
  escapes = 0;
  rise = 90;
  spawnIn = 0.3;
  phase = "playing";
  tc.gameplay.start(); // on the tap that starts the run
  sound.blip(520, 0.12, "triangle", 0.15, 880);
}

function end() {
  phase = "over";
  tc.gameplay.end({ score, outcome: "lose" });
  sound.blip(240, 0.4, "sawtooth", 0.12, 70);
  if (score > best) {
    best = score;
    tc.storage.set("best", best).catch(() => undefined);
  }
}

onTap(window, (x, y) => {
  if (phase !== "playing") return start();
  const hit = bubbles.find((b) => Math.hypot(b.g.x - x, b.g.y - y) < b.r + 10);
  if (hit) {
    pop(hit);
    score++;
    sound.blip(700 + Math.random() * 300, 0.06, "sine", 0.14, 1400);
    tc.feedback("tap");
  }
});
tc.on("replay", start);

let first = true;
tc.loop((dt) => {
  time += dt;
  if (phase !== "over") {
    rise += dt * (phase === "playing" ? 4 : 0);
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawn();
      spawnIn = Math.max(0.35, 1 - rise / 400);
    }
    for (const b of bubbles.slice()) {
      b.g.y -= b.vy * dt;
      b.g.x += Math.sin(time * 2 + b.wobble) * 20 * dt;
      // Attract mode: the demo pops bubbles in the upper third.
      if (phase === "attract" && b.g.y < app.screen.height * 0.45 && Math.random() < dt * 2) pop(b);
      else if (b.g.y < -b.r) {
        pop(b);
        if (phase === "playing" && ++escapes >= 3) end();
      }
    }
  }
  layout();
  Ticker.system.update(performance.now()); // pointer/event bookkeeping Pixi normally does on its own ticker
  app.render();
  if (first) {
    first = false;
    tc.ready();
  }
});
