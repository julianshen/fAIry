import { describe, expect, it, vi } from "vitest";
import { createToolRouter, type ToolRouterDeps } from "./toolRouter";
import { fakeDomainSkills, fakeSkills as baseSkills } from "./testFakes";
import type { HelperRegistry, JsHelper } from "./helperRegistry";

const fakeSkills = () =>
  baseSkills({
    preamble: () => Promise.resolve("PREAMBLE"),
    listInteractions: () => Promise.resolve(["iframes.md", "dialogs.md"]),
    readInteraction: (name) => Promise.resolve(name === "iframes.md" ? "IFRAME BODY" : null),
  });

/** An in-memory HelperRegistry double. */
function fakeHelpers(initial: JsHelper[] = []): HelperRegistry {
  let helpers = [...initial];
  return {
    list: () => helpers.slice(),
    get: (name) => helpers.find((h) => h.name === name),
    save: (input) => {
      helpers = helpers.filter((h) => h.name !== input.name).concat({ ...input, createdAt: 0 });
    },
    remove: (name) => {
      const before = helpers.length;
      helpers = helpers.filter((h) => h.name !== name);
      return helpers.length < before;
    },
    callExpression: (name, args) => `CALL(${name}, ${JSON.stringify(args)})`,
  };
}

function deps(over: Partial<ToolRouterDeps> = {}): ToolRouterDeps {
  return {
    compact: () => {},
    skills: fakeSkills(),
    helpers: fakeHelpers(),
    domainSkills: fakeDomainSkills(),
    relay: () => Promise.resolve({ ok: true, value: undefined }),
    ...over,
  };
}

