/**
 * __NAME__ — a Canvas 2D starter: two lanes, falling blocks, tap to switch lanes.
 * Everything a Thumbcade game needs is here: attract mode, start on tap, score, end, best score,
 * pause handling and insets. Swap the game logic for your own.
 */
import { thumbcade as tc } from "@thumbcade/sdk";
import { createSound } from "./sound.ts";
import { onTap } from "./tap.ts";

const ACCENT = "__ACCENT__";
const BG = "__BG__";
const PAPER = "#F3F0E8";

const ctx = await tc.init();
const sound = createSound();
let best = Math.max(ctx.best ?? 0, (await tc.storage.get<number>("best").catch(() => null)) ?? 0);

// --- canvas ------------------------------------------------------------------------------
const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const g = canvas.getContext("2d")!;
let W = 0;
let H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener("resize", resize);

// --- game state --------------------------------------------------------------------------
type Phase = "attract" | "playing" | "over";
interface Block {
  lane: 0 | 1;
  y: number;
  passed: boolean;
}
let phase: Phase = "attract";
let lane: 0 | 1 = 0;
let playerX = 0; // eased lane position, 0..1
let blocks: Block[] = [];
let spawnIn = 0;
let speed = 260;
let score = 0;
let time = 0;
let flash = 0;

const laneX = (l: number) => W * (0.3 + l * 0.4);
const playerY = () => H - Math.max(140, H * 0.22);

function reset() {
  blocks = [];
  spawnIn = 0.6;
  speed = 260;
  score = 0;
  lane = 0;
}

function start() {
  if (phase === "playing") return;
  reset();
  phase = "playing";
  tc.gameplay.start(); // on the tap that starts the run
  sound.blip(520, 0.12, "triangle", 0.15, 880);
}

function gameOver() {
  phase = "over";
  flash = 1;
  sound.blip(220, 0.4, "sawtooth", 0.12, 60);
  tc.feedback("fail");
  tc.gameplay.end({ score, outcome: "lose" }); // within 1 s of game over
  if (score > best) {
    best = score;
    tc.storage.set("best", best).catch(() => undefined);
  }
}

onTap(window, () => {
  if (phase !== "playing") return start();
  lane = lane === 0 ? 1 : 0;
  sound.blip(760, 0.05);
});
tc.on("replay", start); // "Play again" on the feed's result card

// --- simulation --------------------------------------------------------------------------
function update(dt: number) {
  time += dt;
  flash = Math.max(0, flash - dt * 3);
  if (phase === "attract") {
    // Demo pilot: dodge whatever is closest in our lane.
    const threat = blocks.find((b) => b.lane === lane && b.y < playerY() && b.y > playerY() - 220);
    if (threat) lane = lane === 0 ? 1 : 0;
  }
  playerX += (lane - playerX) * (1 - Math.exp(-dt * 18));
  if (phase === "over") return;

  speed += dt * (phase === "playing" ? 9 : 0);
  spawnIn -= dt;
  if (spawnIn <= 0) {
    blocks.push({ lane: Math.random() < 0.5 ? 0 : 1, y: -60, passed: false });
    spawnIn = Math.max(0.42, 1.1 - speed / 900) * (0.75 + Math.random() * 0.5);
  }
  for (const b of blocks) {
    b.y += speed * dt;
    const hit = Math.abs(b.y - playerY()) < 40 && Math.abs(laneX(b.lane) - (laneX(0) + (laneX(1) - laneX(0)) * playerX)) < 46;
    if (hit && phase === "playing") return gameOver();
    if (!b.passed && b.y > playerY() + 40) {
      b.passed = true;
      if (phase === "playing") {
        score++;
        sound.blip(880 + (score % 8) * 60, 0.05, "sine", 0.1);
      }
    }
  }
  blocks = blocks.filter((b) => b.y < H + 80);
}

// --- rendering ---------------------------------------------------------------------------
function text(t: string, x: number, y: number, size: number, color: string, weight = 800) {
  g.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(t, x, y);
}

function draw() {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  // Lane guides.
  g.fillStyle = "rgba(243,240,232,0.06)";
  for (const l of [0, 1]) g.fillRect(laneX(l) - 1, 0, 2, H);
  // Blocks.
  g.fillStyle = PAPER;
  for (const b of blocks) g.fillRect(laneX(b.lane) - 34, b.y - 22, 68, 44);
  // Player.
  const px = laneX(0) + (laneX(1) - laneX(0)) * playerX;
  g.fillStyle = ACCENT;
  g.beginPath();
  g.arc(px, playerY(), 24, 0, Math.PI * 2);
  g.fill();

  // HUD: insets tell you what the feed covers. Preview = top tabs + right rail + caption; play = status bar.
  const i = tc.insets;
  if (phase === "playing") {
    text(String(score), W / 2, i.top + 48, 44, PAPER);
  } else if (phase === "attract") {
    const p = ctx.insets.preview;
    const cx = (p.left + W - p.right) / 2;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 0, W, H);
    text("__NAME_UPPER__", cx, p.top + 70, Math.min(48, (W - p.left - p.right) / 7), ACCENT, 900);
    if (best > 0) text(`BEST ${best}`, cx, p.top + 112, 14, PAPER, 600);
    g.globalAlpha = 0.6 + 0.4 * Math.sin(time * 4);
    text("TAP TO PLAY", cx, H - p.bottom - 40, 16, PAPER, 700);
    g.globalAlpha = 1;
  }
  if (flash > 0) {
    g.fillStyle = `rgba(255,255,255,${flash * 0.4})`;
    g.fillRect(0, 0, W, H);
  }
}

// tc.loop stops on pause and resumes on resume; dt is in seconds.
let first = true;
tc.loop((dt) => {
  update(dt);
  draw();
  if (first) {
    first = false;
    tc.ready(); // first frame is on screen
  }
});
