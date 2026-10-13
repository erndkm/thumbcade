/**
 * Design-QA screenshots of the simulator (run the dev server first: pnpm --filter @thumbcade/simulator dev).
 *   tsx scripts/screenshots.ts [baseUrl] [outDir]
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const base = process.argv[2] ?? "http://localhost:5173/";
const out = resolve(process.argv[3] ?? "../../docs/screenshots/simulator");
const slug = process.env.SLUG ?? "flapjack";

async function gameBox(page: Page) {
  const box = await page.locator("iframe.card__game").boundingBox();
  if (!box) throw new Error("no game iframe");
  return box;
}

async function waitPhase(page: Page, phase: string, timeout = 15_000) {
  await page.locator(".phase", { hasText: phase }).first().waitFor({ timeout });
}

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    desk.on("pageerror", (e) => console.error("pageerror", e.message));
    await desk.goto(`${base}?slug=${slug}`);
    await waitPhase(desk, "PREVIEW");
    await desk.waitForTimeout(1500);
    await desk.screenshot({ path: join(out, "1440-preview.png") });

    const box = await gameBox(desk);
    await desk.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await waitPhase(desk, "PLAYING");
    await desk.waitForTimeout(500);
    await desk.screenshot({ path: join(out, "1440-playing.png") });
    await waitPhase(desk, "ENDED", 20_000);
    await desk.waitForTimeout(1300);
    await desk.screenshot({ path: join(out, "1440-ended.png") });

    // Mid-swipe toward the next card (feed drag with the mouse).
    const b2 = await gameBox(desk);
    const x = b2.x + b2.width * 0.4;
    await desk.mouse.move(x, b2.y + b2.height * 0.7);
    await desk.mouse.down();
    for (let i = 1; i <= 12; i++) await desk.mouse.move(x, b2.y + b2.height * 0.7 - i * 18);
    await desk.waitForTimeout(150);
    await desk.screenshot({ path: join(out, "1440-swipe.png") });
    await desk.mouse.up();
    await desk.waitForTimeout(900);
    await desk.screenshot({ path: join(out, "1440-neighbor.png") });
    await desk.locator(".stage__hint").click();
    await desk.keyboard.press("ArrowUp");
    await waitPhase(desk, "ENDED");
    await desk.getByRole("button", { name: "Insets" }).click();
    await desk.getByRole("button", { name: "Play again" }).click();
    await waitPhase(desk, "PLAYING");
    await desk.getByRole("button", { name: "App to background" }).click();
    await desk.waitForTimeout(1200);
    await desk.screenshot({ path: join(out, "1440-paused-insets.png") });
    await desk.getByRole("button", { name: "Bring app back" }).click();
    await desk.getByRole("button", { name: "Insets" }).click();

    // Other phones: the chrome and the game viewport follow each device's safe areas.
    for (const [label, name] of [["Android mid-range", "android"], ["iPhone Pro Max", "promax"]] as const) {
      await desk.getByRole("radio", { name: label }).click();
      await waitPhase(desk, "PREVIEW");
      await desk.waitForTimeout(1500);
      await desk.screenshot({ path: join(out, `1440-${name}.png`) });
    }
    await desk.getByRole("radio", { name: "iPhone 6.1″" }).click();

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await phone.goto(`${base}?slug=${slug}`);
    await waitPhase(phone, "PREVIEW");
    await phone.waitForTimeout(1500);
    await phone.screenshot({ path: join(out, "390-preview.png") });
    await phone.screenshot({ path: join(out, "390-full.png"), fullPage: true });

    const empty = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await empty.route("**/__thumbcade/config.json", (r) => r.fulfill({ json: { mode: "url", games: [] } }));
    await empty.goto(base);
    await empty.getByText("No game plugged in.").waitFor();
    await empty.screenshot({ path: join(out, "1440-empty.png") });
    console.log(`screenshots in ${out}`);
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
