import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireSingleInstanceLock } from "./singleInstance";

describe("acquireSingleInstanceLock", () => {
  let dir: string;
  let lockFile: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fairy-lock-"));
    lockFile = path.join(dir, "daemon.lock");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("acquires when no lockfile exists and records our pid", () => {
    const lock = acquireSingleInstanceLock({ lockFile, pid: 4242, isAlive: () => true });
    expect(lock).not.toBeNull();
    expect(readFileSync(lockFile, "utf8").trim()).toBe("4242");
  });

  it("creates the parent directory if missing", () => {
    const nested = path.join(dir, "a", "b", "daemon.lock");
    expect(acquireSingleInstanceLock({ lockFile: nested, pid: 1, isAlive: () => true })).not.toBeNull();
    expect(existsSync(nested)).toBe(true);
  });

  it("refuses (null) when the lockfile is held by a live process", () => {
    writeFileSync(lockFile, "100");
    const lock = acquireSingleInstanceLock({ lockFile, pid: 4242, isAlive: (p) => p === 100 });
    expect(lock).toBeNull();
    expect(readFileSync(lockFile, "utf8").trim()).toBe("100"); // untouched
  });

  it("reclaims a stale lockfile whose process is gone", () => {
    writeFileSync(lockFile, "100");
    const lock = acquireSingleInstanceLock({ lockFile, pid: 4242, isAlive: () => false });
    expect(lock).not.toBeNull();
    expect(readFileSync(lockFile, "utf8").trim()).toBe("4242");
  });

  it("reclaims a lockfile with unparseable/empty content", () => {
    writeFileSync(lockFile, "  not-a-pid\n");
    const lock = acquireSingleInstanceLock({ lockFile, pid: 4242, isAlive: () => true });
    expect(lock).not.toBeNull();
    expect(readFileSync(lockFile, "utf8").trim()).toBe("4242");
  });

  it("release() removes the lockfile (and is idempotent)", () => {
    const lock = acquireSingleInstanceLock({ lockFile, pid: 4242, isAlive: () => true });
    lock!.release();
    expect(existsSync(lockFile)).toBe(false);
    expect(() => lock!.release()).not.toThrow();
  });

  describe("default liveness (process.kill)", () => {
    it("refuses when the lockfile holds this live process", () => {
      writeFileSync(lockFile, String(process.pid));
      expect(acquireSingleInstanceLock({ lockFile })).toBeNull();
    });

    it("refuses when the lockfile holds pid 1 (exists, EPERM)", () => {
      writeFileSync(lockFile, "1");
      expect(acquireSingleInstanceLock({ lockFile })).toBeNull();
    });

    it("reclaims when the lockfile holds a pid that does not exist", () => {
      writeFileSync(lockFile, "999999");
      expect(acquireSingleInstanceLock({ lockFile, pid: 4242 })).not.toBeNull();
      expect(readFileSync(lockFile, "utf8").trim()).toBe("4242");
    });
  });
});
