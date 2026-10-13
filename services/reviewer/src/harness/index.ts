import { build } from "esbuild";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { close, listen } from "../server.ts";

export interface HarnessServer {
  origin: string;
  /** Harness page URL for a game. */
  url(params: Record<string, string | number | boolean | undefined>): string;
  close(): Promise<void>;
}

let bundled: Promise<string> | null = null;

/** Bundles the harness client once per process (TS source -> one browser script). */
export function harnessScript(): Promise<string> {
  bundled ??= build({
    entryPoints: [fileURLToPath(new URL("./client.ts", import.meta.url))],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    logLevel: "silent",
  }).then((r) => r.outputFiles[0]!.text);
  return bundled;
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thumbcade review harness</title></head><body><script src="/harness.js"></script></body></html>`;

/**
 * Serves the harness on `localhost` (a different origin from the game server on 127.0.0.1), so the game
 * runs cross-origin exactly like production.
 */
export async function startHarness(): Promise<HarnessServer> {
  const script = await harnessScript();
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/harness.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(script);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
  const origin = await listen(server, "localhost");
  return {
    origin,
    url(params) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
      return `${origin}/?${q.toString()}`;
    },
    close: () => close(server),
  };
}
