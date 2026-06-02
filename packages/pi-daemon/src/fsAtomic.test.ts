import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeJsonFile } from "./fsAtomic";

describe("writeJsonFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fairy-atomic-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes JSON to the target, creating parent dirs", () => {
    const file = path.join(dir, "nested", "deep", "out.json");
    writeJsonFile(file, { x: 1 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ x: 1 });
  });

  it("applies the requested mode to the written secret", () => {
    const file = path.join(dir, "secret.json");
    writeJsonFile(file, { k: "v" }, 0o600);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("leaves no secret-bearing temp file behind when the write fails", () => {
    // A directory at the target path makes the final rename fail *after* the
    // temp has been written — so the secret would leak via the temp unless we
    // clean it up.
    const file = path.join(dir, "target");
    mkdirSync(file);
    expect(() => writeJsonFile(file, { secret: "leak" }, 0o600)).toThrow();
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("does not truncate a pre-existing same-prefixed temp file", () => {
    // Codex's vector: a stale/planted `<file>.tmp` must never be reused (and
    // truncated, briefly exposing the secret under its looser mode).
    const planted = path.join(dir, "secret.json.tmp");
    writeFileSync(planted, "stale", { mode: 0o644 });
    writeJsonFile(path.join(dir, "secret.json"), { k: "v" }, 0o600);
    // The planted file is untouched; the real write used its own fresh temp.
    expect(readFileSync(planted, "utf8")).toBe("stale");
  });
});
