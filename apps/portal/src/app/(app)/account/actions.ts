"use server";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { callFunction } from "@/lib/functions";
import { createClient } from "@/lib/supabase/server";

export type DeleteState = { error?: string } | null;

/** Deletes the signed-in account and everything tied to it (account-delete), then clears the session cookie. */
export async function deleteAccount(_: DeleteState, form: FormData): Promise<DeleteState> {
  await requireViewer("/account");
  if (String(form.get("confirm") ?? "").trim() !== "DELETE") return { error: "Type DELETE to confirm." };
  const res = await callFunction("account-delete", { body: {} });
  if (!res.ok) return { error: "Deletion failed. Nothing was removed. Try again." };
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/account/deleted");
}
