import { loadJsonArray, writeJsonFile } from "./fsAtomic";

/** A re-runnable prompt the user saved (the agent proposes, the user confirms). */
export interface SavedAction {
  name: string;
  /** The natural-language prompt to re-feed as a task. */
  content: string;
  /** Which tab(s) a future run targets (honored by PR-B's runner). */
  attach: "activeTab" | "allTabs" | "none";
  /** Optional site the action was drafted on. */
  host?: string;
  createdAt: number;
}

export interface ActionsStore {
  list(): SavedAction[];
  save(input: { name: string; content: string; attach: SavedAction["attach"]; host?: string }): SavedAction;
}

/**
 * Persistent store of saved "actions" (re-runnable prompts). Daemon-owned,
 * JSON-backed (atomic writes), loaded once; a missing/corrupt file reads as
 * empty. The name is an in-memory key (not a path), so only non-empty is
 * required. PR-B adds listing + a runner on top of this.
 */
export function createActionsStore(file: string): ActionsStore {
  let actions = loadJsonArray<SavedAction>(file);
  return {
    list: () => actions.slice(),
    save: (input) => {
      const name = input.name.trim();
      if (name.length === 0) throw new Error("action name required");
      // Defense-in-depth (per the design): keep the key file-safe in case it's
      // ever used in a path/URL/log, even though it's an in-memory key today.
      if (/[\\/\0<>:"|?*]/.test(name) || name.startsWith(".")) throw new Error("invalid action name");
      if (input.content.trim().length === 0) throw new Error("action content required");
      const record: SavedAction = { name, content: input.content, attach: input.attach, host: input.host, createdAt: Date.now() };
      // Write first; only adopt the new in-memory state once the disk write
      // succeeds, so a failed write leaves memory and disk consistent.
      const updated = actions.filter((a) => a.name !== name).concat(record);
      writeJsonFile(file, updated, 0o600);
      actions = updated;
      return record;
    },
  };
}
