"use server";
import { HASHTAG_PATTERN, HEX_COLOR_PATTERN } from "@thumbcade/protocol";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string; token?: string } | null;

export async function becomeCreator(_: FormState, form: FormData): Promise<FormState> {
  const viewer = await requireViewer("/creator");
  const handle = String(form.get("handle") ?? "").trim().toLowerCase();
  const displayName = String(form.get("displayName") ?? "").trim();
  if (!/^[a-z0-9_.]{3,24}$/.test(handle)) return { error: "Handles are 3–24 characters: a–z, 0–9, dot and underscore." };
  if (displayName.length < 1 || displayName.length > 40) return { error: "Display name needs 1–40 characters." };
  if (form.get("terms") !== "on") return { error: "Accept the creator terms to continue." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ handle, display_name: displayName }).eq("id", viewer.id);
  if (error) return { error: error.code === "23505" ? `@${handle} is taken. Try another.` : "Couldn't save your profile." };
  const { error: rpcError } = await supabase.rpc("become_creator");
  if (rpcError) return { error: "Couldn't enable creator tools for this account." };
  revalidatePath("/creator");
  redirect("/creator");
}

export async function updateGame(_: FormState, form: FormData): Promise<FormState> {
  const slug = String(form.get("slug") ?? "");
  await requireViewer(`/creator/games/${slug}`);
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const accent = String(form.get("accentColor") ?? "").trim();
  const tags = String(form.get("tags") ?? "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").toLowerCase())
    .filter(Boolean);
  const iconUrl = String(form.get("iconUrl") ?? "").trim() || null;
  if (name.length < 1 || name.length > 32) return { error: "Names are 1–32 characters." };
  if (description.length < 1 || description.length > 120) return { error: "Descriptions are 1–120 characters." };
  if (!HEX_COLOR_PATTERN.test(accent)) return { error: "Accent must be a 6-digit hex color like #FF6A1A." };
  if (tags.length < 1 || tags.length > 5 || !tags.every((t) => HASHTAG_PATTERN.test(t))) return { error: "Use 1–5 hashtags: lowercase letters, digits and underscores." };
  const supabase = await createClient();
  const patch: { name: string; description: string; accent_color: string; tags: string[]; icon_url?: string } = { name, description, accent_color: accent, tags: [...new Set(tags)] };
  if (iconUrl) patch.icon_url = iconUrl;
  const { error } = await supabase.from("games").update(patch).eq("slug", slug);
  if (error) return { error: "Couldn't save. You can only edit your own games." };
  revalidatePath(`/creator/games/${slug}`);
  return { ok: "Saved. Changes show in the feed right away." };
}

export async function rollback(form: FormData) {
  const versionId = String(form.get("versionId") ?? "");
  const slug = String(form.get("slug") ?? "");
  await requireViewer(`/creator/games/${slug}`);
  const supabase = await createClient();
  await supabase.rpc("rollback_to_version", { p_version_id: versionId });
  revalidatePath(`/creator/games/${slug}`);
}

export async function createToken(_: FormState, form: FormData): Promise<FormState> {
  await requireViewer("/creator/tokens");
  const name = String(form.get("name") ?? "").trim() || "CLI";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_creator_token", { token_name: name.slice(0, 60) });
  if (error || !data?.[0]) return { error: "Couldn't create a token. Only creators can." };
  revalidatePath("/creator/tokens");
  return { ok: `Created “${name}”.`, token: data[0].token };
}

export async function revokeToken(form: FormData) {
  await requireViewer("/creator/tokens");
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  await supabase.from("creator_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/creator/tokens");
}
