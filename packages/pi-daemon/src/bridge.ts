/**
 * Browser-bridge protocol between the daemon (Pi's `browser` tool) and the
 * Chrome extension. The daemon issues a `ToolRequest`; the extension executes
 * it on the live tab and returns a `ToolResponse` with the same `id`.
 */
export interface ToolRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface CorrelatorOptions {
  /** Send an outgoing request frame over the transport (e.g. a WebSocket). */
  send: (request: ToolRequest) => void;
  /** Per-request timeout in ms. Omit (or 0) to wait indefinitely. */
  timeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Correlates request/response over a single message channel: each `request`
 * gets a unique id and a promise that settles when the matching `ToolResponse`
 * is fed in via `resolve`. Transport-agnostic — it only needs a `send`
 * function — so it's testable without a real WebSocket. On disconnect, call
 * `rejectAll` to fail everything in flight.
 *
 * Use one correlator per channel: ids are unique only within a correlator's own
 * pending map, so sharing one across two sockets (or two across one) breaks
 * correlation.
 */
export class RequestCorrelator {
  private seq = 0;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly opts: CorrelatorOptions) {}

  /** Issue a tool request; resolves with its result (or rejects on error/timeout). */
  request(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const id = `req-${++this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer =
        this.opts.timeoutMs && this.opts.timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`tool '${tool}' timed out after ${this.opts.timeoutMs}ms`));
            }, this.opts.timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.opts.send({ id, tool, args });
      } catch (err) {
        // Delivery failed synchronously — don't leave the entry/timer dangling.
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Settle the request matching `response.id`. Returns false if no such request
   * is pending (a stale/duplicate/unknown response).
   */
  resolve(response: ToolResponse): boolean {
    const p = this.pending.get(response.id);
    if (!p) return false;
    this.pending.delete(response.id);
    clearTimeout(p.timer); // no-op when undefined
    if (response.ok) p.resolve(response.result);
    else p.reject(new Error(response.error ?? "tool request failed"));
    return true;
  }

  /** Reject every in-flight request (e.g. the extension disconnected). */
  rejectAll(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer); // no-op when undefined
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
