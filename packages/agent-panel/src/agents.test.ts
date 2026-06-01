import { AGENTS, AGENT_ORDER } from "./agents";

describe("agent registry", () => {
  it("orders every registered agent exactly once", () => {
    const keys = Object.keys(AGENTS).sort();
    const ordered = [...AGENT_ORDER].sort();
    expect(ordered).toEqual(keys);
    expect(AGENT_ORDER).toHaveLength(new Set(AGENT_ORDER).size);
  });

  it("keys each agent by its own id", () => {
    for (const [id, agent] of Object.entries(AGENTS)) {
      expect(agent.id).toBe(id);
    }
  });

  it("gives every agent a single-letter glyph and a name", () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.glyph).toHaveLength(1);
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.role.length).toBeGreaterThan(0);
    }
  });
});
