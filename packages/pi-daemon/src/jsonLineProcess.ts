import { encodeLine, LineDecoder } from "./ndjson";

/** Minimal readable-stream surface this module needs (stdout/stderr). */
export interface ReadableLine {
  setEncoding(encoding: string): void;
  on(event: "data", listener: (chunk: string) => void): unknown;
}

/** Minimal child-process surface — structurally satisfied by both
 *  `child_process.ChildProcess` and Bun's spawned process. */
export interface ChildLike {
  stdin: { write(chunk: string): void } | null;
  stdout: ReadableLine | null;
  stderr: ReadableLine | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
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
  /** The child exited (its stdout/stderr are done). */
  onExit?: (code: number | null) => void;
  /**
   * An asynchronous failure: the child's `error` event (e.g. the process
   * failed to start) or a malformed stdout line (carrying the offending line,
   * with the parse error as `cause`). A *synchronous* throw from the injected
   * spawner surfaces from the constructor, not here.
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
    const decoder = new LineDecoder((line, err) =>
      this.handlers.onError?.(
        new Error(`malformed stdout line: ${line}`, { cause: err }),
      ),
    );

    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk) => {
      for (const value of decoder.push(chunk)) this.handlers.onMessage(value);
    });

    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (text) => this.handlers.onStderr?.(text));

    this.child.on("exit", (code) => this.handlers.onExit?.(code));
    this.child.on("error", (err) => this.handlers.onError?.(err));
  }

  /** Send a value to the child as one NDJSON line. */
  send(value: unknown): void {
    this.child.stdin?.write(encodeLine(value));
  }

  /** Terminate the child. */
  kill(signal?: string): void {
    this.child.kill(signal);
  }
}
