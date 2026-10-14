/** HTTP plumbing shared by the Player Platform edge functions (Deno). */

const ALLOWED_ORIGINS = (Deno.env.get("CORS_ORIGINS") ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,https://thumbcade.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(req), ...extra },
  });
}

export function fail(req: Request, status: number, error: string, message: string): Response {
  return json(req, { error, message }, status);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a handler with CORS preflight, method checks and uniform JSON errors. */
export function serve(methods: ("GET" | "POST")[], handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (!methods.includes(req.method as "GET" | "POST")) return fail(req, 405, "method_not_allowed", `Use ${methods.join(" or ")}.`);
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return fail(req, e.status, e.code, e.message);
      console.error(e);
      return fail(req, 500, "internal", "Something broke on our side.");
    }
  });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be JSON.");
  }
}
