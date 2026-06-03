import { loadJsonArray, writeJsonFile } from "./fsAtomic";

export interface WorkflowStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface ActionWorkflow {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

/** A workflow's metadata without its step bodies (for listing). */
export interface WorkflowSummary {
  name: string;
  description?: string;
  steps: number;
}

// Side-effect-free BROWSER reads — replaying them wastes time and adds noise; the
// agent re-issues them live at run time. (Daemon-owned tools never reach the
// recorder — the relay only offers it the tools it relayed to the browser — so
// only browser reads need listing here. Shadows the extension's tool semantics;
// a write tool mistakenly listed here would be dropped from recordings.)
const READ_ONLY = new Set<string>([
  "screenshot",
  "screenshotMarked",
  "axtree",
  "getDom",
  "getUrl",
  "getTitle",
  "describeAt",
  "tabList",
  "reader_extract",
  "cdpCollect",
]);

/**
 * Records the agent's side-effecting tool-call stream into a named, replayable
 * sequence — bridging the LLM-driven world (slow, fuzzy) and scripted automation
 * (fast, deterministic). Daemon-owned: the tool-router serves the CRUD; the
 * daemon's relay calls {@link ActionRecorder.capture} after each successful tool
 * call, and `workflowRun` replays the steps back through the same routing.
 *
 * JSON-backed (atomic writes, loaded once); the in-progress recording lives in
 * memory until `stop`.
 */
export interface ActionRecorder {
  start(name: string, description?: string): void;
  /** Append a step — invoked AFTER a successful tool call; filters reads + meta. */
  capture(tool: string, args: Record<string, unknown>): void;
  stop(): ActionWorkflow;
  list(): WorkflowSummary[];
  get(name: string): ActionWorkflow | undefined;
  remove(name: string): boolean;
}

export function createActionRecorder(file: string): ActionRecorder {
  let workflows = loadJsonArray<ActionWorkflow>(file);
  let active: { name: string; description?: string; steps: WorkflowStep[] } | null = null;
  const persist = (): void => writeJsonFile(file, workflows, 0o600);

  return {
    start(name, description) {
      if (active) throw new Error(`already recording '${active.name}'; stop first`);
      if (!name || /[\\/\0]/.test(name)) throw new Error(`invalid workflow name: ${name}`);
      active = { name, description, steps: [] };
    },
    capture(tool, args) {
      if (!active || READ_ONLY.has(tool)) return;
      // Snapshot the args — a later mutation by the caller mustn't alter the step.
      active.steps.push({ tool, args: structuredClone(args) });
    },
    stop() {
      if (!active) throw new Error("not recording");
      const existing = workflows.find((w) => w.name === active!.name);
      const now = Date.now();
      const wf: ActionWorkflow = {
        name: active.name,
        description: active.description,
        steps: active.steps,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      workflows = workflows.filter((w) => w.name !== wf.name).concat(wf);
      persist();
      active = null;
      return wf;
    },
    list: () => workflows.map((w) => ({ name: w.name, description: w.description, steps: w.steps.length })),
    // Clone so a replay can't mutate the in-memory workflow (and affect later runs).
    get: (name) => {
      const wf = workflows.find((w) => w.name === name);
      return wf ? structuredClone(wf) : undefined;
    },
    remove(name) {
      const before = workflows.length;
      workflows = workflows.filter((w) => w.name !== name);
      const removed = workflows.length < before;
      if (removed) persist();
      return removed;
    },
  };
}
