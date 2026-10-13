/**
 * Shared by creator-publish and creator-review-callback (Creator & Games stream).
 * Runs in Deno (Supabase Edge Runtime); the protocol contract is imported as TypeScript source.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export * from "../../../packages/protocol/src/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Public base URL for storage links stored in the database (the runtime's SUPABASE_URL is internal). */
export const PUBLIC_SUPABASE_URL = (Deno.env.get("SUPABASE_PUBLIC_URL") ?? "http://127.0.0.1:54321").replace(/\/$/, "");
export const PORTAL_URL = (Deno.env.get("PORTAL_URL") ?? "http://localhost:3000").replace(/\/$/, "");

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  admin ??= createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export function publicObjectUrl(bucket: string, path: string): string {
  return `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function reviewUrl(slug: string, versionId: string): string {
  return `${PORTAL_URL}/creator/games/${slug}/versions/${versionId}`;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: string[],
  ) {
    super(message);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message, ...(e.issues ? { issues: e.issues } : {}) }, e.status);
      console.error(e);
      return json({ error: "internal", message: "Something broke on our side. Try again in a minute." }, 500);
    }
  });
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1]!.trim() : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Creator {
  id: string;
  handle: string;
  displayName: string;
  role: string;
  tokenId: string;
}

/** Resolves a `tc_` creator token (stored as sha256 hex) to its owner. */
export async function requireCreator(req: Request): Promise<Creator> {
  // The CLI sends the creator token as the bearer; x-thumbcade-token is accepted for gateways that demand a JWT bearer.
  const token = req.headers.get("x-thumbcade-token")?.trim() || bearer(req);
  if (!token || !/^tc_[a-f0-9]{48}$/.test(token)) {
    throw new HttpError(401, "unauthorized", "Missing or malformed creator token. Run `thumbcade login`.");
  }
  const db = adminClient();
  const { data: row, error } = await db
    .from("creator_tokens")
    .select("id, creator_id, revoked_at")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (error) throw error;
  if (!row || row.revoked_at) throw new HttpError(401, "unauthorized", "This token was revoked or never existed. Run `thumbcade login` again.");
  const { data: profile, error: pErr } = await db.from("profiles").select("id, handle, display_name, role").eq("id", row.creator_id).single();
  if (pErr) throw pErr;
  if (profile.role !== "creator" && profile.role !== "admin") {
    throw new HttpError(403, "not_a_creator", "This account isn't a creator yet. Finish creator onboarding in the portal.");
  }
  await db.from("creator_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { id: profile.id, handle: profile.handle, displayName: profile.display_name, role: profile.role, tokenId: row.id };
}

export function isServiceRequest(req: Request): boolean {
  const token = bearer(req);
  return !!token && !!SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY;
}

export const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  txt: "text/plain; charset=utf-8",
};

export function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}
