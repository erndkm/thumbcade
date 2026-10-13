import { LOCAL_ENDPOINTS, type GameHostConfig } from "@thumbcade/protocol";

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? LOCAL_ENDPOINTS.supabaseUrl,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  gameHost: process.env.NEXT_PUBLIC_GAME_HOST ?? LOCAL_ENDPOINTS.gameHost,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? LOCAL_ENDPOINTS.portalUrl,
};

/** Path-mode locally; production sets NEXT_PUBLIC_GAME_HOST=subdomain:thumbcade.gg. */
export function gameHostConfig(): GameHostConfig {
  if (env.gameHost.startsWith("subdomain:")) return { mode: "subdomain", domain: env.gameHost.slice("subdomain:".length) };
  return { mode: "path", base: env.gameHost };
}
