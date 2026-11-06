import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/** The download QR code's target: a phone goes straight to its store, everything else to the landing's download section. */
export function GET(request: NextRequest) {
  const ua = request.headers.get("user-agent") ?? "";
  const store = /iPhone|iPad|iPod/.test(ua) ? env.appStoreUrl : /Android/.test(ua) ? env.playStoreUrl : null;
  return NextResponse.redirect(store ?? new URL("/#get", request.url));
}
