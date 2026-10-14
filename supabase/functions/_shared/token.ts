/**
 * Signed play-session tokens: `<base64url(payload)>.<base64url(hmac-sha256)>`.
 * Pure Web Crypto, so it runs in Deno (edge runtime) and Node (tests) alike.
 */

export interface SessionClaims {
  /** play_sessions.id */
  sid: string;
  /** auth user id */
  uid: string;
  /** game id */
  gid: string;
  /** issued at, ms since epoch */
  iat: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSessionToken(claims: SessionClaims, secret: string): Promise<string> {
  if (!secret || secret.length < 16) throw new Error("SESSION_SIGNING_SECRET must be at least 16 characters");
  const body = base64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${base64url(sig)}`;
}

/** Returns the claims when the signature is valid and the token is not older than `maxAgeMs`. */
export async function verifySessionToken(
  token: string,
  secret: string,
  opts: { now?: number; maxAgeMs?: number } = {},
): Promise<SessionClaims | null> {
  // Same floor as signing: with a missing secret anyone could mint an empty-key HMAC.
  if (!secret || secret.length < 16) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let sig: Uint8Array;
  try {
    sig = fromBase64url(parts[1]);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig as BufferSource, enc.encode(parts[0]));
  if (!ok) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(dec.decode(fromBase64url(parts[0]))) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.sid !== "string" || typeof claims.uid !== "string" || typeof claims.gid !== "string" || typeof claims.iat !== "number") {
    return null;
  }
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeMs ?? 6 * 60 * 60 * 1000;
  if (claims.iat > now + 60_000 || now - claims.iat > maxAge) return null;
  return claims;
}