describe("createToolRouter", () => {
  it("owns exactly the daemon-handled tool names (and not extension tools)", () => {
    const router = createToolRouter(deps());
    for (const t of [
      "compact",
      "skillPreamble",
      "skillListInteractions",
      "skillReadInteraction",
      "saveHelper",
      "listHelpers",
      "removeHelper",
      "callHelper",
      "domainSkillList",
      "domainSkillRead",
      "domainSkillSave",
      "domainSkillSearch",
      "domainSkillRemove",
    ]) {
      expect(router.owns(t), t).toBe(true);
    }
    for (const t of ["navigate", "click", "tabOpen", "cdp", "evaluate"]) {
      expect(router.owns(t), t).toBe(false);
    }
  });

  describe("compact", () => {
    it("delegates to the injected compact and reports ok", async () => {
      const compact = vi.fn();
      const router = createToolRouter(deps({ compact }));
      expect(await router.handle("compact", { customInstructions: "keep the plan" })).toEqual({ ok: true });
      expect(compact).toHaveBeenCalledWith("keep the plan");
    });

    it("passes undefined when no customInstructions are given", async () => {
      const compact = vi.fn();
      const router = createToolRouter(deps({ compact }));
      await router.handle("compact", {});
      expect(compact).toHaveBeenCalledWith(undefined);
    });
  });

  describe("skills", () => {
    it("skillPreamble returns the preamble", async () => {
      const router = createToolRouter(deps());
      expect(await router.handle("skillPreamble", {})).toBe("PREAMBLE");
    });

    it("skillListInteractions returns the list", async () => {
      const router = createToolRouter(deps());
      expect(await router.handle("skillListInteractions", {})).toEqual(["iframes.md", "dialogs.md"]);
    });

    it("skillReadInteraction returns the body", async () => {
      const router = createToolRouter(deps());
      expect(await router.handle("skillReadInteraction", { name: "iframes.md" })).toBe("IFRAME BODY");
    });

    it("skillReadInteraction throws when the skill is unknown", async () => {
      const router = createToolRouter(deps());
      await expect(router.handle("skillReadInteraction", { name: "nope.md" })).rejects.toThrow(/not found/i);
    });

    it("skillReadInteraction rejects a non-string name", async () => {
      const router = createToolRouter(deps());
      await expect(router.handle("skillReadInteraction", {})).rejects.toThrow(/name/i);
    });
  });

  describe("helpers", () => {
    it("saveHelper persists to the registry", async () => {
      const helpers = fakeHelpers();
      const router = createToolRouter(deps({ helpers }));
      expect(await router.handle("saveHelper", { name: "double", expression: "(x)=>x*2", description: "x2" })).toEqual(
        { ok: true },
      );
      expect(helpers.get("double")).toMatchObject({ expression: "(x)=>x*2", description: "x2" });
    });

    it("saveHelper rejects a missing, empty, or whitespace name/expression", async () => {
      const router = createToolRouter(deps());
      await expect(router.handle("saveHelper", { expression: "x" })).rejects.toThrow(/name/i);
      await expect(router.handle("saveHelper", { name: "f" })).rejects.toThrow(/expression/i);
      await expect(router.handle("saveHelper", { name: "  ", expression: "x" })).rejects.toThrow(
        /name.*non-empty/i,
      );
      await expect(router.handle("saveHelper", { name: "f", expression: "" })).rejects.toThrow(
        /expression.*non-empty/i,
      );
    });

    it("listHelpers returns names + descriptions only", async () => {
      const helpers = fakeHelpers([{ name: "f", expression: "()=>1", description: "d", createdAt: 0 }]);
      const router = createToolRouter(deps({ helpers }));
      expect(await router.handle("listHelpers", {})).toEqual([{ name: "f", description: "d" }]);
    });

    it("removeHelper reports whether it existed", async () => {
      const helpers = fakeHelpers([{ name: "f", expression: "()=>1", createdAt: 0 }]);
      const router = createToolRouter(deps({ helpers }));
      expect(await router.handle("removeHelper", { name: "f" })).toEqual({ removed: true });
      expect(await router.handle("removeHelper", { name: "f" })).toEqual({ removed: false });
    });

    it("callHelper resolves the source on the daemon and relays an evaluate to the browser", async () => {
      const helpers = fakeHelpers([{ name: "double", expression: "(x)=>x*2", createdAt: 0 }]);
      const relay = vi.fn(() => Promise.resolve({ ok: true, value: 42 }));
      const router = createToolRouter(deps({ helpers, relay }));
      const result = await router.handle("callHelper", { name: "double", args: [21] });
      expect(relay).toHaveBeenCalledWith("evaluate", { expression: "CALL(double, [21])" });
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it("saveHelper stores without a description, and callHelper defaults missing args to []", async () => {
      const helpers = fakeHelpers();
      const relay = vi.fn(() => Promise.resolve({ ok: true }));
      const router = createToolRouter(deps({ helpers, relay }));
      await router.handle("saveHelper", { name: "f", expression: "()=>1" });
      expect(helpers.get("f")?.description).toBeUndefined();
      await router.handle("callHelper", { name: "f" }); // no args field
      expect(relay).toHaveBeenCalledWith("evaluate", { expression: "CALL(f, [])" });
    });

    it("callHelper throws for an unknown helper without relaying", async () => {
      const relay = vi.fn(() => Promise.resolve({}));
      const router = createToolRouter(deps({ relay }));
      await expect(router.handle("callHelper", { name: "nope" })).rejects.toThrow(/helper not found/i);
      expect(relay).not.toHaveBeenCalled();
    });

    it("callHelper rejects a present-but-non-array args", async () => {
      const helpers = fakeHelpers([{ name: "f", expression: "()=>1", createdAt: 0 }]);
      const relay = vi.fn(() => Promise.resolve({}));
      const router = createToolRouter(deps({ helpers, relay }));
      await expect(router.handle("callHelper", { name: "f", args: "nope" })).rejects.toThrow(/args.*array/i);
      expect(relay).not.toHaveBeenCalled();
    });
  });

  describe("domain skills", () => {
    it("domainSkillSave/list/read/remove route to the store", async () => {
      const calls: string[] = [];
      const domainSkills = fakeDomainSkills({
        save: (host, name, body) => {
          calls.push(`save:${host}/${name}=${body}`);
          return Promise.resolve({ host, name, body, bytes: body.length, updatedAt: 1 });
        },
        list: (host) => Promise.resolve([`${host}-note.md`]),
        read: (host, name) =>
          Promise.resolve({ host, name, body: "B", bytes: 1, updatedAt: 1 }),
        remove: () => Promise.resolve(true),
      });
      const router = createToolRouter(deps({ domainSkills }));
      expect(await router.handle("domainSkillSave", { host: "x.com", name: "n.md", body: "hi" })).toEqual({
        ok: true,
      });
      expect(calls).toEqual(["save:x.com/n.md=hi"]);
      expect(await router.handle("domainSkillList", { host: "x.com" })).toEqual(["x.com-note.md"]);
      expect(await router.handle("domainSkillRead", { host: "x.com", name: "n.md" })).toMatchObject({ body: "B" });
      expect(await router.handle("domainSkillRemove", { host: "x.com", name: "n.md" })).toEqual({ removed: true });
    });

    it("domainSkillRead throws when the note is missing", async () => {
      const router = createToolRouter(deps()); // fake read returns null
      await expect(router.handle("domainSkillRead", { host: "x.com", name: "n.md" })).rejects.toThrow(
        /not found/i,
      );
    });

    it("domainSkillSearch passes the query + optional limit through", async () => {
      const search = vi.fn(() => Promise.resolve([]));
      const router = createToolRouter(deps({ domainSkills: fakeDomainSkills({ search }) }));
      await router.handle("domainSkillSearch", { query: "gold", limit: 3 });
      expect(search).toHaveBeenCalledWith("gold", 3);
      await router.handle("domainSkillSearch", { query: "gold" });
      expect(search).toHaveBeenLastCalledWith("gold", undefined);
    });

    it("domain-skill handlers reject a missing host/name/query", async () => {
      const router = createToolRouter(deps());
      await expect(router.handle("domainSkillList", {})).rejects.toThrow(/host/i);
      await expect(router.handle("domainSkillSave", { host: "x.com", name: "n.md" })).rejects.toThrow(/body/i);
      await expect(router.handle("domainSkillSearch", {})).rejects.toThrow(/query/i);
      await expect(router.handle("domainSkillSearch", { query: "g", limit: "no" })).rejects.toThrow(/limit/i);
    });
  });

  it("rejects a tool it does not own (guards against mis-routing)", async () => {
    const router = createToolRouter(deps());
    await expect(router.handle("navigate", {})).rejects.toThrow(/not a daemon tool/i);
  });

  it("tolerates an RPC that omits the args object", async () => {
    const router = createToolRouter(deps());
    const noArgs = undefined as unknown as Record<string, unknown>;
    expect(await router.handle("skillListInteractions", noArgs)).toEqual(["iframes.md", "dialogs.md"]);
  });
});
