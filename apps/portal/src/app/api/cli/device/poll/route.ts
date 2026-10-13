import { createHash } from "node:crypto";
import type { DeviceCodePollResponse } from "@thumbcade/protocol";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const Body = z.object({ deviceCode: z.string().regex(/^[a-f0-9]{64}$/) });

/** The CLI polls until the user approves; the plaintext token is handed out exactly once. */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const admin = createServiceClient();
  const hash = createHash("sha256").update(parsed.data.deviceCode).digest("hex");
  const { data } = await admin.from("cli_device_codes").select("expires_at, approved_at, token_plain_once, creator_id").eq("device_code_hash", hash).maybeSingle();
  let body: DeviceCodePollResponse;
  if (!data || new Date(data.expires_at).getTime() < Date.now()) {
    body = { status: "expired" };
  } else if (data.approved_at && data.token_plain_once && data.creator_id) {
    const { data: p } = await admin.from("profiles").select("handle").eq("id", data.creator_id).single();
    await admin.from("cli_device_codes").update({ token_plain_once: null }).eq("device_code_hash", hash);
    body = { status: "approved", token: data.token_plain_once, handle: p?.handle ?? "" };
  } else if (data.approved_at) {
    body = { status: "expired" };
  } else {
    body = { status: "pending" };
  }
  return NextResponse.json(body);
}
