import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Atomically write a JSON file, creating parent directories as needed:
 * serialize to a sibling temp file (created fresh at `mode`, so a secrets file
 * is never briefly world-readable), then `rename` it over the target. The
 * rename is atomic on the same filesystem, so the target is never partially
 * written or left with looser permissions.
 */
export function writeJsonFile(file: string, data: unknown, mode?: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), mode !== undefined ? { mode } : undefined);
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, file);
}
