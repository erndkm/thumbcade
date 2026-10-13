import { createHash, randomBytes } from "node:crypto";
import type { DeviceCodeStartResponse } from "@thumbcade/protocol";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"; // no vowels (no accidental words), no 0/O/1/I

function userCode(): string {
  const b = randomBytes(8);
  const chars = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/** Starts a CLI device-code login. */
export async function POST() {
  const admin = createServiceClient();
  const deviceCode = randomBytes(32).toString("hex");
  const code = userCode();
  const expiresIn = 600;
  const { error } = await admin.from("cli_device_codes").insert({
    device_code_hash: createHash("sha256").update(deviceCode).digest("hex"),
    user_code: code,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });
  if (error) return NextResponse.json({ error: "could_not_start" }, { status: 500 });
  const body: DeviceCodeStartResponse = {
    deviceCode,
    userCode: code,
    verificationUrl: `${env.siteUrl}/cli/activate?code=${code}`,
    expiresIn,
    interval: 2,
  };
  return NextResponse.json(body);
}
