/** Share / challenge codes: 8 chars of base62 from a CSPRNG (rejection sampling, no modulo bias). */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function shareCode(length = 8): string {
  let out = "";
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export const SHARE_CODE_PATTERN = /^[A-Za-z0-9]{6,12}$/;
