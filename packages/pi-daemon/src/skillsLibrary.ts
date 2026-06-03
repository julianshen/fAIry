import { promises as fs } from "node:fs";
import path from "node:path";
import { listMdFiles, safeMdName } from "./mdFiles";

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
    listInteractions() {
      return listMdFiles(path.join(root, "interaction-skills"));
    },
    async readInteraction(name) {
      safeMdName(name); // no traversal / escaping the dir; .md only
      try {
        return await fs.readFile(path.join(root, "interaction-skills", name), "utf8");
      } catch {
        return null;
      }
    },
  };
}
