"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { WebCard, WebViewer } from "./types";

/** Like / save / follow with optimistic updates. Members only; guests get `needsAuth`. */
export function useSocial(card: WebCard, viewer: WebViewer | null, onNeedsAuth: (action: string) => void) {
  const supabase = useMemo(() => createClient(), []);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [following, setFollowing] = useState(false);
  const [counts, setCounts] = useState({ likes: card.stats.likes, saves: card.stats.saves });

  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    void (async () => {
      const [l, s, f] = await Promise.all([
        supabase.from("likes").select("game_id").eq("user_id", viewer.id).eq("game_id", card.id).maybeSingle(),
        supabase.from("saves").select("game_id").eq("user_id", viewer.id).eq("game_id", card.id).maybeSingle(),
        supabase.from("follows").select("followee_id").eq("follower_id", viewer.id).eq("followee_id", card.creator.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setLiked(!!l.data);
      setSaved(!!s.data);
      setFollowing(!!f.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, viewer, card.id, card.creator.id]);

  const toggleLike = useCallback(async () => {
    if (!viewer) return onNeedsAuth("like");
    const next = !liked;
    setLiked(next);
    setCounts((c) => ({ ...c, likes: c.likes + (next ? 1 : -1) }));
    const res = next
      ? await supabase.from("likes").insert({ user_id: viewer.id, game_id: card.id })
      : await supabase.from("likes").delete().eq("user_id", viewer.id).eq("game_id", card.id);
    if (res.error) {
      setLiked(!next);
      setCounts((c) => ({ ...c, likes: c.likes + (next ? -1 : 1) }));
    }
  }, [viewer, liked, supabase, card.id, onNeedsAuth]);

  const toggleSave = useCallback(async () => {
    if (!viewer) return onNeedsAuth("save");
    const next = !saved;
    setSaved(next);
    setCounts((c) => ({ ...c, saves: c.saves + (next ? 1 : -1) }));
    const res = next
      ? await supabase.from("saves").insert({ user_id: viewer.id, game_id: card.id })
      : await supabase.from("saves").delete().eq("user_id", viewer.id).eq("game_id", card.id);
    if (res.error) {
      setSaved(!next);
      setCounts((c) => ({ ...c, saves: c.saves + (next ? -1 : 1) }));
    }
  }, [viewer, saved, supabase, card.id, onNeedsAuth]);

  const toggleFollow = useCallback(async () => {
    if (!viewer) return onNeedsAuth("follow");
    if (viewer.id === card.creator.id) return;
    const next = !following;
    setFollowing(next);
    const res = next
      ? await supabase.from("follows").insert({ follower_id: viewer.id, followee_id: card.creator.id })
      : await supabase.from("follows").delete().eq("follower_id", viewer.id).eq("followee_id", card.creator.id);
    if (res.error) setFollowing(!next);
  }, [viewer, following, supabase, card.creator.id, onNeedsAuth]);

  return { liked, saved, following, counts, toggleLike, toggleSave, toggleFollow };
}
