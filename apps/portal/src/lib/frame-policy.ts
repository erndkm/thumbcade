/**
 * The portal's Content-Security-Policy: frames may only load the games origin.
 *
 * A game can navigate its own iframe (no sandbox flag prevents that) and could carry data out in the URL. With
 * `frame-src` limited to the games origin the browser refuses such a navigation before any request leaves.
 * Kept free of imports so next.config.ts can use it; the value format matches `gameHostConfig()` in env.ts.
 */
export function gameFrameSource(gameHost: string): string {
  if (gameHost.startsWith("subdomain:")) return `https://*.${gameHost.slice("subdomain:".length)}`;
  return new URL(gameHost).origin;
}

export function portalCsp(gameHost: string): string {
  return `frame-src ${gameFrameSource(gameHost)}`;
}
