import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "@thumbcade/protocol";
import { injectProbe } from "@thumbcade/sdk/probe";
import type { Plugin } from "vite";
import { loadVite } from "./build.ts";
import { CliError } from "./ui.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** The prebuilt simulator: dist/simulator next to the bundled CLI, or apps/simulator/dist in the monorepo. */
export function simulatorDir(): string {
  const candidates = [
    fileURLToPath(new URL("./simulator/", import.meta.url)),
    fileURLToPath(new URL("../simulator/", import.meta.url)),
    fileURLToPath(new URL("../../../apps/simulator/dist/", import.meta.url)),
  ];
  const dir = candidates.find((d) => existsSync(join(d, "index.html")));
  if (!dir) throw new CliError("The simulator build is missing.", "In the Thumbcade repo run: pnpm --filter @thumbcade/simulator build");
  return dir;
}

export function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return null;
}

function probePlugin(): Plugin {
  return {
    name: "thumbcade-probe",
    transformIndexHtml: { order: "pre", handler: (html) => injectProbe(html) },
  };
}

async function listen(server: Server, port: number, host: string): Promise<number> {
  for (let p = port; p < port + 20; p++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" || err.code === "EACCES") resolve(false);
        else resolve(false);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, host);
    });
    if (ok) return (server.address() as AddressInfo).port;
  }
  throw new CliError(`No free port between ${port} and ${port + 19}.`);
}

export interface DevServer {
  port: number;
  /** Simulator URL on this machine. */
  url: string;
  /** The game itself (no simulator), on this machine. */
  gameUrl: string;
  /** LAN URL of the game for a phone (device mode). */
  lanGameUrl: string | null;
  close(): Promise<void>;
}

/**
 * One origin for both: the simulator at `/` and the game (Vite dev server with HMR) at `/__game/`.
 * Same origin lets the simulator observe input and read the runtime probe, exactly like the reviewer.
 */
export async function startDevServer(opts: { root: string; manifest: Manifest; port?: number; device?: boolean; creatorHandle?: string }): Promise<DevServer> {
  const vite = await loadVite(opts.root);
  const simDir = simulatorDir();
  const host = opts.device ? "0.0.0.0" : "localhost";
  const http = createServer();
  const game = await vite.createServer({
    root: opts.root,
    base: "/__game/",
    appType: "mpa",
    clearScreen: false,
    logLevel: "warn",
    server: { middlewareMode: true, hmr: { server: http }, host },
    plugins: [probePlugin()],
  });

  const config = () =>
    JSON.stringify({
      mode: "cli",
      defaultSlug: opts.manifest.id,
      creatorHandle: opts.creatorHandle,
      games: [
        {
          slug: opts.manifest.id,
          name: opts.manifest.name,
          entryUrl: `/__game/${opts.manifest.entry}`,
          manifestUrl: "/__game/thumbcade.json",
          posterUrl: null,
          iconUrl: null,
        },
      ],
    });

  http.on("request", (req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    if (path === "/__thumbcade/config.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(config());
      return;
    }
    if (path === "/__game/thumbcade.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(readFileSync(join(opts.root, "thumbcade.json")));
      return;
    }
    if (path.startsWith("/__game/") || path.startsWith("/@") || path.startsWith("/node_modules/")) {
      game.middlewares(req, res, () => {
        res.writeHead(404);
        res.end("not found");
      });
      return;
    }
    let file = normalize(join(simDir, decodeURIComponent(path)));
    if (!file.startsWith(simDir.replace(/[\\/]$/, "") + sep) && file !== simDir) file = join(simDir, "index.html");
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(simDir, "index.html");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });

  const port = await listen(http, opts.port ?? 5173, host);
  const lan = opts.device ? lanAddress() : null;
  const local = `http://localhost:${port}`;
  return {
    port,
    url: `${local}/`,
    gameUrl: `${local}/__game/${opts.manifest.entry}`,
    lanGameUrl: lan ? `http://${lan}:${port}/__game/${opts.manifest.entry}` : null,
    async close() {
      await game.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** The payload the app's developer menu understands (docs/handoff/B.md). */
export function deviceDeepLink(gameUrl: string): string {
  return `thumbcade://dev?url=${encodeURIComponent(gameUrl)}`;
}
