import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHelperRegistry } from "./helperRegistry";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "fairy-helpers-"));
  file = path.join(dir, "helpers.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("helperRegistry", () => {
  it("starts empty when the file is missing", () => {
    expect(createHelperRegistry(file).list()).toEqual([]);
  });

  it("saves a helper and persists it (visible to a fresh registry)", () => {
    const reg = createHelperRegistry(file);
    reg.save({ name: "double", expression: "(x) => x * 2", description: "x2" });
    expect(reg.list()).toEqual([
      expect.objectContaining({ name: "double", expression: "(x) => x * 2", description: "x2" }),
    ]);
    // a new registry reading the same file sees it
    expect(createHelperRegistry(file).get("double")?.expression).toBe("(x) => x * 2");
  });

  it("overwrites a helper saved under the same name", () => {
    const reg = createHelperRegistry(file);
    reg.save({ name: "f", expression: "() => 1" });
    reg.save({ name: "f", expression: "() => 2" });
    expect(reg.list()).toHaveLength(1);
    expect(reg.get("f")?.expression).toBe("() => 2");
  });

  it("removes a helper and reports whether it existed", () => {
    const reg = createHelperRegistry(file);
    reg.save({ name: "f", expression: "() => 1" });
    expect(reg.remove("f")).toBe(true);
    expect(reg.get("f")).toBeUndefined();
    expect(reg.remove("missing")).toBe(false);
  });

  it("tolerates a corrupt file (returns empty rather than throwing)", () => {
    const reg = createHelperRegistry(file);
    reg.save({ name: "f", expression: "() => 1" });
    writeFileSync(file, "not json");
    expect(createHelperRegistry(file).list()).toEqual([]);
  });

  describe("callExpression", () => {
    it("builds a self-contained expression that inlines the called helper and invokes it", () => {
      const reg = createHelperRegistry(file);
      reg.save({ name: "double", expression: "(x) => x * 2" });
      const expr = reg.callExpression("double", [21]);
      expect(expr).toContain("(x) => x * 2"); // the helper source is inlined
      expect(expr).toContain('"double"'); // referenced in the not-callable guard
      expect(expr).toContain("[21]"); // the args
      expect(expr.trim().startsWith("(")).toBe(true); // a single evaluatable expression
    });

    it("inlines ONLY the called helper, not other saved helpers", () => {
      const reg = createHelperRegistry(file);
      reg.save({ name: "wanted", expression: "() => 1" });
      reg.save({ name: "sibling", expression: "() => { throw 'boom' }" });
      const expr = reg.callExpression("wanted", []);
      expect(expr).not.toContain("boom"); // a side-effecting sibling isn't injected
    });

    it("throws for an unknown helper", () => {
      expect(() => createHelperRegistry(file).callExpression("nope", [])).toThrow(/helper not found/);
    });
  });
});
