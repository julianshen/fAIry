import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Read-only access to the bundled `SKILL.md` + `interaction-skills/*.md` shipped
 * under the daemon's `skills/` dir. The agent pulls these on demand: `SKILL.md`
 * is the top-level preamble; the interaction skills cover reusable web mechanics
 * (dropdowns, iframes, uploads, …). Bundled at build time; never written —
 * domain-specific notes are a separate concern (see DomainSkills).
 *
 * This is daemon-owned (the tool-router serves it without touching the browser),
 * not forwarded to the extension.
 */
export interface SkillsLibrary {
  preamble(): Promise<string>;
  listInteractions(): Promise<string[]>;
  /** The skill body, or null if there's no such skill. Throws on an unsafe name. */
  readInteraction(name: string): Promise<string | null>;
}

export function createSkillsLibrary(root: string): SkillsLibrary {
  return {
    preamble() {
      return fs.readFile(path.join(root, "SKILL.md"), "utf8");
    },
    async listInteractions() {
      try {
        const entries = await fs.readdir(path.join(root, "interaction-skills"));
        return entries.filter((e) => e.endsWith(".md")).sort();
      } catch {
        return [];
      }
    },
    async readInteraction(name) {
      // No path traversal, no escaping the interaction-skills dir, .md only.
      if (!name.endsWith(".md") || /[\\/]/.test(name) || name.startsWith(".")) {
        throw new Error(`invalid skill name: ${name}`);
      }
      try {
        return await fs.readFile(path.join(root, "interaction-skills", name), "utf8");
      } catch {
        return null;
      }
    },
  };
}
