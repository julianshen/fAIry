import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface SingleInstanceLockOptions {
  /** Path to the PID lockfile (e.g. `appData/daemon.lock`). */
  lockFile: string;
  /** PID to record. Defaults to `process.pid`. */
  pid?: number;
  /** Whether a PID is a live process. Defaults to a `process.kill(pid, 0)` probe. */
  isAlive?: (pid: number) => boolean;
}

export interface LockHandle {
  /** Release the lock (delete the lockfile). Idempotent. */
  release(): void;
}

/**
 * Acquire a single-instance lock via a PID lockfile: exclusively create it with
 * our PID. If it already exists, the holder is checked for liveness — a live
 * holder means another daemon is running (returns `null`); a dead/unreadable
 * holder is a stale lock from a crashed run, which is reclaimed. Returns a
 * handle whose `release()` removes the lockfile.
 *
 * The holder PID is trusted without identity verification: after a crash, if the
 * OS has recycled that PID onto an unrelated live process, the lock looks held
 * and startup is (wrongly) refused. Rare at login-launch frequency and self-heals
 * once that process exits; stamping a start-time/nonce would close it if needed.
 */
export function acquireSingleInstanceLock(opts: SingleInstanceLockOptions): LockHandle | null {
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? defaultIsAlive;
  mkdirSync(path.dirname(opts.lockFile), { recursive: true });

  // Two attempts: acquire, or (on a stale lock) reclaim and acquire. The loop
  // also covers losing a race to another starter between reclaim and re-create.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(opts.lockFile, String(pid), { flag: "wx" });
      return {
        // Only remove the lockfile if it's still ours — if we were paused long
        // enough for another instance to reclaim a "stale" lock, deleting it
        // would clobber that instance's lock.
        release: () => {
          if (readHolder(opts.lockFile) === pid) rmSync(opts.lockFile, { force: true });
        },
      };
    } catch (err) {
      /* v8 ignore next */
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = readHolder(opts.lockFile);
      if (holder !== null && isAlive(holder)) return null; // another live instance
      // Reclaim the stale/unreadable lock — but only if it still holds the dead
      // PID we just saw, so we don't delete a fresh lock another process raced in
      // and created (then re-acquire next iteration). This narrows, but doesn't
      // fully close, the concurrent-stale-recovery window — a real OS advisory
      // lock (flock) would; deferred for v1.
      /* v8 ignore next -- the "changed under us" path needs a real concurrent racer */
      if (readHolder(opts.lockFile) !== holder) continue;
      rmSync(opts.lockFile, { force: true });
    }
  }
  return null;
}

/** The PID recorded in a lockfile, or null if missing/unreadable/not a PID. */
function readHolder(file: string): number | null {
  let raw: string;
  // The lockfile exists (we just got EEXIST); a read failure here means it was
  // deleted in the race between that and this read — defensive, not testable
  // without mocking fs.
  /* v8 ignore start */
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  /* v8 ignore stop */
  // Number() (not parseInt) so trailing garbage like "1234abc" is NaN, not 1234.
  const pid = Number(raw.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only probes; doesn't actually signal
    return true;
  } catch (err) {
    // EPERM: the process exists but we may not signal it (still alive).
    // ESRCH: no such process.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
