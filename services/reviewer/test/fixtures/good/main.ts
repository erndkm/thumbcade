// A small game that follows the Swipe Contract: attract mode, start on a tap's release, end, pause.
import { thumbcade as tc } from "@thumbcade/sdk";

const ctx = await tc.init();
const c = document.createElement("canvas");
c.width = innerWidth;
c.height = innerHeight;
document.body.appendChild(c);
const g = c.getContext("2d")!;
// Created at boot: creating an AudioContext inside the first tap is a long task the reviewer flags.
const audio = ctx.audio.muted ? null : new AudioContext();
let phase: "attract" | "playing" | "over" = "attract";
let t = 0;
let runT = 0;
let down: { x: number; y: number } | null = null;
addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
addEventListener("pointercancel", () => (down = null));
addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
  down = null;
  if (phase !== "playing") {
    phase = "playing";
    runT = 0;
    tc.gameplay.start();
    if (audio) {
      void audio.resume();
      const o = audio.createOscillator();
      o.connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.1);
    }
  }
});
tc.on("pause", () => void audio?.suspend());
tc.on("resume", () => void audio?.resume());
tc.on("replay", () => (phase = "attract"));
let first = true;
tc.loop((dt) => {
  t += dt;
  if (phase === "playing" && (runT += dt) > 2) {
    phase = "over";
    tc.gameplay.end({ score: 3 });
  }
  const top = ctx.insets.preview.top;
  g.fillStyle = "#101820";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#FF6A1A";
  g.fillRect(40 + Math.sin(t * 3) * 30, top + 40, 60, 60);
  if (first) {
    first = false;
    tc.ready();
  }
});
