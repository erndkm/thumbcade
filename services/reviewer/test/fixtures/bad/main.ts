// A game that breaks the contract on purpose: starts on pointerdown (so swipes start runs), keeps its
// own rAF loop and a droning oscillator alive through pause, throws, and ignores insets.
import { thumbcade as tc } from "@thumbcade/sdk";

await tc.init();
const c = document.createElement("canvas");
c.width = innerWidth;
c.height = innerHeight;
document.body.appendChild(c);
const g = c.getContext("2d")!;
let playing = false;
let taps = 0;
let drone: AudioContext | null = null;
addEventListener("pointerdown", () => {
  if (!playing) {
    playing = true;
    taps = 0;
    tc.gameplay.start();
    if (!drone) {
      drone = new AudioContext();
      const o = drone.createOscillator();
      o.connect(drone.destination);
      o.start();
    }
    setTimeout(() => {
      throw new Error("kaboom");
    }, 50);
  } else if (++taps >= 3) {
    playing = false;
    tc.gameplay.end({ score: taps });
  }
});
let first = true;
const frame = () => {
  g.fillStyle = playing ? "#300" : "#003";
  g.fillRect(0, 0, c.width, c.height);
  if (first) {
    first = false;
    tc.ready();
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
