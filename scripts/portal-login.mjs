// Signs into the portal with an email code read from Mailpit and saves Playwright storage state.
// Usage: node scripts/portal-login.mjs <email> <out-state.json> [base=http://localhost:3000]
import { chromium } from "playwright";

const [email, out, base = "http://localhost:3000"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const since = Date.now();
await page.goto(`${base}/login?next=/creator`);
await page.fill('input[type="email"]', email);
await page.click('button[type="submit"]');
await page.waitForSelector('input[autocomplete="one-time-code"]');
let code = null;
for (let i = 0; i < 30 && !code; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`).then((r) => r.json());
  const m = res.messages?.[0];
  if (m && new Date(m.Created).getTime() >= since - 2000) code = /code: (\d{6})/.exec(m.Subject)?.[1] ?? null;
}
if (!code) throw new Error("no code arrived in Mailpit");
await page.fill('input[autocomplete="one-time-code"]', code);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
await page.context().storageState({ path: out });
await browser.close();
console.log(`signed in as ${email}; state saved to ${out}`);
