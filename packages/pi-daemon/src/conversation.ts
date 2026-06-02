import { PiSession } from "./piSession";
import type { AgentEvent } from "./piSession";
import type { Spawner } from "./jsonLineProcess";
import { BeatMapper, type PanelBeat } from "./beatMapper";

export interface ConversationControllerOptions {
  /** Spawns the Pi subprocess (injected — testable without a real `pi`). */
  spawn: Spawner;
  /** Receives every panel beat to stream to the client. */
  onBeat: (beat: PanelBeat) => void;
}

/**
 * Drives a single conversation: owns a {@link PiSession}, pipes its
 * `AgentEvent`s through a {@link BeatMapper}, and emits panel beats. The thin
 * surface a client (WS endpoint) calls.
 *
 * v1 control surface is `start` + `stop`; the panel's pause / take-over /
 * confirm-answer map to `stop` for now (Pi has no mid-turn pause, and
 * confirm-gating isn't built yet).
 */
export class ConversationController {
  private readonly session: PiSession;
  private readonly mapper = new BeatMapper();

  constructor(private readonly opts: ConversationControllerOptions) {
    this.session = new PiSession(opts.spawn, { onEvent: (e) => this.onEvent(e) });
  }

  get isRunning(): boolean {
    return this.session.isRunning;
  }

  /** Begin a task: echo the user message, mark running, and prompt Pi. */
  start(task: string): void {
    this.mapper.reset();
    this.opts.onBeat({ kind: "user", text: task });
    this.opts.onBeat({ kind: "status", run: "running" });
    this.session.startTurn(task);
  }

  /** Stop the in-flight turn (the panel's stop/pause/take-over map here in v1). */
  stop(): void {
    this.session.abort();
  }

  /** Terminate the Pi subprocess. */
  dispose(): void {
    this.session.dispose();
  }

  private onEvent(event: AgentEvent): void {
    for (const beat of this.mapper.apply(event)) this.opts.onBeat(beat);
  }
}
