import * as Crypto from "expo-crypto";

const cache = new Map<string, string>();

/** Opaque, stable per (user, game) id for the SDK. Never the real user id. */
export async function opaquePlayerId(userId: string, gameId: string): Promise<string> {
  const key = `${userId}:${gameId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
  const id = `p_${digest.slice(0, 24)}`;
  cache.set(key, id);
  return id;
}
