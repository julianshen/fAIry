import { encodeLine, LineDecoder } from "./ndjson";

/** Minimal readable-stream surface this module needs (stdout/stderr). */
export interface ReadableLine {
  setEncoding(encoding: string): void;
  on(event: "data", listener: (chunk: string) => void): unknown;
}

/**
 * Minimal child-process surface — structurally satisfied by Node's
 * `child_process.ChildProcess`, which Bun also provides via its `node:child_process`
 * compatibility layer (so the daemon spawns through `node:child_process`, NOT
 * `Bun.spawn`, whose native stdio are WHATWG `ReadableStream`s with a different API).
 */
export interface ChildLike {
  stdin: { write(chunk: string): void } | null;
  stdout: ReadableLine | null;
  stderr: ReadableLine | null;
  /** Emitted after the child exits AND its stdio streams have closed. */
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  kill(signal?: string): boolean;
}

/** Spawns the child. Injected so the session is testable without a real binary. */
export type Spawner = () => ChildLike;

export interface JsonLineHandlers {
  /** A complete JSON value parsed from the child's stdout. */
  onMessage: (value: unknown) => void;
  /** Raw stderr text from the child. */
  onStderr?: (text: string) => void;
  /**
   * The child exited and its output is fully drained (wired to `close`, not
   * `exit`, so the final NDJSON line is delivered first).
   */
  onExit?: (code: number | null) => void;
  /**
   * An asynchronous failure: the child's `error` event (e.g. the process failed
   * to start) or a malformed stdout line (carrying the offending line, with the
   * parse error as `cause`). When omitted, such failures surface loudly — a
   * malformed line throws and an unhandled `error` event propagates — rather
   * than being silently swallowed. A *synchronous* throw from the injected
   * spawner surfaces from the constructor.
   */
  onError?: (error: Error) => void;
}

/**
 * A child process you exchange newline-delimited JSON with — write values to
 * its stdin, receive parsed values from its stdout. This is the transport
 * `PiSession` (`pi --mode rpc`) and any other JSON-line subprocess sit on top
 * of; it owns framing (via the NDJSON codec) and lifecycle, nothing protocol-
 * specific.
 */
export class JsonLineProcess {
  private readonly child: ChildLike;

  constructor(
    spawn: Spawner,
    private readonly handlers: JsonLineHandlers,
  ) {
    this.child = spawn();
    const onError = this.handlers.onError;

    // Route malformed lines to onError (with the offending line) when there's a
    // handler; otherwise pass undefined so the decoder throws loudly.
    const decoder = new LineDecoder(
      onError
        ? (line, err) => onError(new Error(`malformed stdout line: ${line}`, { cause: err }))
        : undefined,
    );

    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk) => {
      for (const value of decoder.push(chunk)) this.handlers.onMessage(value);
    });

    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (text) => this.handlers.onStderr?.(text));

    this.child.on("close", (code) => this.handlers.onExit?.(code));

    // Only intercept 'error' when there's somewhere to route it; otherwise let
    // an unhandled 'error' event surface (Node's default) instead of eating it.
    if (onError) this.child.on("error", (err) => onError(err));
  }

  /** Send a value to the child as one NDJSON line. */
  send(value: unknown): void {
    if (!this.child.stdin) {
      throw new Error("JsonLineProcess: cannot send — child stdin is not available");
    }
    this.child.stdin.write(encodeLine(value));
  }

  /** Terminate the child. */
  kill(signal?: string): void {
    this.child.kill(signal);
  }
}
