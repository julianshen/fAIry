import type { IconName } from "./components/Icon";
import type { A2UIMessage } from "./a2ui/types";

/** The four specialist agents on the Fairy team. */
export type AgentId = "sage" | "atlas" | "quill" | "forge";

/** Overall run lifecycle shown in the header status line. */
export type RunState = "idle" | "running" | "paused" | "done";

// ── Presentation variants (CSS-driven; ported from the design's tweaks) ──
export type VisualStyle = "glass" | "solid" | "contrast";
export type HeaderStyle = "rail" | "minimal" | "tabs";
export type ChatLayout = "flat" | "bubbles" | "doc";
export type ActionStyle = "timeline" | "cards" | "terminal";
export type EmptyVariant = "suggestions" | "hero" | "grid";
export type HeaderView = "chat" | "activity" | "plan";

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  /** Single-letter monogram shown in pips/avatars. */
  glyph: string;
  icon: IconName;
  /** CSS color (a `var(--…)` reference) for surfaces. */
  color: string;
  desc: string;
}

export interface Suggestion {
  id: string;
  icon: IconName;
  title: string;
  sub: string;
  /** The prompt sent when the suggestion is picked. */
  task: string;
}

export interface SuggestionGroup {
  cap: string;
  items: Suggestion[];
}

export type StepState = "pending" | "active" | "done";

export interface PlanStep {
  txt: string;
  who: AgentId;
  state: StepState;
}

export interface ActRow {
  verb: string;
  target: string;
  sub?: string;
  state: StepState;
}

/** A structured result card emitted by the reader agent (domain payload). */
export interface ResultCard {
  /** Short label, e.g. the agent that produced the pick. */
  by: string;
  /** Letters shown in the badge (e.g. airline code). */
  badge: string;
  badgeColor: string;
  title: string;
  sub: string;
  price: string;
  tag: string;
}

/** A user-reviewed proposal to save a skill or action. */
export interface SaveProposal {
  kind: "skill" | "action";
  name: string;
  content: string;
  host?: string;
  attach?: "activeTab" | "allTabs" | "none";
}

/** A saved action surfaced in the panel (non-feed state). */
export interface SavedActionView {
  name: string;
  content: string;
  attach: "activeTab" | "allTabs" | "none";
  host?: string;
}

// ── Feed items (rendered list) ───────────────────────────────────────
interface ItemBase {
  key: number;
}
export type FeedItem =
  | (ItemBase & { type: "user"; text: string })
  | (ItemBase & { type: "say"; agent: AgentId; text: string; time?: string })
  | (ItemBase & { type: "thinking"; agent: AgentId })
  | (ItemBase & { type: "handoff"; from: AgentId; to: AgentId })
  | (ItemBase & { type: "plan"; steps: PlanStep[] })
  | (ItemBase & {
      type: "actions";
      agent: AgentId;
      title: string;
      open: boolean;
      running: boolean;
      rows: ActRow[];
    })
  | (ItemBase & { type: "result"; result: ResultCard })
  | (ItemBase & { type: "ui"; a2ui: A2UIMessage })
  | (ItemBase & {
      type: "confirm";
      agent: AgentId;
      confirm: string;
      decline: string;
      answered: boolean;
      choice?: string;
    })
  | (ItemBase & { type: "takeover"; agent: AgentId; text: string; taken: boolean })
  | (ItemBase & { type: "proposal"; proposal: SaveProposal; resolved?: "saved" | "dismissed" });

export type FeedItemType = FeedItem["type"];

// ── Beats (agent-driven transitions) + UI actions ────────────────────
export type Beat =
  | { kind: "user"; text: string }
  | { kind: "thinking"; agent: AgentId }
  | { kind: "say"; agent: AgentId; text: string; time?: string }
  | { kind: "plan"; steps: Array<{ txt: string; who: AgentId }> }
  | { kind: "planStep"; i: number; state: StepState }
  | { kind: "handoff"; from: AgentId; to: AgentId }
  | { kind: "status"; run: RunState }
  | { kind: "actGroup"; agent: AgentId; title: string }
  | { kind: "act"; agent: AgentId; verb: string; target: string; sub?: string }
  | { kind: "result"; result: ResultCard }
  | { kind: "ui"; a2ui: A2UIMessage }
  | { kind: "confirm"; agent: AgentId; confirm: string; decline: string }
  | { kind: "takeover"; agent: AgentId; text: string }
  | { kind: "proposal"; proposal: SaveProposal }
  | { kind: "actions"; actions: SavedActionView[] };

/** User-initiated transitions dispatched to the same reducer. */
export type UiAction =
  | { kind: "startTask"; text: string }
  | { kind: "reset" }
  | { kind: "answerConfirm"; key: number; choice: string }
  | { kind: "toggleActions"; key: number }
  | { kind: "takeItem"; key: number }
  | { kind: "resolveProposal"; key: number; accept: boolean };

export type PanelAction = Beat | UiAction;

export interface PanelState {
  items: FeedItem[];
  run: RunState;
  active: AgentId | null;
  /** Monotonic counter backing stable item keys. */
  seq: number;
  /** Saved actions surfaced in the empty state (non-feed state). */
  savedActions: SavedActionView[];
}

export interface FeedCounts {
  chat: number;
  activity: number;
  plan: number;
}

export type ThemeMode = "dark" | "light";
export type Density = "compact" | "regular" | "comfy";

/** Presentation knobs applied to the panel root (ported from the design). */
export interface PanelConfig {
  theme: ThemeMode;
  accent: string;
  font: string;
  panelW: number;
  density: Density;
  visualStyle: VisualStyle;
  headerStyle: HeaderStyle;
  chatLayout: ChatLayout;
  actionStyle: ActionStyle;
  emptyState: EmptyVariant;
}
