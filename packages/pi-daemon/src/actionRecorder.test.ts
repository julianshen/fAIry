import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionRecorder } from "./actionRecorder";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "fairy-wf-"));
  file = path.join(dir, "workflows.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("actionRecorder", () => {
  it("records side-effecting steps between start and stop, skipping reads + meta", () => {
    const rec = createActionRecorder(file);
    rec.start("login", "log into the site");
    rec.capture("navigate", { url: "https://x.com" });
    rec.capture("screenshot", {}); // read-only → skipped
    rec.capture("getUrl", {}); // read-only → skipped
    rec.capture("type", { text: "user" });
    rec.capture("workflowList", {}); // meta → skipped
    rec.capture("click", { x: 1, y: 2 });
    const wf = rec.stop();
    expect(wf.steps).toEqual([
      { tool: "navigate", args: { url: "https://x.com" } },
      { tool: "type", args: { text: "user" } },
      { tool: "click", args: { x: 1, y: 2 } },
    ]);
    expect(wf.name).toBe("login");
  });

  it("capture is a no-op when not recording", () => {
    const rec = createActionRecorder(file);
    rec.capture("navigate", { url: "x" }); // no active recording
    expect(rec.list()).toEqual([]);
  });

  it("persists across instances; list returns name+description+step count (no bodies)", () => {
    const rec = createActionRecorder(file);
    rec.start("flow");
    rec.capture("click", { x: 1, y: 1 });
    rec.stop();
    const fresh = createActionRecorder(file);
    expect(fresh.list()).toEqual([{ name: "flow", description: undefined, steps: 1 }]);
    expect(fresh.get("flow")?.steps).toHaveLength(1); // full body on get
  });

  it("refuses to start while already recording, and to stop when not", () => {
    const rec = createActionRecorder(file);
    rec.start("a");
    expect(() => rec.start("b")).toThrow(/already recording/i);
    rec.stop();
    expect(() => rec.stop()).toThrow(/not recording/i);
  });

  it("rejects an invalid workflow name", () => {
    const rec = createActionRecorder(file);
    expect(() => rec.start("a/b")).toThrow(/invalid workflow name/i);
    expect(() => rec.start("")).toThrow(/invalid workflow name/i);
  });

  it("re-recording a name overwrites it but preserves createdAt", () => {
    const rec = createActionRecorder(file);
    rec.start("f");
    rec.capture("click", { x: 1, y: 1 });
    const first = rec.stop();
    rec.start("f");
    rec.capture("type", { text: "x" });
    const second = rec.stop();
    expect(rec.list()).toHaveLength(1);
    expect(second.steps).toEqual([{ tool: "type", args: { text: "x" } }]);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.createdAt);
  });

  it("remove reports whether the workflow existed", () => {
    const rec = createActionRecorder(file);
    rec.start("f");
    rec.stop();
    expect(rec.remove("f")).toBe(true);
    expect(rec.remove("f")).toBe(false);
  });

  it("reads empty for a corrupt file", () => {
    writeFileSync(file, "not json");
    expect(createActionRecorder(file).list()).toEqual([]);
  });
});
