/**
 * __NAME__ — a plain HTML/CSS starter (no engine): a bar sweeps back and forth, tap to stop it inside
 * the zone. The zone shrinks with every hit; one miss ends the run.
 * Layout uses the SDK's inset CSS variables (--tc-preview-inset-*, --tc-play-inset-*), so nothing
 * important hides under the feed's overlay.
 */
import { thumbcade as tc } from "@thumbcade/sdk";
import "./style.css";
import { createSound } from "./sound.ts";
import { onTap } from "./tap.ts";

const ctx = await tc.init();
const sound = createSound();
let best = Math.max(ctx.best ?? 0, (await tc.storage.get<number>("best").catch(() => null)) ?? 0);

document.body.innerHTML = `
  <main class="stage" data-phase="attract">
    <header class="title">
      <h1>__NAME__</h1>
      <p class="best"></p>
    </header>
    <div class="score" aria-live="polite">0</div>
    <div class="track">
      <div class="zone"></div>
      <div class="needle"></div>
    </div>
    <p class="prompt">Tap to play</p>
  </main>`;
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const stage = $("main");
const zone = $(".zone");
const needle = $(".needle");
const scoreEl = $(".score");
const bestEl = $(".best");

type Phase = "attract" | "playing" | "over";
let phase: Phase = "attract";
let pos = 0; // 0..1 across the track
let dir = 1;
let speed = 0.55;
let zoneAt = 0.4;
let zoneW = 0.3;
let score = 0;

function setPhase(p: Phase) {
  phase = p;
  stage.dataset.phase = p;
  bestEl.textContent = best > 0 ? `Best ${best}` : "";
}

function newZone() {
  zoneW = Math.max(0.07, zoneW * 0.88);
  zoneAt = Math.random() * (1 - zoneW);
}

function start() {
  if (phase === "playing") return;
  score = 0;
  speed = 0.55;
  zoneW = 0.34;
  newZone();
  scoreEl.textContent = "0";
  setPhase("playing");
  tc.gameplay.start(); // on the tap that starts the run
}

function end() {
  setPhase("over");
  tc.gameplay.end({ score, outcome: "lose" });
  sound.blip(220, 0.4, "sawtooth", 0.12, 60);
  stage.classList.add("shake");
  setTimeout(() => stage.classList.remove("shake"), 400);
  if (score > best) {
    best = score;
    tc.storage.set("best", best).catch(() => undefined);
  }
}

onTap(window, () => {
  if (phase !== "playing") return start();
  if (pos >= zoneAt && pos <= zoneAt + zoneW) {
    score++;
    scoreEl.textContent = String(score);
    speed = Math.min(1.8, speed * 1.07);
    sound.blip(660 + score * 30, 0.07, "triangle", 0.14);
    tc.feedback("tap");
    newZone();
  } else {
    end();
  }
});
tc.on("replay", start);
// The feed switches insets between preview (overlay up) and play; style.css can key off data-insets.
tc.on("insets", (set) => (stage.dataset.insets = set.current));
stage.dataset.insets = ctx.insets.current;
// CSS animations must stop on pause too.
tc.on("pause", () => stage.classList.add("paused"));
tc.on("resume", () => stage.classList.remove("paused"));
setPhase("attract");

let first = true;
tc.loop((dt) => {
  if (phase !== "over") {
    pos += dir * speed * dt;
    if (pos > 1) (pos = 1), (dir = -1);
    if (pos < 0) (pos = 0), (dir = 1);
    // Attract demo: "stops" inside the zone now and then.
    if (phase === "attract" && pos > zoneAt + zoneW / 2 - 0.01 && pos < zoneAt + zoneW / 2 + 0.01) newZone();
  }
  needle.style.left = `${pos * 100}%`;
  zone.style.left = `${zoneAt * 100}%`;
  zone.style.width = `${zoneW * 100}%`;
  if (first) {
    first = false;
    tc.ready();
  }
});
