import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionsStore } from "./actionsStore";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "actions-"));
  file = join(dir, "actions.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("actionsStore", () => {
  it("saves an action and returns the stored record", () => {
    const store = createActionsStore(file);
    const saved = store.save({ name: "reorder", content: "re-buy my usuals", attach: "activeTab" });
    expect(saved).toMatchObject({ name: "reorder", content: "re-buy my usuals", attach: "activeTab" });
    expect(typeof saved.createdAt).toBe("number");
  });

  it("persists across reloads (atomic, load-once)", () => {
    createActionsStore(file).save({ name: "reorder", content: "x", attach: "none" });
    expect(createActionsStore(file).list().map((a) => a.name)).toEqual(["reorder"]);
  });

  it("upserts by name (no duplicates)", () => {
    const store = createActionsStore(file);
    store.save({ name: "reorder", content: "v1", attach: "none" });
    store.save({ name: "reorder", content: "v2", attach: "allTabs" });
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ content: "v2", attach: "allTabs" });
  });

  it("rejects an empty/whitespace name", () => {
    const store = createActionsStore(file);
    expect(() => store.save({ name: "  ", content: "x", attach: "none" })).toThrow(/name/i);
  });

  it("rejects empty content", () => {
    const store = createActionsStore(file);
    expect(() => store.save({ name: "ok", content: "  ", attach: "none" })).toThrow(/content/i);
  });

  it("rejects a file-unsafe name", () => {
    const store = createActionsStore(file);
    expect(() => store.save({ name: "a/b", content: "x", attach: "none" })).toThrow(/invalid action name/i);
  });

  it("reads an absent file as empty", () => {
    expect(createActionsStore(file).list()).toEqual([]);
  });
});
