import { PiSession } from "./piSession";
import type { AgentEvent } from "./piSession";
import type { Spawner } from "./jsonLineProcess";
import { BeatMapper, type PanelBeat, type SavedActionView } from "./beatMapper";

export interface ConversationControllerOptions {
  /** Spawns the Pi subprocess (injected — testable without a real `pi`). */
  spawn: Spawner;
  /** Receives every panel beat to stream to the client. */
  onBeat: (beat: PanelBeat) => void;
  /** Persist a user-confirmed save proposal (skill→domainSkills, action→actionsStore).
   *  Injected so the controller stays free of store wiring. Rejects on invalid/failed save.
   *  Optional until createDaemon wires it in the next task. */
  saveProposal?: (proposal: unknown) => Promise<void>;
  /** The current saved-actions list, pushed to the panel on auth + after a save.
   *  Optional until createDaemon wires it. */
  listActions?: () => SavedActionView[];
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
  private disposed = false;

  constructor(private readonly opts: ConversationControllerOptions) {
    this.session = new PiSession(opts.spawn, { onEvent: (e) => this.onEvent(e) });
  }

  get isRunning(): boolean {
    return this.session.isRunning;
  }

  /** Begin a task as a fresh turn — aborting any in-flight one first (which
   *  flushes its partial text), rather than steering it. */
  start(task: string): void {
    if (this.session.isRunning) this.session.abort();
    this.mapper.reset();
    this.opts.onBeat({ kind: "user", text: task });
    this.opts.onBeat({ kind: "status", run: "running" });
    this.session.startTurn(task);
  }

  /** Stop the in-flight turn (the panel's stop/pause/take-over map here in v1). */
  stop(): void {
    this.session.abort();
  }

  /** Compact this conversation's Pi history (the agent's `browser_compact` tool). */
  compact(customInstructions?: string): void {
    this.session.compact(customInstructions);
  }

  /** Persist a proposal the user confirmed in the panel, then report the outcome. */
  resolveProposal(proposal: unknown): void {
    const save = this.opts.saveProposal;
    if (!save) return; // not wired (transitional) — nothing to do
    void save(proposal)
      .then(() => {
        const name =
          typeof proposal === "object" &&
          proposal !== null &&
          typeof (proposal as { name?: unknown }).name === "string"
            ? (proposal as { name: string }).name.trim() // match the saved (trimmed) name
            : "draft";
        this.opts.onBeat({ kind: "say", agent: "sage", text: `Saved ${name}.` });
        this.pushActions();
      })
      .catch((err: unknown) => {
        this.opts.onBeat({
          kind: "say",
          agent: "sage",
          text: `⚠️ Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }

  /** Push the current saved-actions list to the panel (a state-updating beat). */
  pushActions(): void {
    const list = this.opts.listActions;
    if (!list) return;
    this.opts.onBeat({ kind: "actions", actions: list() });
  }

  /** Terminate the Pi subprocess; ignore any trailing events it emits. */
  dispose(): void {
    this.disposed = true;
    this.session.dispose();
  }

  private onEvent(event: AgentEvent): void {
    // Killing Pi is async — drop the trailing close/error so we don't emit beats
    // to an already-torn-down client.
    if (this.disposed) return;
    for (const beat of this.mapper.apply(event)) this.opts.onBeat(beat);
  }
}
