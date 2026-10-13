/**
 * __NAME__ — a Phaser starter: drag left and right to catch falling stars. Miss three and it's over.
 * Shows how to wire Phaser into Thumbcade: the game loop sleeps on `pause`, insets drive the layout,
 * and a run starts on a tap.
 */
import Phaser from "phaser";
import { thumbcade as tc } from "@thumbcade/sdk";
import { createSound } from "./sound.ts";
import { onTap } from "./tap.ts";

const ACCENT = Phaser.Display.Color.HexStringToColor("__ACCENT__").color;
const PAPER = 0xf3f0e8;

const ctx = await tc.init();
const sound = createSound();
let best = Math.max(ctx.best ?? 0, (await tc.storage.get<number>("best").catch(() => null)) ?? 0);

type Phase = "attract" | "playing" | "over";

class Catch extends Phaser.Scene {
  phase: Phase = "attract";
  score = 0;
  misses = 0;
  spawnIn = 0;
  fall = 220;
  targetX = 0;
  basket!: Phaser.GameObjects.Rectangle;
  stars!: Phaser.GameObjects.Group;
  title!: Phaser.GameObjects.Text;
  prompt!: Phaser.GameObjects.Text;
  hud!: Phaser.GameObjects.Text;
  bestText!: Phaser.GameObjects.Text;

  create() {
    const { width: W, height: H } = this.scale;
    this.basket = this.add.rectangle(W / 2, H - 150, 96, 18, ACCENT).setOrigin(0.5);
    this.targetX = W / 2;
    this.stars = this.add.group();
    const p = ctx.insets.preview;
    const cx = (p.left + W - p.right) / 2;
    const style = { fontFamily: "system-ui, sans-serif", fontStyle: "900", color: "#F3F0E8" };
    this.title = this.add.text(cx, p.top + 70, "__NAME_UPPER__", { ...style, fontSize: "44px", color: "__ACCENT__" }).setOrigin(0.5);
    this.bestText = this.add.text(cx, p.top + 112, "", { ...style, fontSize: "14px" }).setOrigin(0.5);
    this.prompt = this.add.text(cx, H - p.bottom - 40, "TAP TO PLAY", { ...style, fontSize: "16px" }).setOrigin(0.5);
    this.hud = this.add.text(W / 2, tc.insets.top + 48, "", { ...style, fontSize: "40px" }).setOrigin(0.5).setVisible(false);
    this.refreshHud();

    // The basket follows the finger horizontally. (Horizontal only: controls.vertical stays false.)
    this.input.on("pointermove", (ptr: Phaser.Input.Pointer) => {
      if (this.phase === "playing" && ptr.isDown) this.targetX = ptr.x;
    });
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      if (this.phase === "playing") this.targetX = ptr.x;
    });
    tc.on("inputCancel", () => (this.targetX = this.basket.x)); // the feed took the gesture
  }

  refreshHud() {
    const playing = this.phase === "playing";
    this.title.setVisible(this.phase === "attract");
    this.prompt.setVisible(this.phase === "attract");
    this.bestText.setVisible(this.phase === "attract" && best > 0).setText(`BEST ${best}`);
    this.hud.setVisible(playing).setText(`${this.score}`);
  }

  begin() {
    if (this.phase === "playing") return;
    this.stars.clear(true, true);
    this.score = 0;
    this.misses = 0;
    this.fall = 220;
    this.spawnIn = 0.4;
    this.phase = "playing";
    tc.gameplay.start(); // on the tap that starts the run
    sound.blip(520, 0.12, "triangle", 0.15, 880);
    this.refreshHud();
  }

  end() {
    this.phase = "over";
    tc.gameplay.end({ score: this.score, outcome: "lose" });
    sound.blip(240, 0.4, "sawtooth", 0.12, 70);
    if (this.score > best) {
      best = this.score;
      tc.storage.set("best", best).catch(() => undefined);
    }
    this.cameras.main.shake(220, 0.012);
    this.refreshHud();
  }

  update(_t: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.1);
    const { width: W, height: H } = this.scale;
    if (this.phase === "over") return;
    if (this.phase === "attract") {
      // Demo: chase the lowest star.
      const lowest = (this.stars.getChildren() as Phaser.GameObjects.Star[]).reduce<Phaser.GameObjects.Star | null>((m, s) => (!m || s.y > m.y ? s : m), null);
      if (lowest) this.targetX = lowest.x;
    }
    this.basket.x += (this.targetX - this.basket.x) * (1 - Math.exp(-dt * 16));
    this.fall += dt * (this.phase === "playing" ? 7 : 0);
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      const star = this.add.star(Phaser.Math.Between(40, W - 40), -30, 5, 9, 20, PAPER);
      this.stars.add(star);
      this.spawnIn = Math.max(0.35, 0.95 - this.fall / 1200);
    }
    for (const s of this.stars.getChildren() as Phaser.GameObjects.Star[]) {
      s.y += this.fall * dt;
      s.rotation += dt * 2;
      if (Math.abs(s.y - this.basket.y) < 18 && Math.abs(s.x - this.basket.x) < 60) {
        s.destroy();
        if (this.phase === "playing") {
          this.score++;
          sound.blip(880 + (this.score % 8) * 50, 0.06, "sine", 0.12);
          tc.feedback("tap");
          this.refreshHud();
        }
      } else if (s.y > H + 30) {
        s.destroy();
        if (this.phase === "playing" && ++this.misses >= 3) return this.end();
      }
    }
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: document.body,
  backgroundColor: "__BG__",
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: Catch,
  banner: false,
  audio: { noAudio: true }, // sound comes from src/sound.ts
  render: { antialias: true },
});

game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene("default") as Catch | null;
  const run = () => (scene ?? (game.scene.scenes[0] as Catch)).begin();
  onTap(window, () => {
    const s = game.scene.scenes[0] as Catch;
    if (s.phase !== "playing") run();
  });
  tc.on("replay", run);
  // Phaser runs its own requestAnimationFrame loop: put it to sleep on pause (Swipe Contract rule 5).
  tc.on("pause", () => game.loop.sleep());
  tc.on("resume", () => game.loop.wake());
  if (tc.paused) game.loop.sleep();
  // First frame drawn -> the feed crossfades from the poster.
  game.events.once(Phaser.Core.Events.POST_RENDER, () => tc.ready());
});
