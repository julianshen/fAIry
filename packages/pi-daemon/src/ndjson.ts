/**
 * Newline-delimited JSON (NDJSON) framing — one JSON value per line.
 *
 * Both transports the daemon speaks use this: Pi's RPC over the subprocess'
 * stdin/stdout, and the loopback bridge to the Chrome extension. The framing
 * is identical, so it lives here once instead of being re-inlined per transport.
 */

export type LineErrorHandler = (line: string, error: Error) => void;

/** Serialize a value as one NDJSON line (JSON + trailing "\n"). */
export function encodeLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/**
 * Stateful decoder for an NDJSON byte stream. Feed it chunks with `push`; it
 * buffers partial lines across chunks and returns the values for every line
 * completed so far. Blank lines are skipped and `\r\n` is tolerated.
 *
 * A malformed line is routed to the `onError` handler if one was supplied
 * (decoding continues with the remaining lines); otherwise `push` throws.
 */
export class LineDecoder {
  private buffer = "";

  constructor(private readonly onError?: LineErrorHandler) {}

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const out: unknown[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) continue;
      try {
        out.push(JSON.parse(line));
      } catch (err) {
        const error = err as Error;
        if (this.onError) this.onError(line, error);
        else throw new Error(`LineDecoder: malformed JSON line: ${error.message}`);
      }
    }
    return out;
  }

  /** Bytes buffered while awaiting the next newline (diagnostics/tests). */
  get pending(): string {
    return this.buffer;
  }
}
