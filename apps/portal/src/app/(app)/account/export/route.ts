import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { callFunction } from "@/lib/functions";

/** Downloads everything stored about the signed-in account as JSON (account-export, GDPR Art. 15/20). */
export async function GET(request: NextRequest) {
  if (!(await getViewer())) return NextResponse.redirect(new URL("/login?next=/account", request.url), { status: 303 });
  const res = await callFunction("account-export");
  if (!res.ok) return NextResponse.redirect(new URL("/account?export=failed", request.url), { status: 303 });
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": res.headers.get("content-disposition") ?? 'attachment; filename="thumbcade-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
