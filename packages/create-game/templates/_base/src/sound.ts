import { thumbcade as tc } from "@thumbcade/sdk";

/**
 * Tiny procedural sound effects. One AudioContext that only runs while the game is unmuted AND not
 * paused: on `pause` everything goes silent (Swipe Contract rule 5), and a muted preview costs nothing.
 */
export function createSound() {
  let ctx: AudioContext | null = null;
  let muted = true;
  let paused = false;
  const sync = () => {
    if (!ctx) return;
    if (!muted && !paused) void ctx.resume();
    else void ctx.suspend();
  };
  const ensure = () => {
    ctx ??= new AudioContext();
    sync();
  };

  void tc.init().then((c) => {
    muted = c.audio.muted;
    if (!muted) ensure(); // create it while booting so the first tap doesn't hitch
  });
  tc.on("mute", () => ((muted = true), sync()));
  tc.on("unmute", () => ((muted = false), ensure()));
  tc.on("pause", () => ((paused = true), sync()));
  tc.on("resume", () => ((paused = false), sync()));
  // Browsers only start audio after a user gesture.
  window.addEventListener("pointerdown", () => !muted && !paused && ensure(), { capture: true });

  return {
    /** A short tone with a pitch slide. */
    blip(freq = 660, duration = 0.08, type: OscillatorType = "square", volume = 0.12, slideTo?: number) {
      if (!ctx || ctx.state !== "running") return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    },
  };
}
