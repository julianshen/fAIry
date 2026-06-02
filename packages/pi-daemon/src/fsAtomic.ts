import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Atomically write a JSON file, creating parent directories as needed:
 * serialize to a sibling temp file, then `rename` it over the target. The
 * rename is atomic on the same filesystem, so the target is never partially
 * written or left with looser permissions.
 *
 * The temp gets an unpredictable name and is created exclusively (`wx`), so a
 * stale or attacker-planted temp can never be truncated and reused — which
 * would briefly expose a secret under that file's looser mode. Created fresh at
 * `mode` for the same reason. On any failure the (secret-bearing) temp is
 * unlinked rather than left on disk.
 */
export function writeJsonFile(file: string, data: unknown, mode?: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(
      tmp,
      JSON.stringify(data, null, 2),
      mode !== undefined ? { flag: "wx", mode } : { flag: "wx" },
    );
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, file);
  } catch (err) {
    // Best-effort cleanup; surface the original failure, not a cleanup error.
    /* v8 ignore start */
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    /* v8 ignore stop */
    throw err;
  }
}
