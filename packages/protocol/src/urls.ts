/**
 * Where things live. Production isolates every game on its own origin under a separate
 * registrable domain (thumbcade.gg) so untrusted game code can never touch the app, the API,
 * the portal's cookies, or other games. Locally, services/game-host serves path-based URLs.
 */

export type GameHostConfig =
  | { mode: "subdomain"; domain: string; protocol?: "https" | "http" }
  | { mode: "path"; base: string };

export const PROD_GAME_HOST: GameHostConfig = { mode: "subdomain", domain: "thumbcade.gg" };
export const LOCAL_GAME_HOST_PORT = 5555;

export const LOCAL_ENDPOINTS = {
  supabaseUrl: "http://127.0.0.1:54321",
  functionsUrl: "http://127.0.0.1:54321/functions/v1",
  portalUrl: "http://localhost:3000",
  simulatorUrl: "http://localhost:5173",
  gameHost: `http://localhost:${LOCAL_GAME_HOST_PORT}`,
} as const;

export const PROD_ENDPOINTS = {
  portalUrl: "https://thumbcade.com",
  shareBase: "https://thumbcade.com",
} as const;

/** Origin a game version is served from. */
export function gameOrigin(slug: string, host: GameHostConfig): string {
  if (host.mode === "subdomain") return `${host.protocol ?? "https"}://${slug}.${host.domain}`;
  return host.base.replace(/\/$/, "");
}

/** Base URL (with trailing slash) of a game version's files. */
export function gameVersionBase(slug: string, versionId: string, host: GameHostConfig): string {
  if (host.mode === "subdomain") return `${gameOrigin(slug, host)}/${versionId}/`;
  return `${gameOrigin(slug, host)}/${slug}/${versionId}/`;
}

/** Fully-qualified entry URL for a game version. */
export function gameEntryUrl(
  ref: { slug: string; versionId: string; entry?: string },
  host: GameHostConfig,
): string {
  return gameVersionBase(ref.slug, ref.versionId, host) + (ref.entry ?? "index.html");
}

/** Storage object path of a bundle file inside the `game-bundles` bucket. */
export function bundleObjectPath(slug: string, versionId: string, file: string): string {
  return `${slug}/${versionId}/${file.replace(/^\/+/, "")}`;
}

export const STORAGE_BUCKETS = {
  /** Public. User avatars at `<userId>/<file>`. */
  avatars: "avatars",
  /** Public. Icons, posters, review screenshots, share cards at `<slug>/<file>`. */
  gameAssets: "game-assets",
  /** Public read. Immutable game bundles at `<slug>/<versionId>/<path>`. */
  gameBundles: "game-bundles",
} as const;

/** Public share links. */
export function gameShareUrl(slug: string, base: string = PROD_ENDPOINTS.shareBase): string {
  return `${base}/g/${slug}`;
}
export function challengeShareUrl(code: string, base: string = PROD_ENDPOINTS.shareBase): string {
  return `${base}/c/${code}`;
}

/** App deep-link scheme. Universal links use the share URLs above. */
export const APP_SCHEME = "thumbcade";
