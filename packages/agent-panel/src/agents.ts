import type { Agent, AgentId } from "./types";

/**
 * The Fairy team. Colors reference CSS vars defined in tokens.css so themes
 * stay consistent (pips set them as a `background` style). Identities are
 * stable across light/dark.
 */
export const AGENTS: Record<AgentId, Agent> = {
  sage: {
    id: "sage",
    name: "Shaka",
    role: "Orchestrator",
    glyph: "S",
    icon: "brain",
    color: "var(--sage)",
    desc: "Reads your goal, writes the plan, and routes each step to the right specialist.",
  },
  atlas: {
    id: "atlas",
    name: "Atlas",
    role: "Navigator",
    glyph: "A",
    icon: "nav",
    color: "var(--atlas)",
    desc: "Drives the browser — opens pages, clicks, scrolls, and applies filters.",
  },
  quill: {
    id: "quill",
    name: "Pythagoras",
    role: "Reader",
    glyph: "P",
    icon: "eye",
    color: "var(--quill)",
    desc: "Scans the DOM, extracts structured data, summarizes and ranks results.",
  },
  forge: {
    id: "forge",
    name: "Edison",
    role: "Operator",
    glyph: "E",
    icon: "edit",
    color: "var(--forge)",
    desc: "Fills forms, selects options, and completes flows — pausing for anything sensitive.",
  },
};

export const AGENT_ORDER: AgentId[] = ["sage", "atlas", "quill", "forge"];
