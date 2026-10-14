/** Supabase clients and caller identity for edge functions. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let admin: SupabaseClient | null = null;
/** Service-role client: bypasses RLS. Only ever used server-side. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export interface Caller {
  id: string;
  isAnonymous: boolean;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

/** True when the request is authenticated with the service-role key (cron, ops). */
export function isServiceRequest(req: Request): boolean {
  const token = bearer(req);
  return token !== null && SERVICE_ROLE_KEY.length > 0 && token === SERVICE_ROLE_KEY;
}

/** Resolves the signed-in (possibly anonymous) user, or null for anon-key-only requests. */
export async function optionalCaller(req: Request): Promise<Caller | null> {
  const token = bearer(req);
  if (!token) return null;
  let role: string | undefined;
  try {
    role = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")))?.role;
  } catch {
    throw new HttpError(401, "unauthorized", "Malformed token.");
  }
  if (role !== "authenticated") return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized", "Session expired. Sign in again.");
  return { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
}

export async function requireCaller(req: Request): Promise<Caller> {
  const caller = await optionalCaller(req);
  if (!caller) throw new HttpError(401, "unauthorized", "Sign in (or continue as a guest) first.");
  return caller;
}
