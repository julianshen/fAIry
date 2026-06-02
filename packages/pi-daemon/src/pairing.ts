import { randomBytes } from "node:crypto";

export interface PairingStoreOptions {
  /** The session token a valid code redeems to. */
  token: string;
  /** Pre-set code (mainly for tests); otherwise a strong one is minted. */
  code?: string;
  /** Optional expiry from creation, in ms. Omit for no expiry. */
  ttlMs?: number;
  /** Injected clock for TTL (defaults to `Date.now`). */
  now?: () => number;
}

export interface PairingStore {
  /** The current pairing code — surfaced to the user (e.g. written to `pairing.json`). */
  readonly code: string;
  /** Redeem a code for the session token: single-use, and unexpired if a TTL is set. */
  redeem(code: string): string | null;
}

/**
 * A single-use pairing code that hands the session token to the file-less Chrome
 * extension: the daemon writes {@link PairingStore.code} to a `0600` file the
 * trusted shell reads and shows; the user copies it into the extension, which
 * redeems it (over the HTTP `/pair` endpoint) for the token. Strong (128-bit) so
 * it isn't guessable, single-use so a redeemed/observed code can't be replayed.
 */
export function createPairingStore(opts: PairingStoreOptions): PairingStore {
  const token = opts.token;
  const code = opts.code ?? randomBytes(16).toString("base64url");
  const now = opts.now ?? Date.now;
  const expiresAt = opts.ttlMs !== undefined ? now() + opts.ttlMs : undefined;
  let used = false;

  return {
    code,
    redeem(input) {
      if (used) return null;
      if (expiresAt !== undefined && now() >= expiresAt) return null;
      if (input !== code) return null;
      used = true;
      return token;
    },
  };
}
