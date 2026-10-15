import "server-only";
import { env } from "./env";
import { createClient } from "./supabase/server";

/** Calls a Supabase edge function as the signed-in user (the function verifies the token). */
export async function callFunction(name: string, init: { body?: unknown } = {}): Promise<Response> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return new Response(null, { status: 401 });
  return fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
      ...(init.body === undefined ? null : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
}
