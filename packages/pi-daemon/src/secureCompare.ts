import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality (compared as UTF-8 bytes). Used for auth-token
 * and pairing-code checks: those endpoints accept unlimited attempts with no
 * rate limit, so a non-constant-time compare could leak the secret byte-by-byte
 * via response timing. A length mismatch returns false immediately — the secrets
 * here are fixed-length, so their length isn't sensitive.
 */
export function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
