import { promises as fs } from "node:fs";
import path from "node:path";

/** A saved per-site note + its on-disk metadata. */
export interface DomainSkillFile {
  name: string;
  host: string;
  body: string;
  bytes: number;
  updatedAt: number;
}

/** A search hit: the matching lines (numbered) for one note, with a relevance score. */
export interface DomainSkillHit {
  host: string;
  name: string;
  lines: Array<{ n: number; text: string }>;
  score: number;
  updatedAt: number;
}

/**
 * Per-site playbooks the agent writes as it learns a site's quirks, stored under
 * `<root>/<host>/<name>.md` so notes survive restarts. Daemon-owned (pure
 * persistence + search — no browser), served by the tool-router.
 *
 * Hosts are normalized (lowercase, `www.` stripped) so `amazon.com` and
 * `www.amazon.com` share notes; names must be plain `.md` basenames. Both are
 * confined to the root — the agent supplies host/name, so traversal is guarded.
 */
export interface DomainSkills {
  list(host: string): Promise<string[]>;
  read(host: string, name: string): Promise<DomainSkillFile | null>;
  save(host: string, name: string, body: string): Promise<DomainSkillFile>;
  remove(host: string, name: string): Promise<boolean>;
  search(query: string, limit?: number): Promise<DomainSkillHit[]>;
}

function normalizeHost(input: string): string {
  let h = input.toLowerCase().trim();
  if (h.startsWith("www.")) h = h.slice(4);
  // No path separators, NUL, or bare dot segments (`.`/`..` have no slash yet
  // would escape the root via path.join).
  if (h.length === 0 || /[\\/\0]/.test(h) || h === "." || h === "..") {
    throw new Error(`invalid host: ${input}`);
  }
  return h;
}

function safeName(name: string): string {
  if (!name.endsWith(".md")) throw new Error("domain skill name must end in .md");
  if (/[\\/\0]/.test(name) || name.startsWith(".")) throw new Error(`invalid skill name: ${name}`);
  return name;
}

export function createDomainSkills(root: string): DomainSkills {
  const hostDir = (host: string): string => {
    const dir = path.join(root, normalizeHost(host));
    // Defense in depth: the resolved dir must stay strictly inside root.
    // (normalizeHost already rejects slashes + dot segments, so this is
    // belt-and-suspenders and not reachable via a normalized host.)
    const rel = path.relative(root, dir);
    /* v8 ignore next 3 */
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`invalid host: ${host}`);
    }
    return dir;
  };

  const list: DomainSkills["list"] = async (host) => {
    try {
      const entries = await fs.readdir(hostDir(host));
      return entries.filter((e) => e.endsWith(".md")).sort();
    } catch {
      return [];
    }
  };

  const read: DomainSkills["read"] = async (host, name) => {
    const safe = safeName(name);
    const full = path.join(hostDir(host), safe);
    try {
      const [body, stat] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);
      return { name: safe, host: normalizeHost(host), body, bytes: stat.size, updatedAt: stat.mtimeMs };
    } catch {
      return null;
    }
  };

  const listHosts = async (): Promise<string[]> => {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      return entries.filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      return [];
    }
  };

  return {
    list,
    read,
    async save(host, name, body) {
      const safe = safeName(name);
      const dir = hostDir(host);
      await fs.mkdir(dir, { recursive: true });
      const full = path.join(dir, safe);
      await fs.writeFile(full, body, "utf8");
      const stat = await fs.stat(full);
      return { name: safe, host: normalizeHost(host), body, bytes: stat.size, updatedAt: stat.mtimeMs };
    },
    async remove(host, name) {
      const full = path.join(hostDir(host), safeName(name));
      try {
        await fs.unlink(full);
        return true;
      } catch {
        return false;
      }
    },
    async search(query, limit = 20) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: DomainSkillHit[] = [];
      for (const host of await listHosts()) {
        for (const name of await list(host)) {
          const skill = await read(host, name);
          if (!skill) continue;
          const lines: Array<{ n: number; text: string }> = [];
          skill.body.split("\n").forEach((text, i) => {
            if (text.toLowerCase().includes(q)) lines.push({ n: i + 1, text: text.slice(0, 200) });
          });
          if (lines.length > 0) {
            hits.push({ host, name, lines: lines.slice(0, 5), score: lines.length, updatedAt: skill.updatedAt });
          }
        }
      }
      hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
      return hits.slice(0, limit);
    },
  };
}
