import type { Agent, AgentId } from "./types";

/**
 * The Fairy team. Colors reference CSS vars defined in tokens.css so themes
 * stay consistent; `hex` mirrors each for inline contexts (pips drawn with a
 * background style). Identities are stable across light/dark.
 */
export const AGENTS: Record<AgentId, Agent> = {
  sage: {
    id: "sage",
    name: "Shaka",
    role: "Orchestrator",
    glyph: "S",
    icon: "brain",
    color: "var(--sage)",
    hex: "#a78bfa",
    desc: "Reads your goal, writes the plan, and routes each step to the right specialist.",
  },
  atlas: {
    id: "atlas",
    name: "Atlas",
    role: "Navigator",
    glyph: "A",
    icon: "nav",
    color: "var(--atlas)",
    hex: "#5b9dff",
    desc: "Drives the browser — opens pages, clicks, scrolls, and applies filters.",
  },
  quill: {
    id: "quill",
    name: "Pythagoras",
    role: "Reader",
    glyph: "P",
    icon: "eye",
    color: "var(--quill)",
    hex: "#34d3b5",
    desc: "Scans the DOM, extracts structured data, summarizes and ranks results.",
  },
  forge: {
    id: "forge",
    name: "Edison",
    role: "Operator",
    glyph: "E",
    icon: "edit",
    color: "var(--forge)",
    hex: "#f7b955",
    desc: "Fills forms, selects options, and completes flows — pausing for anything sensitive.",
  },
};

export const AGENT_ORDER: AgentId[] = ["sage", "atlas", "quill", "forge"];
