import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MANIFEST_SCHEMA_URL, ManifestSchema } from "../src/manifest.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../dist/manifest-v1.schema.json");
const schema = {
  ...z.toJSONSchema(ManifestSchema, { io: "input" }),
  $id: MANIFEST_SCHEMA_URL,
  title: "Thumbcade game manifest (thumbcade.json)",
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(schema, null, 2) + "\n");
console.log(`wrote ${out}`);
