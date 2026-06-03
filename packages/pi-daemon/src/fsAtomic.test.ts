import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadJsonArray, writeJsonFile } from "./fsAtomic";

describe("loadJsonArray", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fairy-loadarr-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns the array for valid array JSON", () => {
    const file = path.join(dir, "a.json");
    writeFileSync(file, JSON.stringify([1, 2, 3]));
    expect(loadJsonArray<number>(file)).toEqual([1, 2, 3]);
  });

  it("returns [] for a missing file, corrupt JSON, or valid non-array JSON", () => {
    expect(loadJsonArray(path.join(dir, "missing.json"))).toEqual([]); // ENOENT
    const corrupt = path.join(dir, "corrupt.json");
    writeFileSync(corrupt, "not json");
    expect(loadJsonArray(corrupt)).toEqual([]); // SyntaxError
    const obj = path.join(dir, "obj.json");
    writeFileSync(obj, JSON.stringify({ not: "an array" }));
    expect(loadJsonArray(obj)).toEqual([]); // valid JSON, not an array
  });

  it("rethrows a real I/O failure rather than masking it", () => {
    const asDir = path.join(dir, "adir.json");
    mkdirSync(asDir); // reading a directory → EISDIR, must not be swallowed
    expect(() => loadJsonArray(asDir)).toThrow();
  });
});

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
