import { spawn } from "node:child_process";
import QRCode from "qrcode";
import { loadToken } from "../config.ts";
import { deviceDeepLink, startDevServer } from "../devserver.ts";
import { findProjectRoot, readProjectManifest } from "../project.ts";
import { CliError, paint, ui } from "../ui.ts";

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* no browser available: the URL is printed anyway */
  }
}

export async function devCommand(args: { port?: number; device?: boolean; open?: boolean }): Promise<void> {
  const root = findProjectRoot();
  const pm = await readProjectManifest(root);
  if (!pm.manifest) {
    for (const i of pm.issues) {
      ui.fail(i.message);
      if (i.fix) ui.fix(i.fix);
    }
    throw new CliError("thumbcade.json needs fixing before the simulator can load your game.");
  }
  const auth = await loadToken().catch(() => null);
  const server = await startDevServer({ root, manifest: pm.manifest, port: args.port, device: args.device, creatorHandle: auth?.handle });
  ui.title(`${pm.manifest.name} is live in the simulator`);
  ui.kv("simulator", paint("cyan", server.url));
  ui.kv("game only", server.gameUrl);
  if (args.device) {
    if (!server.lanGameUrl) {
      ui.warn("No LAN address found. Connect this machine to the same Wi-Fi as your phone.");
    } else {
      const link = deviceDeepLink(server.lanGameUrl);
      ui.kv("on your phone", server.lanGameUrl);
      console.log("");
      console.log(await QRCode.toString(link, { type: "terminal", small: true, errorCorrectionLevel: "M" }));
      ui.dim("Scan with the Thumbcade app's developer menu (Settings → tap the version 7 times → Open dev game).");
      ui.dim(`Payload: ${link}`);
    }
  }
  ui.dim("Edits hot-reload. Ctrl+C to stop.");
  if (args.open !== false) openBrowser(server.url);
  await new Promise<void>((resolve) => {
    const stop = () => {
      void server.close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
