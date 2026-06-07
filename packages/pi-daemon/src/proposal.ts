/** A validated, normalized save proposal — the single shape the daemon persists. */
export type CoercedProposal =
  | { kind: "skill"; name: string; content: string; host: string }
  | { kind: "action"; name: string; content: string; attach: "activeTab" | "allTabs" | "none"; host?: string };

/**
 * Validate an (opaque, untrusted-ish) save proposal. The single validity
 * authority for proposeSave: the save path uses it to coerce + persist, and the
 * beatMapper uses it (via try/catch) to decide whether to surface a Save card —
 * so the user is never shown a proposal that would fail to save. Skill proposals
 * must name a host (they file under it) and a file-safe name (filed as
 * `<name>.md`); action proposals default `attach` to "none" if absent/unknown.
 */
export function coerceProposal(v: unknown): CoercedProposal {
  if (typeof v !== "object" || v === null) throw new Error("invalid proposal");
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const content = typeof o.content === "string" ? o.content : "";
  if (name.length === 0) throw new Error("proposal name required");
  // The name is rendered in the panel; reject newlines/NUL to avoid layout breakage.
  if (/[\r\n\0]/.test(name)) throw new Error("proposal name must be a single line");
  // File-safe for both kinds: a skill files as "<name>.md" (must pass safeMdName);
  // an action is a store key but the design asks for file-safety as defense-in-depth.
  if (/[\\/<>:"|?*]/.test(name) || name.startsWith(".")) {
    throw new Error("proposal name must be a plain file-safe label");
  }
  if (content.trim().length === 0) throw new Error("proposal content required");
  if (o.kind === "skill") {
    const host = typeof o.host === "string" ? o.host.trim() : "";
    // Validate at the boundary (domainSkills.normalizeHost is the path-safety
    // backstop, but a clear message here beats a leaked "invalid host" from disk).
    if (host.length === 0 || /[\\/\0<>:"|?*]/.test(host) || host === "." || host === "..") {
      throw new Error("a skill proposal needs a valid host");
    }
    return { kind: "skill", name, content, host };
  }
  if (o.kind === "action") {
    const attach = o.attach === "activeTab" || o.attach === "allTabs" || o.attach === "none" ? o.attach : "none";
    return { kind: "action", name, content, attach, host: typeof o.host === "string" ? o.host : undefined };
  }
  throw new Error(`unknown proposal kind: ${String(o.kind)}`);
}
