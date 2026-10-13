"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminState = { error?: string } | null;

export async function decide(_: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin("/admin");
  const versionId = String(form.get("versionId") ?? "");
  const decision = String(form.get("decision") ?? "");
  const notes = String(form.get("notes") ?? "").trim();
  const supabase = await createClient();
  if (decision === "approve") {
    const { error } = await supabase.rpc("approve_version", { p_version_id: versionId, p_notes: notes || undefined });
    if (error) return { error: error.message };
  } else if (decision === "reject") {
    if (notes.length < 10) return { error: "Tell the creator what to fix (at least a sentence)." };
    const { error } = await supabase.rpc("reject_version", { p_version_id: versionId, p_notes: notes });
    if (error) return { error: error.message };
  } else {
    return { error: "Pick approve or reject." };
  }
  revalidatePath("/admin");
  redirect("/admin");
}

export async function resolveReport(form: FormData) {
  const viewer = await requireAdmin("/admin/reports");
  const id = String(form.get("id") ?? "");
  const action = String(form.get("action") ?? "");
  const targetType = String(form.get("targetType") ?? "");
  const targetId = String(form.get("targetId") ?? "");
  const supabase = await createClient();
  if (action === "takedown" && targetType === "game") {
    await supabase.rpc("takedown_game", { p_game_id: targetId, p_reason: "Removed after a report" });
  } else if (action === "hide" && targetType === "comment") {
    await supabase.from("comments").update({ status: "removed" }).eq("id", targetId);
    await supabase.from("reports").update({ status: "actioned", resolved_by: viewer.id, resolved_at: new Date().toISOString(), resolution_note: "Comment removed" }).eq("id", id);
  } else if (action === "dismiss") {
    await supabase.from("reports").update({ status: "dismissed", resolved_by: viewer.id, resolved_at: new Date().toISOString() }).eq("id", id);
  } else if (action === "actioned") {
    await supabase.from("reports").update({ status: "actioned", resolved_by: viewer.id, resolved_at: new Date().toISOString(), resolution_note: "Handled" }).eq("id", id);
  }
  revalidatePath("/admin/reports");
}

export async function saveRow(form: FormData) {
  await requireAdmin("/admin/editorial");
  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const subtitle = String(form.get("subtitle") ?? "").trim() || null;
  const slugs = String(form.get("games") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  const active = form.get("active") === "on";
  const position = Number(form.get("position") ?? 0) || 0;
  const supabase = await createClient();
  const { data: games } = await supabase.from("games").select("id, slug").in("slug", slugs.length ? slugs : ["__none__"]);
  const order = new Map(slugs.map((s, i) => [s, i]));
  const gameIds = (games ?? []).sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0)).map((g) => g.id);
  if (!title) return;
  if (id) {
    await supabase.from("editorial_rows").update({ title, subtitle, game_ids: gameIds, active, position }).eq("id", id);
  } else {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `row-${Date.now()}`;
    await supabase.from("editorial_rows").insert({ title, subtitle, game_ids: gameIds, active, position, slug });
  }
  revalidatePath("/admin/editorial");
}

export async function deleteRow(form: FormData) {
  await requireAdmin("/admin/editorial");
  const supabase = await createClient();
  await supabase.from("editorial_rows").delete().eq("id", String(form.get("id") ?? ""));
  revalidatePath("/admin/editorial");
}
