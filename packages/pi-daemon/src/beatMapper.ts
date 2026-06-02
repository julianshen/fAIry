import type { AgentEvent } from "./piSession";

/**
 * The subset of the agent-panel's `Beat` wire shapes the daemon emits. Defined
 * here (not imported from `@fairy/agent-panel`, whose barrel drags React types
 * into the headless daemon) — the two meet as JSON over the WS. A shared
 * `@fairy/protocol` package is the eventual home for these contracts.
 */
export type PanelAgentId = "sage" | "atlas" | "quill" | "forge";
export type PanelRun = "idle" | "running" | "paused" | "done";

export type PanelBeat =
  | { kind: "thinking"; agent: PanelAgentId }
  | { kind: "say"; agent: PanelAgentId; text: string }
  | { kind: "actGroup"; agent: PanelAgentId; title: string }
  | { kind: "act"; agent: PanelAgentId; verb: string; target: string; sub?: string }
  | { kind: "status"; run: PanelRun };

/** v1: a single agent. Multi-agent attribution is a deferred product decision. */
const AGENT: PanelAgentId = "sage";

/** Human-facing verb for a tool name; falls back to the name itself. */
const TOOL_VERBS: Record<string, string> = {
  navigate: "Navigated to",
  click: "Clicked",
  type: "Typed",
  scroll: "Scrolled",
  screenshot: "Took a screenshot",
  screenshotMarked: "Took a screenshot",
  getDom: "Read the DOM",
  axtree: "Read the page",
  getUrl: "Checked the URL",
  getTitle: "Checked the title",
  waitFor: "Waited for",
  dismissOverlays: "Dismissed overlays",
};

function verbFor(tool: string): string {
  return TOOL_VERBS[tool] ?? tool;
}

/** Best-effort primary argument to display as the action target. */
function targetFor(input: Record<string, unknown>): string {
  const primary = input.url ?? input.selector ?? input.target ?? input.text ?? input.query;
  return primary == null ? "" : String(primary);
}

/**
 * Translates a `PiSession` `AgentEvent` stream into agent-panel beats. Stateful:
 * buffers streamed text into a single `say` (the panel renders whole messages,
 * not partial tokens) and opens one action group per turn. Pure — no I/O — so
 * the conversation controller can pipe its output to the WS, and tests can
 * assert beats directly.
 */
export class BeatMapper {
  private text = "";
  private groupOpen = false;

  apply(event: AgentEvent): PanelBeat[] {
    switch (event.type) {
      case "text_delta": {
        if (this.text !== "") {
          this.text += event.text;
          return [];
        }
        // First delta of a message: the panel finalizes any running action group
        // on this `thinking` beat, so our group flag must follow.
        this.text = event.text;
        this.groupOpen = false;
        return [{ kind: "thinking", agent: AGENT }];
      }
      case "tool_use": {
        const beats = this.flush();
        if (!this.groupOpen) {
          beats.push({ kind: "actGroup", agent: AGENT, title: "Working on the page" });
          this.groupOpen = true;
        }
        beats.push({ kind: "act", agent: AGENT, verb: verbFor(event.name), target: targetFor(event.input) });
        return beats;
      }
      case "tool_result":
        return [];
      case "turn_end": {
        const beats = this.flush();
        this.groupOpen = false;
        beats.push({ kind: "status", run: event.reason === "cancelled" ? "paused" : "done" });
        return beats;
      }
      case "error": {
        const beats = this.flush();
        beats.push({ kind: "say", agent: AGENT, text: `⚠️ ${event.message}` });
        return beats;
      }
    }
  }

  /** Drop buffered/turn state for a new task. */
  reset(): void {
    this.text = "";
    this.groupOpen = false;
  }

  private flush(): PanelBeat[] {
    if (this.text === "") return [];
    const beat: PanelBeat = { kind: "say", agent: AGENT, text: this.text };
    this.text = "";
    // The panel finalizes the running action group on this `say`, so a later
    // tool call in the same turn must open a fresh group.
    this.groupOpen = false;
    return [beat];
  }
}
