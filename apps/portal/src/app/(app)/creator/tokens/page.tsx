import { formatRelative } from "@thumbcade/protocol";
import type { Metadata } from "next";
import { EmptyState, StatusDot } from "@/components/ui";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revokeToken } from "../actions";
import { TokenForm } from "./token-form";

export const metadata: Metadata = { title: "API tokens" };

export default async function TokensPage() {
  const viewer = await requireViewer("/creator/tokens");
  const supabase = await createClient();
  const { data } = await supabase.from("creator_tokens").select("id, name, token_prefix, last_used_at, revoked_at, created_at").eq("creator_id", viewer.id).order("created_at", { ascending: false });
  const tokens = data ?? [];
  return (
    <div className="flex max-w-[960px] flex-col gap-12">
      <header className="flex flex-col gap-3">
        <span className="label">For the CLI and CI</span>
        <h1 className="display text-[clamp(36px,5vw,64px)] text-text">API tokens</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-text-dim">
          <code className="font-mono text-text">thumbcade login</code> creates one for you in the browser. Make one here for CI. Tokens can publish
          new versions of your games — nothing else.
        </p>
      </header>
      {viewer.role === "user" ? (
        <EmptyState title="Become a creator first." body="Tokens are for creator accounts. Set up your handle on the Games page." />
      ) : (
        <>
          <TokenForm />
          {tokens.length === 0 ? (
            <p className="rule-t py-6 text-[15px] text-text-mute">No tokens yet.</p>
          ) : (
            <ul className="rule-t">
              {tokens.map((t) => (
                <li key={t.id} className="rule-b grid grid-cols-[1fr_auto] items-center gap-4 py-4 md:grid-cols-[1fr_160px_160px_auto]">
                  <span className="flex items-center gap-3">
                    <StatusDot tone={t.revoked_at ? "failed" : "live"} />
                    <span className="text-[15px] text-text">{t.name}</span>
                    <code className="font-mono text-[12px] text-text-mute">{t.token_prefix}…</code>
                  </span>
                  <span className="hidden font-mono text-[12px] text-text-mute md:block">created {formatRelative(t.created_at)}</span>
                  <span className="hidden font-mono text-[12px] text-text-mute md:block">{t.last_used_at ? `used ${formatRelative(t.last_used_at)}` : "never used"}</span>
                  {t.revoked_at ? (
                    <span className="label">Revoked</span>
                  ) : (
                    <form action={revokeToken}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="h-8 rounded-pill px-3 text-[13px] font-semibold text-heat hover:bg-heat/10">
                        Revoke
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
