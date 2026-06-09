/** Commands the native shell understands (posted to the "fairy" message handler). */
export interface NativeBridge {
  /** Start a conversation task. */
  start(task: string): void;
  /** Stop the in-flight turn. */
  stop(): void;
  /** Resolve a save proposal (the opaque proposal object is forwarded verbatim). */
  resolveProposal(proposal: unknown): void;
}

/**
 * Adapts the panel's actions to the native shell's WS bridge: each call `post`s a
 * typed command that the Swift `PanelBridge` maps onto `ConversationClient`. Pure —
 * `post` is injected (the host wires it to `window.webkit.messageHandlers.fairy`).
 */
export function createNativeBridge(post: (msg: unknown) => void): NativeBridge {
  return {
    start: (task) => post({ type: "start", task }),
    stop: () => post({ type: "stop" }),
    resolveProposal: (proposal) => post({ type: "resolveProposal", proposal }),
  };
}
