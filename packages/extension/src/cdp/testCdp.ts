import type { CdpClient } from "./cdpClient";

/** A {@link CdpClient} that records every send and replays canned results keyed by method. */
export interface RecordingCdpClient extends CdpClient {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }>;
}

/**
 * Shared handler-test double (the `testSocket.ts` pattern, for the CDP seam):
 * records each `send({method, params})` and resolves the response registered
 * for that method (or `undefined`). Handlers that need *sequenced* per-call
 * results define a local variant instead.
 */
export function fakeCdp(responses: Record<string, unknown> = {}): RecordingCdpClient {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return {
    calls,
    send(method, params) {
      calls.push({ method, params });
      return Promise.resolve(responses[method]);
    },
  };
}
