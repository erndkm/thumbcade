import { DeviceCodePollResponseSchema, DeviceCodeStartResponseSchema, PublishResponseSchema, type PublishResponse } from "@thumbcade/protocol";
import { endpoints } from "./config.ts";
import { CliError } from "./ui.ts";

/** The well-known anon key of a local Supabase stack (public; printed by `supabase status`). */
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export interface ApiError {
  error: string;
  message: string;
  issues?: string[];
}

/**
 * Calls a creator-* function with the creator token as the bearer (protocol publish.ts). If the
 * functions gateway insists on a JWT (verify_jwt still on), retries with the project's anon key as the
 * bearer and the creator token in `x-thumbcade-token`.
 */
export async function callFunction(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const url = `${endpoints().functionsUrl}/${path}`;
  const attempt = (headers: Record<string, string>) =>
    fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...headers } }).catch((err: unknown) => {
      throw new CliError(`Can't reach ${endpoints().functionsUrl} (${err instanceof Error ? err.message : String(err)}).`, "Is the backend running? Locally: supabase start. Elsewhere: set THUMBCADE_FUNCTIONS_URL.");
    });
  let res = await attempt({ authorization: `Bearer ${token}` });
  if (res.status === 401 && /JWT/i.test(res.headers.get("sb-error-code") ?? "")) {
    const anon = process.env.THUMBCADE_ANON_KEY ?? LOCAL_ANON_KEY;
    // FormData bodies are re-serialized per fetch, so the same init can be sent again.
    res = await attempt({ authorization: `Bearer ${anon}`, apikey: anon, "x-thumbcade-token": token });
  }
  return res;
}

export async function readError(res: Response): Promise<ApiError> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as Partial<ApiError> & { msg?: string };
    return { error: body.error ?? String(res.status), message: body.message ?? body.msg ?? text, issues: body.issues };
  } catch {
    return { error: String(res.status), message: text.slice(0, 300) || res.statusText };
  }
}

export interface WhoAmI {
  handle: string;
  displayName: string;
  role: string;
  games: Array<{ slug: string; name: string; status: string; liveVersionId: string | null }>;
}

export async function whoami(token: string): Promise<WhoAmI> {
  const res = await callFunction("creator-publish", token);
  if (!res.ok) {
    const e = await readError(res);
    throw new CliError(e.message, res.status === 401 ? "Run `thumbcade login` to get a fresh token." : undefined);
  }
  return (await res.json()) as WhoAmI;
}

export async function publishBundle(token: string, manifestJson: string, zip: Uint8Array, notes?: string): Promise<PublishResponse> {
  const body = () => {
    const form = new FormData();
    form.set("manifest", manifestJson);
    form.set("bundle", new Blob([zip as BlobPart], { type: "application/zip" }), "bundle.zip");
    if (notes) form.set("notes", notes);
    return form;
  };
  const res = await callFunction("creator-publish", token, { method: "POST", body: body() });
  if (!res.ok) {
    const e = await readError(res);
    const hint = res.status === 401 ? "Run `thumbcade login` to get a fresh token." : undefined;
    throw new CliError(`${e.message}${e.issues?.length ? `\n  - ${e.issues.join("\n  - ")}` : ""}`, hint);
  }
  return PublishResponseSchema.parse(await res.json());
}

export interface VersionStatus {
  versionId: string;
  slug: string;
  semver: string;
  status: string;
  reviewUrl: string;
  reviewNotes: string | null;
  report: { passed: boolean; checks: Array<{ id: string; label: string; status: string; detail?: string }> } | null;
}

export async function versionStatus(token: string, versionId: string): Promise<VersionStatus> {
  const res = await callFunction(`creator-publish?versionId=${encodeURIComponent(versionId)}`, token);
  if (!res.ok) throw new CliError((await readError(res)).message);
  return (await res.json()) as VersionStatus;
}

export async function startDeviceLogin() {
  const res = await fetch(`${endpoints().portalUrl}/api/cli/device`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(
    (err: unknown) => {
      throw new CliError(`Can't reach the portal at ${endpoints().portalUrl} (${err instanceof Error ? err.message : String(err)}).`, "Start the portal, set THUMBCADE_PORTAL_URL, or log in with `thumbcade login --token tc_…` (tokens live in the portal under API tokens).");
    },
  );
  if (!res.ok) throw new CliError(`The portal refused the login request (${res.status}).`, "Try `thumbcade login --token tc_…` with a token from the portal.");
  return DeviceCodeStartResponseSchema.parse(await res.json());
}

export async function pollDeviceLogin(deviceCode: string) {
  const res = await fetch(`${endpoints().portalUrl}/api/cli/device/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });
  if (!res.ok) throw new CliError(`The portal answered ${res.status} while waiting for approval.`);
  return DeviceCodePollResponseSchema.parse(await res.json());
}
