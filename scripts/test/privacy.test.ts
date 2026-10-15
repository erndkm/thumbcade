/**
 * Privacy plumbing: the retention cron purges with the periods the Privacy Policy states (@thumbcade/legal), and
 * account-export / account-delete work end to end for a throwaway guest. The second part runs only when the local
 * stack and `supabase functions serve` are up.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { RETENTION } from "@thumbcade/legal";
import { describe, expect, it } from "vitest";

describe("retention", () => {
  it("the cron job purges with the periods the Privacy Policy states", () => {
    const sql = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261014160000_data_retention.sql"), "utf8");
    const job = /cron\.schedule\('thumbcade-retention'.*?\$\$(.*?)\$\$/.exec(sql)?.[1] ?? "";
    expect(job).toContain(`purge_feed_events(${RETENTION.usageEventsDays})`);
    expect(job).toContain(`purge_inactive_guests(${RETENTION.inactiveGuestMonths})`);
  });
});

function localEnv(): { url: string; service: string; anon: string } | null {
  try {
    const out = execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 });
    const vars = Object.fromEntries(out.split("\n").map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter((m) => m !== null).map((m) => [m![1], m![2]]));
    return vars.API_URL && vars.SERVICE_ROLE_KEY && vars.ANON_KEY ? { url: vars.API_URL, service: vars.SERVICE_ROLE_KEY, anon: vars.ANON_KEY } : null;
  } catch {
    return null;
  }
}

const env = localEnv();
const functionsUp = env ? await fetch(`${env.url}/functions/v1/account-export`, { method: "OPTIONS" }).then((r) => r.status === 204, () => false) : false;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!functionsUp)("account export and deletion (local functions)", () => {
  it("exports a guest's own data, then deletes the guest and everything tied to it", async () => {
    const { data, error } = await createClient(env!.url, env!.anon, opts).auth.signInAnonymously();
    if (error || !data.session || !data.user) throw error ?? new Error("no session");
    const id = data.user.id;
    const call = (name: string, method: "GET" | "POST") =>
      fetch(`${env!.url}/functions/v1/${name}`, {
        method,
        headers: { Authorization: `Bearer ${data.session!.access_token}`, apikey: env!.anon, "Content-Type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });

    const res = await call("account-export", "GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="thumbcade-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const doc = (await res.json()) as { account: { id: string; guest: boolean; email: string | null }; profile: { id: string }; feed: { usageEvents: unknown[] } };
    expect(doc.account).toMatchObject({ id, guest: true, email: null });
    expect(doc.profile.id).toBe(id);
    expect(Array.isArray(doc.feed.usageEvents)).toBe(true);

    const del = await call("account-delete", "POST");
    expect(await del.json()).toEqual({ deleted: true });
    const admin = createClient(env!.url, env!.service, opts);
    expect((await admin.auth.admin.getUserById(id)).data.user).toBeNull();
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("id", id);
    expect(count).toBe(0);
  });

  it("refuses callers without a session", async () => {
    const res = await fetch(`${env!.url}/functions/v1/account-export`, { headers: { Authorization: `Bearer ${env!.anon}`, apikey: env!.anon } });
    expect(res.status).toBe(401);
  });
});
