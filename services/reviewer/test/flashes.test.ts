import { describe, expect, it } from "vitest";
import { FlashMeter } from "../src/flashes.ts";

// Frames as the reviewer captures them: half the CSS size of a 390×844 phone page, 60 per second.
const W = 195;
const H = 422;
type Paint = (x: number, y: number, frame: number) => [number, number, number];

async function measure(paint: Paint, seconds = 2) {
  const meter = new FlashMeter(390);
  const frame = new Uint8Array(W * H * 3);
  for (let f = 0; f < seconds * 60; f++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [r, g, b] = paint(x, y, f);
        const p = (y * W + x) * 3;
        frame[p] = r;
        frame[p + 1] = g;
        frame[p + 2] = b;
      }
    }
    meter.addRaw(frame, W, H, 3, f / 60);
  }
  return meter.result();
}

const DARK: [number, number, number] = [11, 15, 20];
const WHITE: [number, number, number] = [255, 255, 255];

describe("FlashMeter", () => {
  it("counts a full-screen strobe", async () => {
    // Black/white every 3 frames: 10 flashes a second.
    const r = await measure((_x, _y, f) => (Math.floor(f / 3) % 2 ? WHITE : DARK));
    expect(r.general).toBeGreaterThanOrEqual(9);
    expect(r.worst).toMatchObject({ kind: "general" });
  });

  it("lets a slow pulse through", async () => {
    // Every 15 frames: 2 flashes a second.
    const r = await measure((_x, _y, f) => (Math.floor(f / 15) % 2 ? WHITE : DARK));
    expect(r.general).toBe(2);
  });

  it("ignores a flash too small to count", async () => {
    // A 60 px square strobing at 10 Hz covers well under a quarter of a 10° field.
    const r = await measure((x, y, f) => (x >= 60 && x < 90 && y >= 200 && y < 230 && Math.floor(f / 3) % 2 ? WHITE : DARK));
    expect(r.general).toBe(0);
  });

  it("doesn't count fast-scrolling objects as flashing", async () => {
    // Dark bars scrolling at 1500 CSS px a second: every cell under them darkens about 12 times a second, but on any
    // frame the bars darken some cells and uncover as many others, never a quarter of a field one way.
    const r = await measure((x, y, f) => ((y + f * 12.5) % 60 < 15 && (x + y) % 97 < 40 ? DARK : WHITE));
    expect(r.general).toBeLessThanOrEqual(1);
  });

  it("counts red flashes even without a change in brightness", async () => {
    // Saturated red against a grey of the same luminance, 6 times a second.
    const r = await measure((_x, _y, f) => (Math.floor(f / 5) % 2 ? [255, 0, 0] : [128, 128, 128]));
    expect(r.general).toBe(0);
    expect(r.red).toBeGreaterThanOrEqual(5);
  });

  it("adds up cells flashing out of phase, like a checkerboard flipping", async () => {
    const r = await measure((x, y, f) => ((Math.floor(x / 10) + Math.floor(y / 10) + Math.floor(f / 4)) % 2 ? WHITE : DARK));
    expect(r.general).toBeGreaterThanOrEqual(7);
  });

  it("passes the kit's capped flash: a 25 % white overlay fading out, at most twice a second", async () => {
    const r = await measure((_x, _y, f) => {
      const k = f % 30 < 18 ? 0.25 * (1 - (f % 30) / 18) : 0;
      return DARK.map((c) => Math.round(c + (255 - c) * k)) as [number, number, number];
    }, 3);
    expect(r.general).toBeLessThanOrEqual(2);
  });

  it("keeps separate capture segments apart", async () => {
    const dark = new Uint8Array(W * H * 3).fill(10);
    const light = new Uint8Array(W * H * 3).fill(250);
    // Two flashes per segment (dark, light, dark, light, dark); 0.3 s apart they would share a second.
    const run = async (cut: boolean) => {
      const meter = new FlashMeter(390);
      for (const offset of [0, 0.3]) {
        for (let f = 0; f < 15; f++) meter.addRaw(Math.floor(f / 3) % 2 ? light : dark, W, H, 3, offset + f / 60);
        if (cut) await meter.cut();
      }
      return (await meter.result()).general;
    };
    expect(await run(false)).toBe(4);
    expect(await run(true)).toBe(2);
  });
});
