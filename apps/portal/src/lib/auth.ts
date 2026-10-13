import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Viewer = {
  id: string;
  email: string | null;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  avatarSeed: string;
  role: "user" | "creator" | "admin";
  isGuest: boolean;
};

export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user || user.is_anonymous) return null;
  const { data: p } = await supabase
    .from("profiles")
    .select("handle, display_name, avatar_url, avatar_seed, role, is_guest")
    .eq("id", user.id)
    .single();
  if (!p) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    handle: p.handle,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    avatarSeed: p.avatar_seed,
    role: p.role,
    isGuest: p.is_guest,
  };
}

export async function requireViewer(next: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}

export async function requireAdmin(next: string): Promise<Viewer> {
  const viewer = await requireViewer(next);
  if (viewer.role !== "admin") redirect("/creator");
  return viewer;
}
