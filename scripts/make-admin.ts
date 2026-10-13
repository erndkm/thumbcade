/**
 * Creates (if needed) a member account and makes it an admin.
 * Usage: pnpm exec tsx scripts/make-admin.ts admin@thumbcade.dev [handle] [displayName]
 */
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const [email = "admin@thumbcade.dev", handle = "admin", displayName = "Thumbcade Review"] = process.argv.slice(2);
const status = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString()) as Record<string, string>;
const admin = createClient(status.API_URL!, status.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
let user = list.users.find((u) => u.email === email);
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { handle, display_name: displayName } });
  if (error) throw error;
  user = data.user;
}
const { error } = await admin.from("profiles").update({ role: "admin", verified: true, is_guest: false, handle, display_name: displayName }).eq("id", user.id);
if (error) throw error;
console.log(`${email} (@${handle}) is now an admin. Sign in at http://localhost:3000/login with an email code (Mailpit: http://127.0.0.1:54324).`);
