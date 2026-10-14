import { createGameHost } from "./server.ts";

const list = (value: string | undefined, fallback: string[]): string[] =>
  value === undefined ? fallback : value.split(/[\s,]+/).filter(Boolean);

const port = Number(process.env.GAME_HOST_PORT ?? 5555);
const host = process.env.GAME_HOST_BIND ?? "0.0.0.0";
const supabaseUrl = (process.env.SUPABASE_URL ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const upstream = process.env.GAME_HOST_UPSTREAM ?? `${supabaseUrl}/storage/v1/object/public/game-bundles`;
const webOrigins = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"];

const server = createGameHost({
  upstream,
  frameAncestors: list(process.env.GAME_HOST_FRAME_ANCESTORS, webOrigins),
  corsOrigins: list(process.env.GAME_HOST_CORS_ORIGINS, webOrigins),
  cacheBytes: Number(process.env.GAME_HOST_CACHE_MB ?? 256) * 1024 * 1024,
  log: process.env.GAME_HOST_QUIET ? undefined : (line) => console.log(`[game-host] ${line}`),
});

server.listen(port, host, () => {
  console.log(`[game-host] serving ${upstream} at http://${host}:${port}/<slug>/<versionId>/<path>`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
