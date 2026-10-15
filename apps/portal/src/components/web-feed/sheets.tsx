"use client";
import { formatRelative, formatScore } from "@thumbcade/protocol";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Avatar } from "../avatar";
import { Icon } from "../icon";
import type { WebCard, WebViewer } from "./types";

export function Sheet({ open, onClose, children, label, tall }: { open: boolean; onClose: () => void; children: ReactNode; label: string; tall?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div className={`absolute inset-0 z-30 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className="absolute inset-0 bg-black/55 transition-opacity duration-200"
        style={{ opacity: open ? 1 : 0 }}
      />
      <div
        role="dialog"
        aria-label={label}
        className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[24px] border-t border-white/10 bg-ink-1 transition-transform duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: open ? "translateY(0)" : "translateY(104%)", maxHeight: tall ? "74%" : "60%", height: tall ? "74%" : undefined }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/20" />
        {children}
      </div>
    </div>
  );
}

export function AuthPrompt({ action, onClose, next }: { action: string | null; onClose: () => void; next: string }) {
  const verb = action ?? "join in";
  return (
    <Sheet open={action !== null} onClose={onClose} label="Sign in">
      <div className="flex flex-col gap-4 px-6 pb-7 pt-5">
        <span className="label">Members only</span>
        <h3 className="font-wide text-[24px] font-extrabold leading-7 tracking-tight text-paper">Sign in to {verb}.</h3>
        <p className="text-[14px] leading-5 text-paper/70">Guests can play everything. An account keeps your likes, your saves and your best scores — on the web and in the app.</p>
        <div className="mt-2 flex gap-3">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="flex h-12 flex-1 items-center justify-center rounded-pill bg-accent font-semiwide text-[15px] font-bold text-on-accent">
            Sign in
          </Link>
          <button type="button" onClick={onClose} className="h-12 flex-1 rounded-pill border border-white/15 font-semiwide text-[15px] font-bold text-paper">
            Not now
          </button>
        </div>
      </div>
    </Sheet>
  );
}

type CommentRow = {
  id: string;
  body: string;
  created_at: string;
  like_count: number;
  reply_count: number;
  score_badge: number | null;
  is_pinned: boolean;
  user: { handle: string; display_name: string; avatar_url: string | null; avatar_seed: string } | null;
};

export function CommentsSheet({
  card,
  onClose,
  viewer,
  onNeedsAuth,
}: {
  card: WebCard | null;
  onClose: () => void;
  viewer: WebViewer | null;
  onNeedsAuth: (action: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameId = card?.id;

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setRows(null);
    void supabase
      .from("comments")
      .select("id, body, created_at, like_count, reply_count, score_badge, is_pinned, user:profiles ( handle, display_name, avatar_url, avatar_seed )")
      .eq("game_id", gameId)
      .is("parent_id", null)
      .eq("status", "visible")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60)
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as unknown as CommentRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, supabase]);

  async function post() {
    if (!viewer || !card) return onNeedsAuth("comment");
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("comments")
      .insert({ game_id: card.id, user_id: viewer.id, body })
      .select("id, body, created_at, like_count, reply_count, score_badge, is_pinned, user:profiles ( handle, display_name, avatar_url, avatar_seed )")
      .single();
    setPosting(false);
    if (err || !data) {
      setError("That didn't post. Check your connection and try again.");
      return;
    }
    setDraft("");
    setRows((r) => [data as unknown as CommentRow, ...(r ?? [])]);
  }

  return (
    <Sheet open={card !== null} onClose={onClose} label="Comments" tall>
      <div className="flex items-center justify-between px-5 pb-3 pt-3">
        <span className="font-semiwide text-[15px] font-bold text-paper">
          {rows ? `${rows.length} comment${rows.length === 1 ? "" : "s"}` : "Comments"}
        </span>
        <button type="button" onClick={onClose} aria-label="Close comments" className="text-paper/70 hover:text-paper">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5">
        {rows === null ? (
          <div className="flex flex-col gap-5 py-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <div className="skeleton size-9 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="skeleton h-3 w-24 rounded" />
                  <div className="skeleton h-3 w-4/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 pb-10 text-center">
            <p className="font-wide text-[18px] font-extrabold text-paper">Quiet in here.</p>
            <p className="text-[14px] text-paper/60">Post your score and start some trouble.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-5 pb-4">
            {rows.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Avatar url={c.user?.avatar_url ?? null} seed={c.user?.avatar_seed ?? c.id} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-paper/60">
                    <span className="font-semibold text-paper/85">@{c.user?.handle ?? "player"}</span>
                    {c.score_badge !== null ? (
                      <span className="rounded-[5px] bg-white/8 px-1.5 font-mono text-[11px] text-accent-text">{formatScore(c.score_badge, card?.score)}</span>
                    ) : null}
                    {c.is_pinned ? <span className="label !text-paper/50">Pinned</span> : null}
                    <span className="font-mono text-[11px]">{formatRelative(c.created_at)}</span>
                  </div>
                  <p className="mt-0.5 break-words text-[15px] leading-5 text-paper">{c.body}</p>
                </div>
                <div className="flex flex-col items-center gap-0.5 pt-1 text-paper/50">
                  <Icon name="like" size={16} />
                  <span className="font-mono text-[11px]">{c.like_count || ""}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="flex items-center gap-2 border-t border-white/10 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => !viewer && onNeedsAuth("comment")}
          maxLength={500}
          placeholder={viewer ? "Say something nice (or your score)" : "Sign in to comment"}
          className="h-11 flex-1 rounded-pill bg-white/8 px-4 text-[15px] text-paper placeholder:text-paper/40 focus:outline-none"
          aria-label="Write a comment"
        />
        <button type="submit" disabled={!draft.trim() || posting} className="flex size-11 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-30" aria-label="Post comment">
          <Icon name="forward" size={20} />
        </button>
      </form>
      {error ? <p className="px-5 pb-3 text-[13px] text-heat">{error}</p> : null}
    </Sheet>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 top-24 z-40 flex justify-center transition-all duration-200"
      style={{ opacity: message ? 1 : 0, transform: message ? "none" : "translateY(-8px)" }}
    >
      <span className="rounded-pill bg-paper px-4 py-2 font-semiwide text-[13px] font-bold text-ink-1 shadow-lg">{message}</span>
    </div>
  );
}
