import { randomBytes } from "node:crypto";
import path from "node:path";
import { writeJsonFile } from "./fsAtomic";

/** Name of the secret file written under the daemon's appData dir. */
export const TOKEN_FILENAME = "token.json";

/**
 * Mint a fresh per-session auth token: 32 CSPRNG bytes (256 bits) encoded
 * base64url, so it's URL-safe and header-safe. A new one each daemon start
 * invalidates any token a previous session leaked.
 */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Surface the token for the trusted shell: atomically write `{ token }` to
 * `token.json` under `appData`, owner-only (`0600`). Returns the file path.
 * Atomic write-then-rename means the file is never briefly world-readable and
 * a reader never sees a half-written secret.
 */
export function writeToken(appData: string, token: string): string {
  const file = path.join(appData, TOKEN_FILENAME);
  writeJsonFile(file, { token }, 0o600);
  return file;
}
