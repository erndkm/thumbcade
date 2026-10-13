import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { injectProbe } from "@thumbcade/sdk/probe";
import type { Plugin } from "vite";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".glb": "model/gltf-binary",
};

interface WorkspaceGame {
  slug: string;
  dir: string;
  name: string;
  entry: string;
}

/**
 * Monorepo dev only: serves the launch games (games/<slug>/dist, or dist/games/<slug>/bundle after
 * `pnpm games:build`) under /__games/<slug>/ on the simulator's own origin, with the runtime probe
 * injected, and lists them at /__thumbcade/config.json. `thumbcade dev` provides the same endpoints
 * for a creator's project.
 */
export function workspaceGames(): Plugin {
  const repo = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

  function list(): WorkspaceGame[] {
    const out: WorkspaceGame[] = [];
    const gamesDir = join(repo, "games");
    if (!existsSync(gamesDir)) return out;
    for (const slug of readdirSync(gamesDir)) {
      if (slug.startsWith("_") || slug.startsWith(".")) continue;
      const candidates = [join(repo, "dist", "games", slug, "bundle"), join(gamesDir, slug, "dist")];
      const dir = candidates.find((d) => existsSync(join(d, "thumbcade.json")));
      if (!dir) continue;
      try {
        const m = JSON.parse(readFileSync(join(dir, "thumbcade.json"), "utf8")) as { name?: string; entry?: string };
        out.push({ slug, dir, name: m.name ?? slug, entry: m.entry ?? "index.html" });
      } catch {
        /* skip broken builds */
      }
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  return {
    name: "thumbcade-workspace-games",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__thumbcade/config.json", (_req, res) => {
        const games = list();
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(
          JSON.stringify({
            mode: "workspace",
            defaultSlug: games.some((g) => g.slug === "flapjack") ? "flapjack" : games[0]?.slug,
            games: games.map((g) => ({
              slug: g.slug,
              name: g.name,
              entryUrl: `/__games/${g.slug}/${g.entry}`,
              manifestUrl: `/__games/${g.slug}/thumbcade.json`,
              posterUrl: null,
              iconUrl: null,
            })),
          }),
        );
      });
      server.middlewares.use("/__games/", (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        const [slug, ...rest] = url.pathname.replace(/^\/+/, "").split("/");
        const game = list().find((g) => g.slug === slug);
        if (!game) return next();
        let rel = decodeURIComponent(rest.join("/")) || game.entry;
        if (rel.endsWith("/")) rel += "index.html";
        const file = normalize(join(game.dir, rel));
        if (!file.startsWith(game.dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
        res.setHeader("content-type", type);
        res.setHeader("cache-control", "no-store");
        if (type.startsWith("text/html")) res.end(injectProbe(readFileSync(file, "utf8")));
        else res.end(readFileSync(file));
      });
    },
  };
}
