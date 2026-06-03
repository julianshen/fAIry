/**
 * Buffers CDP events the agent has subscribed to, so it can fire an action and
 * then drain the events it caused with `cdpCollect`. Pure state machine: the
 * glue feeds `chrome.debugger.onEvent` into {@link CdpEventBuffer.push} and runs
 * the domain-enable that {@link CdpEventBuffer.subscribe} asks for; everything
 * here (the subscribed set, the per-method ring buffers, drain semantics) is
 * unit-tested.
 */
export interface BufferedEvent {
  at: number;
  method: string;
  params: unknown;
}

export interface CdpEventBuffer {
  /** Subscribe to a CDP event method. Returns the domain to `.enable`, or ok:false for a malformed method. */
  subscribe(method: string): { ok: boolean; domain?: string };
  /** Record an event (no-op if its method isn't subscribed). `at` is the caller's clock. */
  push(method: string, params: unknown, at: number): void;
  /** Drain buffered events for `method` (or all), up to `max`. Drained events are removed. */
  collect(method?: string, max?: number): BufferedEvent[];
  /** Stop buffering `method` (or all) and clear its events. */
  unsubscribe(method?: string): { ok: boolean; cleared: number };
  isSubscribed(method: string): boolean;
}

const DEFAULT_CAP = 1000;

export function createEventBuffer(cap: number = DEFAULT_CAP): CdpEventBuffer {
  const buffers = new Map<string, BufferedEvent[]>();

  return {
    subscribe(method) {
      const dot = method.indexOf(".");
      if (dot <= 0) return { ok: false };
      if (!buffers.has(method)) buffers.set(method, []);
      return { ok: true, domain: method.slice(0, dot) };
    },
    push(method, params, at) {
      const bucket = buffers.get(method);
      if (!bucket) return; // not subscribed
      bucket.push({ at, method, params });
      // `splice(0, …)` is O(n), so trimming on every push once at cap would be
      // O(cap) per event — costly for high-frequency domains (Network.*). Only
      // trim past a slack margin, making push amortized O(1); the buffer stays
      // bounded at ~1.5×cap between trims.
      if (bucket.length > cap * 1.5) bucket.splice(0, bucket.length - cap);
    },
    collect(method, max) {
      if (method !== undefined) {
        const bucket = buffers.get(method) ?? [];
        return max !== undefined ? bucket.splice(0, max) : bucket.splice(0);
      }
      // Drain ALL methods in global arrival order (by `at`), not bucket-by-bucket
      // — a multi-method trace (Network request/response) must read chronologically.
      const all: BufferedEvent[] = [];
      for (const bucket of buffers.values()) all.push(...bucket);
      all.sort((a, b) => a.at - b.at);
      const selected = max !== undefined ? all.slice(0, max) : all;
      const taken = new Set(selected);
      for (const bucket of buffers.values()) {
        const kept = bucket.filter((e) => !taken.has(e));
        bucket.length = 0;
        bucket.push(...kept);
      }
      return selected;
    },
    unsubscribe(method) {
      if (method === undefined) {
        const cleared = buffers.size;
        buffers.clear();
        return { ok: true, cleared };
      }
      const cleared = buffers.delete(method) ? 1 : 0;
      return { ok: true, cleared };
    },
    isSubscribed(method) {
      return buffers.has(method);
    },
  };
}
