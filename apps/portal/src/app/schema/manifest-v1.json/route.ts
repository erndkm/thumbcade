import { MANIFEST_SCHEMA_URL, ManifestSchema } from "@thumbcade/protocol";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-static";

/** JSON Schema for thumbcade.json (editors pick it up through "$schema"). */
export function GET() {
  const schema = { ...z.toJSONSchema(ManifestSchema, { io: "input" }), $id: MANIFEST_SCHEMA_URL, title: "Thumbcade game manifest (thumbcade.json)" };
  return NextResponse.json(schema, { headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
}
