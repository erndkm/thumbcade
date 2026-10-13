"use server";
import { requireViewer } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type ActivateState = { error?: string; done?: boolean } | null;

export async function approveDevice(_: ActivateState, form: FormData): Promise<ActivateState> {
  const viewer = await requireViewer("/cli/activate");
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return { error: "Codes look like ABCD-1234." };
  const admin = createServiceClient();
  const { data: row } = await admin.from("cli_device_codes").select("device_code_hash, expires_at, approved_at").eq("user_code", code).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return { error: "That code expired or doesn't exist. Run thumbcade login again." };
  if (row.approved_at) return { error: "That code was already used." };
  // Create the token as the signed-in creator (RLS + is_creator() inside the RPC).
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_creator_token", { token_name: "thumbcade CLI" });
  if (error || !data?.[0]) return { error: "Couldn't create a token for this account." };
  await admin
    .from("cli_device_codes")
    .update({ approved_at: new Date().toISOString(), creator_id: viewer.id, token_id: data[0].id, token_plain_once: data[0].token })
    .eq("device_code_hash", row.device_code_hash);
  return { done: true };
}
