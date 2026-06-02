import { JsonLineProcess, type Spawner } from "./jsonLineProcess";

/** A renderer-facing event, translated from Pi's RPC wire protocol. */
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; output: unknown; isError: boolean }
  | { type: "turn_end"; reason: "stop" | "error" | "cancelled" }
  | { type: "error"; message: string };

export interface PiSessionHandlers {
  onEvent: (event: AgentEvent) => void;
}

type Msg = Record<string, unknown>;

interface ResultBlock {
  type?: string;
  text?: string;
  data?: string;
}

/**
 * A turn-based session with the Pi coding agent (`pi --mode rpc`). Sits on
 * `JsonLineProcess` for framing/lifecycle and owns Pi's RPC semantics: it sends
 * prompt/abort/compact and translates Pi's wire messages into a typed
 * `AgentEvent` stream. The spawner is injected, so the session is testable
 * without a real `pi` binary.
 */
export class PiSession {
  private readonly proc: JsonLineProcess;
  private running = false;
  /** Last prompt this turn — re-queued with `steer` if Pi rejects a plain one. */
  private lastPrompt: string | null = null;
  /** Guards the steer-retry so a persistent rejection can't loop. */
  private steerRetried = false;

  constructor(
    spawn: Spawner,
    private readonly handlers: PiSessionHandlers,
  ) {
    this.proc = new JsonLineProcess(spawn, {
      onMessage: (msg) => this.dispatch(msg as Msg),
      onStderr: (text) => this.emit({ type: "error", message: `[pi stderr] ${text.trim()}` }),
      onExit: (code) => this.onExit(code),
      onError: (err) => this.emit({ type: "error", message: err.message }),
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Start (or steer) a turn with a user prompt. */
  startTurn(prompt: string): void {
    this.lastPrompt = prompt;
    this.steerRetried = false;
    if (this.running) {
      // Pi rejects overlapping plain prompts; queue with 'steer' instead.
      this.proc.send({ type: "prompt", message: prompt, streamingBehavior: "steer" });
      return;
    }
    // Send first: if it throws (e.g. stdin gone), `running` stays false.
    this.proc.send({ type: "prompt", message: prompt });
    this.running = true;
  }

  /** Cancel the in-flight turn. */
  abort(): void {
    if (!this.running) return;
    this.proc.send({ type: "abort" });
    this.emit({ type: "turn_end", reason: "cancelled" });
    this.running = false;
  }

  /** Ask Pi to compact the conversation history. */
  compact(customInstructions?: string): void {
    this.proc.send(
      customInstructions ? { type: "compact", customInstructions } : { type: "compact" },
    );
  }

  /** Toggle Pi's automatic compaction-on-near-full-context behavior. */
  setAutoCompaction(enabled: boolean): void {
    this.proc.send({ type: "set_auto_compaction", enabled });
  }

  /** Terminate the Pi subprocess. */
  dispose(): void {
    this.proc.kill();
  }

  // ── internals ────────────────────────────────────────────────────────

  private emit(event: AgentEvent): void {
    this.handlers.onEvent(event);
  }

  private endTurn(reason: "stop" | "error"): void {
    this.emit({ type: "turn_end", reason });
    this.running = false;
  }

  private onExit(code: number | null): void {
    if (!this.running) return;
    this.emit({ type: "error", message: `Pi exited (code ${code ?? "unknown"})` });
    this.emit({ type: "turn_end", reason: "cancelled" });
    this.running = false;
  }

  private dispatch(msg: Msg): void {
    // Pi could emit a valid JSON line that isn't an object (null, a number);
    // guard before reading `.type`.
    if (!msg || typeof msg !== "object") return;
    switch (msg.type as string) {
      case "message_update":
        return this.onMessageUpdate(msg);
      case "tool_execution_start":
        return this.emit({
          type: "tool_use",
          id: String(msg.toolCallId ?? ""),
          name: String(msg.toolName ?? ""),
          input: (msg.args ?? {}) as Record<string, unknown>,
        });
      case "tool_execution_end":
        return this.onToolEnd(msg);
      case "agent_end":
        return this.endTurn("stop");
      case "auto_retry_end":
        return this.onAutoRetryEnd(msg);
      case "extension_ui_request":
        return this.onUiRequest(msg);
      case "response":
        return this.onResponse(msg);
      // agent_start, intermediate turn_end, queue_update, compaction_* — informational.
      default:
        return;
    }
  }

  private onMessageUpdate(msg: Msg): void {
    const ev = msg.assistantMessageEvent as
      | { type?: string; delta?: string; reason?: string; errorMessage?: string }
      | undefined;
    if (ev?.type === "text_delta" && typeof ev.delta === "string") {
      this.emit({ type: "text_delta", text: ev.delta });
      return;
    }
    if (ev?.type === "error") {
      const reason = ev.reason ?? "error";
      const detail = ev.errorMessage ?? "(no detail)";
      this.emit({ type: "error", message: `Agent error (${reason}): ${detail}` });
      this.endTurn("error");
    }
  }

  private onToolEnd(msg: Msg): void {
    const result = msg.result as { content?: ResultBlock[]; details?: unknown } | undefined;
    // `content` is normally an array of blocks; tolerate a malformed payload.
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const image = blocks.find((b) => b?.type === "image" && typeof b.data === "string");
    let output: unknown;
    if (image) {
      const details = (result?.details ?? {}) as { width?: number; height?: number };
      output = { format: "png", base64: image.data, width: details.width ?? 0, height: details.height ?? 0 };
    } else {
      const text = blocks.map((b) => b?.text ?? "").join("");
      output = text || result;
    }
    this.emit({
      type: "tool_result",
      id: String(msg.toolCallId ?? ""),
      output,
      isError: Boolean(msg.isError),
    });
  }

  private onAutoRetryEnd(msg: Msg): void {
    // Pi marks an exhausted retry with `aborted` (observed) and/or
    // `success: false` (per docs); accept either alongside a finalError.
    const failed = msg.aborted === true || msg.success === false;
    if (failed && typeof msg.finalError === "string") {
      this.emit({ type: "error", message: `Agent retry failed: ${msg.finalError}` });
      this.endTurn("error");
    }
  }

  private onUiRequest(msg: Msg): void {
    const method = String(msg.method ?? "");
    // Dialogs would block Pi; auto-cancel them so the agent keeps moving.
    if (["select", "confirm", "input", "editor"].includes(method)) {
      this.proc.send({ type: "extension_ui_response", id: String(msg.id ?? ""), cancelled: true });
    }
  }

  private onResponse(msg: Msg): void {
    if (msg.success !== false) return;
    const errStr = String(msg.error ?? "unknown");
    // Desync recovery: Pi was still processing when we sent a plain prompt.
    // Re-queue the same prompt once with a streamingBehavior.
    if (/already processing|streamingBehavior/i.test(errStr) && this.lastPrompt !== null && !this.steerRetried) {
      this.steerRetried = true;
      this.running = true;
      this.proc.send({ type: "prompt", message: this.lastPrompt, streamingBehavior: "steer" });
      return;
    }
    this.emit({ type: "error", message: `Pi command failed: ${errStr}` });
    if (this.running && ["prompt", "steer", "follow_up"].includes(String(msg.command))) {
      this.endTurn("error");
    }
  }
}
