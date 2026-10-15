import { Platform } from "react-native";
import { OPERATOR } from "@thumbcade/legal";
import { LOCAL_ENDPOINTS, PROD_ENDPOINTS } from "@thumbcade/protocol";

/** Public configuration bundled into the app (EXPO_PUBLIC_*). */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? LOCAL_ENDPOINTS.supabaseUrl,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  gameHost: process.env.EXPO_PUBLIC_GAME_HOST ?? LOCAL_ENDPOINTS.gameHost,
  shareBase: process.env.EXPO_PUBLIC_SHARE_BASE ?? PROD_ENDPOINTS.shareBase,
  appleAuth: process.env.EXPO_PUBLIC_AUTH_APPLE_ENABLED === "true",
  googleAuth: process.env.EXPO_PUBLIC_AUTH_GOOGLE_ENABLED === "true",
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  androidHostAlias: process.env.EXPO_PUBLIC_ANDROID_HOST_ALIAS ?? "10.0.2.2",
  docsUrl: process.env.EXPO_PUBLIC_DOCS_URL ?? `${process.env.EXPO_PUBLIC_SHARE_BASE ?? PROD_ENDPOINTS.portalUrl}/docs`,
  portalUrl: process.env.EXPO_PUBLIC_PORTAL_URL ?? process.env.EXPO_PUBLIC_SHARE_BASE ?? PROD_ENDPOINTS.portalUrl,
  contactEmail: OPERATOR.email.safety,
} as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);

/**
 * Dev-only: the Android emulator reaches the host machine at 10.0.2.2, not 127.0.0.1.
 * Used for the Supabase URL, storage asset URLs and game entry URLs/origins. Production URLs and
 * iOS (the simulator shares the host's loopback) are returned untouched.
 */
export function rewriteLocalUrl(
  url: string,
  opts: { os?: string; dev?: boolean; alias?: string } = {},
): string {
  const os = opts.os ?? Platform.OS;
  const dev = opts.dev ?? __DEV__;
  if (!dev || os !== "android" || !url) return url;
  const m = /^(https?:\/\/)([^/:]+)(.*)$/i.exec(url);
  if (!m) return url;
  const [, scheme, host, rest] = m as unknown as [string, string, string, string];
  if (!LOCAL_HOSTS.has(host.toLowerCase())) return url;
  return `${scheme}${opts.alias ?? env.androidHostAlias}${rest}`;
}

/** Same as rewriteLocalUrl but passes null/undefined through. */
export function localUrl<T extends string | null | undefined>(url: T): T {
  return (typeof url === "string" ? rewriteLocalUrl(url) : url) as T;
}
