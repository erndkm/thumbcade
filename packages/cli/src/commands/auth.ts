import { whoami, startDeviceLogin, pollDeviceLogin } from "../api.ts";
import { clearToken, endpoints, isCreatorToken, loadToken, saveToken } from "../config.ts";
import { CliError, paint, ui } from "../ui.ts";
import { openBrowser } from "./dev.ts";

export async function loginCommand(args: { token?: string; open?: boolean }): Promise<void> {
  if (args.token) {
    const token = args.token.trim();
    if (!isCreatorToken(token)) throw new CliError("That doesn't look like a creator token (tc_ followed by 48 hex characters).", "Create one in the portal under Creator → API tokens.");
    const me = await whoami(token);
    const where = await saveToken(token, me.handle);
    ui.ok(`Logged in as ${paint("bold", `@${me.handle}`)} (token stored in the ${where === "keychain" ? "OS keychain" : "config file"}).`);
    return;
  }
  const start = await startDeviceLogin();
  const url = /[?&]code=/.test(start.verificationUrl)
    ? start.verificationUrl
    : `${start.verificationUrl}${start.verificationUrl.includes("?") ? "&" : "?"}code=${encodeURIComponent(start.userCode)}`;
  ui.title("Log in to Thumbcade");
  ui.info(`Your code: ${paint(["bold", "yellow"], start.userCode)}`);
  ui.info(`Approve it at ${paint("cyan", url)}`);
  if (args.open !== false) openBrowser(url);
  ui.dim("Waiting for approval…");
  const deadline = Date.now() + start.expiresIn * 1000;
  const interval = Math.max(1, start.interval) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await pollDeviceLogin(start.deviceCode);
    if (res.status === "pending") continue;
    if (res.status === "expired") break;
    const where = await saveToken(res.token, res.handle);
    ui.ok(`Logged in as ${paint("bold", `@${res.handle}`)} (token stored in the ${where === "keychain" ? "OS keychain" : "config file"}).`);
    return;
  }
  throw new CliError("The code expired before it was approved.", "Run `thumbcade login` again.");
}

export async function logoutCommand(): Promise<void> {
  const had = await clearToken();
  if (had) ui.ok(`Logged out of ${endpoints().functionsUrl}.`);
  else ui.info("You weren't logged in here.");
}

export async function whoamiCommand(): Promise<void> {
  const auth = await loadToken();
  if (!auth) throw new CliError("Not logged in.", "Run `thumbcade login`.");
  const me = await whoami(auth.token);
  ui.info(`${paint("bold", `@${me.handle}`)} ${paint("gray", `(${me.displayName}, ${me.role})`)}`);
  if (me.games.length) {
    for (const g of me.games) ui.kv(g.slug, `${g.name} · ${g.status}`);
  } else {
    ui.dim("No games yet. `thumbcade publish` your first one.");
  }
  ui.dim(`token from ${auth.source}`);
}
