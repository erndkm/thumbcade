/**
 * __NAME__ — a Three.js starter: tap to hop over the cubes sliding toward you.
 * Shows how to wire Three.js into Thumbcade: render inside tc.loop (never setAnimationLoop, so pause
 * stops rendering), a 2D HUD laid out with insets, and a run that starts on a tap.
 */
import * as THREE from "three";
import { thumbcade as tc } from "@thumbcade/sdk";
import { createSound } from "./sound.ts";
import { onTap } from "./tap.ts";

const ACCENT = new THREE.Color("__ACCENT__");

const ctx = await tc.init();
const sound = createSound();
let best = Math.max(ctx.best ?? 0, (await tc.storage.get<number>("best").catch(() => null)) ?? 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("__BG__");
scene.fog = new THREE.Fog(scene.background, 12, 34);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(4.2, 4.6, 8);
camera.lookAt(0, 0.6, -3);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 8, 6);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 60), new THREE.MeshStandardMaterial({ color: 0x1c1f26 }));
ground.position.set(0, -0.2, -20);
scene.add(ground);
const hero = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: ACCENT }));
hero.position.set(0, 0.5, 0);
scene.add(hero);
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const cubeMat = new THREE.MeshStandardMaterial({ color: 0xf3f0e8 });

// HUD on a transparent 2D canvas over the WebGL view.
const hudCanvas = document.createElement("canvas");
hudCanvas.style.cssText = "position:fixed;inset:0;pointer-events:none";
document.body.appendChild(hudCanvas);
const hud = hudCanvas.getContext("2d")!;

type Phase = "attract" | "playing" | "over";
let phase: Phase = "attract";
let cubes: THREE.Mesh[] = [];
let vy = 0;
let speed = 9;
let spawnIn = 0;
let score = 0;
let time = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hudCanvas.width = window.innerWidth * dpr;
  hudCanvas.height = window.innerHeight * dpr;
  hudCanvas.style.width = `${window.innerWidth}px`;
  hudCanvas.style.height = `${window.innerHeight}px`;
  hud.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener("resize", resize);

const grounded = () => hero.position.y <= 0.5001;
function hop() {
  if (!grounded()) return;
  vy = 7.2;
  sound.blip(420, 0.12, "triangle", 0.14, 840);
}

function start() {
  if (phase === "playing") return;
  cubes.forEach((c) => scene.remove(c));
  cubes = [];
  score = 0;
  speed = 9;
  spawnIn = 0.8;
  phase = "playing";
  tc.gameplay.start(); // on the tap that starts the run
  hop();
}

function end() {
  phase = "over";
  tc.gameplay.end({ score, outcome: "lose" });
  sound.blip(200, 0.45, "sawtooth", 0.12, 60);
  tc.feedback("impact");
  if (score > best) {
    best = score;
    tc.storage.set("best", best).catch(() => undefined);
  }
}

onTap(window, () => (phase === "playing" ? hop() : start()));
tc.on("replay", start);

function text(t: string, x: number, y: number, size: number, color: string) {
  hud.font = `900 ${size}px system-ui, -apple-system, sans-serif`;
  hud.textAlign = "center";
  hud.textBaseline = "middle";
  hud.fillStyle = color;
  hud.fillText(t, x, y);
}

let first = true;
tc.loop((dt) => {
  time += dt;
  if (phase !== "over") {
    speed += dt * (phase === "playing" ? 0.25 : 0);
    spawnIn -= dt;
    if (spawnIn <= 0) {
      const c = new THREE.Mesh(cubeGeo, cubeMat);
      c.position.set(0, 0.5, -32);
      scene.add(c);
      cubes.push(c);
      spawnIn = 1.1 + Math.random() * 0.9 - Math.min(0.5, speed / 40);
    }
    for (const c of cubes) c.position.z += speed * dt;
    // Attract demo: hop when a cube gets close.
    if (phase === "attract" && cubes.some((c) => c.position.z > -1.6 && c.position.z < -0.6)) hop();
    for (const c of cubes) {
      if (Math.abs(c.position.z) < 0.9 && hero.position.y < 1.2) {
        if (phase === "playing") end();
        else c.position.z = 2;
      }
      if (c.position.z > 0.95 && !c.userData.passed) {
        c.userData.passed = true;
        if (phase === "playing") score++;
      }
    }
    cubes = cubes.filter((c) => (c.position.z > 6 ? (scene.remove(c), false) : true));
  }
  vy -= 22 * dt;
  hero.position.y = Math.max(0.5, hero.position.y + vy * dt);
  if (grounded()) vy = 0;
  hero.rotation.x = grounded() ? 0 : hero.rotation.x - dt * 6;
  renderer.render(scene, camera);

  const W = window.innerWidth;
  const H = window.innerHeight;
  hud.clearRect(0, 0, W, H);
  if (phase === "playing") text(String(score), W / 2, tc.insets.top + 48, 44, "#F3F0E8");
  if (phase === "attract") {
    const p = ctx.insets.preview; // the feed overlay covers these areas before a run
    const cx = (p.left + W - p.right) / 2;
    text("__NAME_UPPER__", cx, p.top + 70, 44, "__ACCENT__");
    if (best > 0) text(`BEST ${best}`, cx, p.top + 112, 14, "#F3F0E8");
    hud.globalAlpha = 0.6 + 0.4 * Math.sin(time * 4);
    text("TAP TO PLAY", cx, H - p.bottom - 40, 16, "#F3F0E8");
    hud.globalAlpha = 1;
  }
  if (first) {
    first = false;
    tc.ready();
  }
});
