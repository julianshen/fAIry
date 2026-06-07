import type { AgentEvent } from "./piSession";
import { coerceProposal } from "./proposal";

/** Whether a propose_save draft would actually persist (so it's worth a card). */
function isSaveable(input: unknown): boolean {
  try {
    coerceProposal(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * The subset of the agent-panel's `Beat` wire shapes the daemon emits. Defined
 * here (not imported from `@fairy/agent-panel`, whose barrel drags React types
 * into the headless daemon) — the two meet as JSON over the WS. A shared
 * `@fairy/protocol` package is the eventual home for these contracts.
 */
export type PanelAgentId = "sage" | "atlas" | "quill" | "forge";
export type PanelRun = "idle" | "running" | "paused" | "done";

/** A saved, re-runnable action projected for the panel (no on-disk metadata). */
export interface SavedActionView {
  name: string;
  content: string;
  attach: "activeTab" | "allTabs" | "none";
  host?: string;
}

export type PanelBeat =
  // Emitted by the conversation controller (not the mapper) when a task starts.
  | { kind: "user"; text: string }
  | { kind: "thinking"; agent: PanelAgentId }
  | { kind: "say"; agent: PanelAgentId; text: string }
  | { kind: "actGroup"; agent: PanelAgentId; title: string }
  | { kind: "act"; agent: PanelAgentId; verb: string; target: string; sub?: string }
  // A2UI message rendered into the panel (from the render_ui tool). The daemon is
  // A2UI-agnostic: `a2ui` is opaque wire data passed straight through to the panel.
  | { kind: "ui"; a2ui: unknown }
  // A save the agent drafted (from the propose_save tool). The daemon is shape-
  // agnostic — the proposal is opaque, like `a2ui`; the panel coerces it.
  | { kind: "proposal"; proposal: unknown }
  // The saved-actions list, pushed to the panel as a state update (not a feed
  // item) — emitted by the session/controller, not derived from a Pi event.
  | { kind: "actions"; actions: SavedActionView[] }
  | { kind: "status"; run: PanelRun };

/** v1: a single agent. Multi-agent attribution is a deferred product decision. */
const AGENT: PanelAgentId = "sage";

/**
 * The tool (registered in the Pi browser-bridge `-e` script) whose call produces
 * generative UI for the panel rather than a page action (see PR-2 plan).
 */
const RENDER_UI_TOOL = "render_ui";

/**
 * The tool whose call carries a draft the agent wants the user to save. Like
 * render_ui this is panel output (a proposal), not a page action.
 */
const PROPOSE_SAVE_TOOL = "browser_propose_save";

/**
 * The `-e` convenience tools whose built A2UI message arrives in the tool RESULT
 * (constructed from simple args), not the call args — see the PR-3 design. The
 * mapper records their call id at tool_use and parses the result into a ui beat.
 */
const RENDER_RESULT_TOOLS = new Set(["render_table", "render_chart", "render_list"]);

/** Parse a convenience tool's result into the opaque A2UI value, or undefined if unusable. */
function parseA2ui(output: unknown): unknown {
  let value: unknown = output;
  if (typeof output === "string") {
    try {
      value = JSON.parse(output);
    } catch {
      return undefined;
    }
  }
  // null is not a renderable message — treat it as unusable (no beat), like a
  // parse failure, rather than emitting a ui beat with no content.
  return value ?? undefined;
}

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
  /** Ids of in-flight convenience-tool calls whose result becomes a ui beat. */
  private pendingUi = new Set<string>();

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
        if (event.name === RENDER_UI_TOOL) {
          // Generative UI, not a page action: emit a ui beat carrying the A2UI
          // message (from the call args — see the PR-2 plan's verification note)
          // instead of opening an action group. The panel finalizes the running
          // group on a ui beat (like a say), so clear groupOpen to stay in sync —
          // otherwise a later tool's act lands in a group the panel has closed.
          this.groupOpen = false;
          beats.push({ kind: "ui", a2ui: event.input.message });
          return beats;
        }
        if (event.name === PROPOSE_SAVE_TOOL) {
          // A proposal, not a page action: surface the draft (the tool input) as
          // a proposal beat. Mirror render_ui — finalize the running action group
          // so a later tool's act doesn't land in a group the panel has closed.
          this.groupOpen = false;
          // Only surface a Save card for a draft that would actually save:
          // coerceProposal is the single validity authority (skill needs a valid
          // host, etc.), so the user never sees an unsaveable card.
          if (isSaveable(event.input)) {
            beats.push({ kind: "proposal", proposal: event.input });
          }
          return beats;
        }
        if (RENDER_RESULT_TOOLS.has(event.name)) {
          // Convenience tool: the built A2UI arrives in the result, not the args.
          // Record the id so tool_result can emit the ui beat. Like render_ui it's
          // panel output, not a page action — clear groupOpen (the forthcoming ui
          // beat finalizes the running group in the panel).
          this.groupOpen = false;
          this.pendingUi.add(event.id);
          return beats;
        }
        if (!this.groupOpen) {
          beats.push({ kind: "actGroup", agent: AGENT, title: "Working on the page" });
          this.groupOpen = true;
        }
        beats.push({ kind: "act", agent: AGENT, verb: verbFor(event.name), target: targetFor(event.input) });
        return beats;
      }
      case "tool_result": {
        if (!this.pendingUi.has(event.id)) return [];
        this.pendingUi.delete(event.id);
        // An errored convenience call returns an error message, not A2UI — don't
        // surface it as a (faux) ui beat.
        if (event.isError) return [];
        const a2ui = parseA2ui(event.output);
        return a2ui === undefined ? [] : [{ kind: "ui", a2ui }];
      }
      case "turn_end": {
        const beats = this.flush();
        this.groupOpen = false;
        // The turn is over: abandon any convenience call still awaiting a result
        // so a late/cancelled result can't render stale UI after the run ends.
        this.pendingUi.clear();
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
    this.pendingUi.clear();
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
