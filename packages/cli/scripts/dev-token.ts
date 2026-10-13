/**
 * Local development only: creates (or reuses) a creator account on the local Supabase stack and
 * prints a fresh `tc_` creator token for it. Uses the service-role key from `supabase status`.
 *
 *   pnpm --filter @thumbcade/cli dev-token [handle]
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const handle = process.argv[2] ?? "devcreator";
const env = Object.fromEntries(
  execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split("\n")
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1]!, m[2]!]),
);
const api = env.API_URL ?? "http://127.0.0.1:54321";
const key = env.SERVICE_ROLE_KEY!;
const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const email = `${handle}@creators.thumbcade.local`;
let profile = ((await rest(`/rest/v1/profiles?handle=eq.${handle}&select=id,handle,role`)) as Array<{ id: string; role: string }>)[0];
if (!profile) {
  const user = (await rest("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: randomBytes(18).toString("hex"), email_confirm: true, user_metadata: { handle, display_name: handle } }),
  })) as { id: string };
  profile = ((await rest(`/rest/v1/profiles?id=eq.${user.id}&select=id,handle,role`)) as Array<{ id: string; role: string }>)[0]!;
  if ((profile as { handle?: string }).handle !== handle) {
    await rest(`/rest/v1/profiles?id=eq.${user.id}`, { method: "PATCH", body: JSON.stringify({ handle }) });
  }
}
if (profile.role !== "creator" && profile.role !== "admin") {
  await rest(`/rest/v1/profiles?id=eq.${profile.id}`, { method: "PATCH", body: JSON.stringify({ role: "creator" }) });
}
const token = `tc_${randomBytes(24).toString("hex")}`;
await rest("/rest/v1/creator_tokens", {
  method: "POST",
  body: JSON.stringify({
    creator_id: profile.id,
    name: `dev-token ${new Date().toISOString().slice(0, 16)}`,
    token_hash: createHash("sha256").update(token).digest("hex"),
    token_prefix: token.slice(0, 11),
  }),
});
console.log(token);
