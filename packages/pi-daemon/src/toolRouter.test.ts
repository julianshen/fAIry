import { describe, expect, it, vi } from "vitest";
import { createToolRouter } from "./toolRouter";
import { fakeSkills as baseSkills } from "./testFakes";

const fakeSkills = () =>
  baseSkills({
    preamble: () => Promise.resolve("PREAMBLE"),
    listInteractions: () => Promise.resolve(["iframes.md", "dialogs.md"]),
    readInteraction: (name) => Promise.resolve(name === "iframes.md" ? "IFRAME BODY" : null),
  });

describe("createToolRouter", () => {
  it("owns exactly the daemon-handled tool names (and not extension tools)", () => {
    const router = createToolRouter({ compact: () => {}, skills: fakeSkills() });
    for (const t of ["compact", "skillPreamble", "skillListInteractions", "skillReadInteraction"]) {
      expect(router.owns(t), t).toBe(true);
    }
    for (const t of ["navigate", "click", "tabOpen", "cdp", "evaluate"]) {
      expect(router.owns(t), t).toBe(false);
    }
  });

  describe("compact", () => {
    it("delegates to the injected compact and reports ok", async () => {
      const compact = vi.fn();
      const router = createToolRouter({ compact, skills: fakeSkills() });
      expect(await router.handle("compact", { customInstructions: "keep the plan" })).toEqual({ ok: true });
      expect(compact).toHaveBeenCalledWith("keep the plan");
    });

    it("passes undefined when no customInstructions are given", async () => {
      const compact = vi.fn();
      const router = createToolRouter({ compact, skills: fakeSkills() });
      await router.handle("compact", {});
      expect(compact).toHaveBeenCalledWith(undefined);
    });
  });

  describe("skills", () => {
    it("skillPreamble returns the preamble", async () => {
      const router = createToolRouter({ compact: () => {}, skills: fakeSkills() });
      expect(await router.handle("skillPreamble", {})).toBe("PREAMBLE");
    });

    it("skillListInteractions returns the list", async () => {
      const router = createToolRouter({ compact: () => {}, skills: fakeSkills() });
      expect(await router.handle("skillListInteractions", {})).toEqual(["iframes.md", "dialogs.md"]);
    });

    it("skillReadInteraction returns the body", async () => {
      const router = createToolRouter({ compact: () => {}, skills: fakeSkills() });
      expect(await router.handle("skillReadInteraction", { name: "iframes.md" })).toBe("IFRAME BODY");
    });

    it("skillReadInteraction throws when the skill is unknown", async () => {
      const router = createToolRouter({ compact: () => {}, skills: fakeSkills() });
      await expect(router.handle("skillReadInteraction", { name: "nope.md" })).rejects.toThrow(/not found/i);
    });

    it("skillReadInteraction rejects a non-string name", async () => {
      const router = createToolRouter({ compact: () => {}, skills: fakeSkills() });
      await expect(router.handle("skillReadInteraction", {})).rejects.toThrow(/name/i);
    });
  });

  it("rejects a tool it does not own (guards against mis-routing)", async () => {
    const router = createToolRouter({ compact: () => {}, skills: fakeSkills() });
    await expect(router.handle("navigate", {})).rejects.toThrow(/not a daemon tool/i);
  });
});
