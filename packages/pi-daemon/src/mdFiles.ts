import { promises as fs } from "node:fs";

/**
 * Shared guards for agent-supplied `.md` file names served off disk (bundled
 * skills, per-site domain skills). One source of truth so the path-traversal
 * rule can't drift between the two stores.
 */

/**
 * Require a plain `.md` basename. Rejects path separators, NUL, dot-segments,
 * and the chars that are illegal/awkward in file names across platforms
 * (`:*?"<>|`) — notably `:` is a Windows alternate-data-stream separator, so
 * `note.md:hidden.md` would otherwise create a non-listable stream.
 */
export function safeMdName(name: string): string {
  if (!name.endsWith(".md") || /[\\/\0<>:"|?*]/.test(name) || name.startsWith(".")) {
    throw new Error(`invalid skill name: ${name}`);
  }
  return name;
}

/** The sorted `.md` files in `dir`, or `[]` if the dir is missing/unreadable. */
export async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith(".md")).sort();
  } catch {
    return [];
  }
}
