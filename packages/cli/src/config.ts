import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CREATOR_TOKEN_PREFIX, LOCAL_ENDPOINTS } from "@thumbcade/protocol";

const run = promisify(execFile);

export interface Endpoints {
  portalUrl: string;
  functionsUrl: string;
}

/** Local stack by default; point the CLI elsewhere with THUMBCADE_PORTAL_URL / THUMBCADE_FUNCTIONS_URL. */
export function endpoints(): Endpoints {
  return {
    portalUrl: (process.env.THUMBCADE_PORTAL_URL ?? LOCAL_ENDPOINTS.portalUrl).replace(/\/$/, ""),
    functionsUrl: (process.env.THUMBCADE_FUNCTIONS_URL ?? LOCAL_ENDPOINTS.functionsUrl).replace(/\/$/, ""),
  };
}

export function configDir(): string {
  if (process.env.THUMBCADE_CONFIG_DIR) return process.env.THUMBCADE_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "thumbcade");
}

/** Credentials are per backend (local, staging, production). */
export function profileKey(e: Endpoints = endpoints()): string {
  return new URL(e.functionsUrl).host;
}

interface Stored {
  profiles: Record<string, { handle?: string; token?: string; storedIn: "keychain" | "file"; savedAt: string }>;
}

async function readStore(): Promise<Stored> {
  try {
    return JSON.parse(await readFile(join(configDir(), "credentials.json"), "utf8")) as Stored;
  } catch {
    return { profiles: {} };
  }
}

async function writeStore(s: Stored): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const file = join(configDir(), "credentials.json");
  await writeFile(file, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

const SERVICE = "thumbcade-cli";
const keychainDisabled = () => process.env.THUMBCADE_NO_KEYCHAIN === "1";

/** OS keychain: macOS `security`, Linux `secret-tool` (libsecret). Returns false when unavailable. */
async function keychainSet(account: string, token: string): Promise<boolean> {
  if (keychainDisabled()) return false;
  try {
    if (platform() === "darwin") {
      await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", token]);
      return true;
    }
    if (platform() === "linux") {
      const child = execFile("secret-tool", ["store", "--label=Thumbcade CLI", "service", SERVICE, "account", account]);
      child.stdin?.end(token);
      return await new Promise((resolve) => child.on("exit", (code) => resolve(code === 0)).on("error", () => resolve(false)));
    }
  } catch {
    /* fall back to the file store */
  }
  return false;
}

async function keychainGet(account: string): Promise<string | null> {
  if (keychainDisabled()) return null;
  try {
    if (platform() === "darwin") return (await run("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"])).stdout.trim() || null;
    if (platform() === "linux") return (await run("secret-tool", ["lookup", "service", SERVICE, "account", account])).stdout.trim() || null;
  } catch {
    /* not found */
  }
  return null;
}

async function keychainDelete(account: string): Promise<void> {
  if (keychainDisabled()) return;
  try {
    if (platform() === "darwin") await run("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    else if (platform() === "linux") await run("secret-tool", ["clear", "service", SERVICE, "account", account]);
  } catch {
    /* nothing stored */
  }
}

export function isCreatorToken(token: string): boolean {
  return token.startsWith(CREATOR_TOKEN_PREFIX) && /^tc_[a-f0-9]{48}$/.test(token);
}

export async function saveToken(token: string, handle: string | undefined): Promise<"keychain" | "file"> {
  const key = profileKey();
  const store = await readStore();
  const inKeychain = await keychainSet(key, token);
  store.profiles[key] = {
    handle,
    ...(inKeychain ? {} : { token }),
    storedIn: inKeychain ? "keychain" : "file",
    savedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return inKeychain ? "keychain" : "file";
}

/** THUMBCADE_TOKEN wins (CI), then the keychain, then the file store. */
export async function loadToken(): Promise<{ token: string; handle?: string; source: string } | null> {
  if (process.env.THUMBCADE_TOKEN) return { token: process.env.THUMBCADE_TOKEN, source: "THUMBCADE_TOKEN" };
  const key = profileKey();
  const store = await readStore();
  const p = store.profiles[key];
  if (!p) return null;
  if (p.storedIn === "keychain") {
    const t = await keychainGet(key);
    return t ? { token: t, handle: p.handle, source: "keychain" } : null;
  }
  return p.token ? { token: p.token, handle: p.handle, source: join(configDir(), "credentials.json") } : null;
}

export async function clearToken(): Promise<boolean> {
  const key = profileKey();
  const store = await readStore();
  const had = !!store.profiles[key];
  await keychainDelete(key);
  delete store.profiles[key];
  await writeStore(store);
  return had;
}
