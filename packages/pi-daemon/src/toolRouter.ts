import type { ActionRecorder } from "./actionRecorder";
import type { DomainSkills } from "./domainSkills";
import type { HelperRegistry } from "./helperRegistry";
import type { SkillsLibrary } from "./skillsLibrary";

export interface ToolRouterDeps {
  /** Compact the active conversation's Pi history (→ PiSession.compact). */
  compact: (customInstructions?: string) => void;
  /** The bundled skills library. */
  skills: SkillsLibrary;
  /** Persistent JS-helper registry (save/list/remove are local; callHelper relays). */
  helpers: HelperRegistry;
  /** Per-site notes the agent saves/searches (pure persistence, all local). */
  domainSkills: DomainSkills;
  /** Records the agent's tool stream into replayable workflows. */
  recorder: ActionRecorder;
  /** Relay a tool to the browser executor — used by callHelper to run an `evaluate`. */
  relay: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Route a tool through the full daemon-or-browser dispatch — used to replay workflow steps. */
  dispatch: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Routes the daemon-owned tools — the persistence/session concerns that were
 * over-broadly forwarded to the browser extension. The daemon intercepts these
 * before relaying to Chrome ({@link import("./daemon").createDaemon}); every
 * other tool still goes to the extension (the pure browser executor).
 *
 * `owns()` decides routing; `handle()` runs the daemon-side implementation.
 */
export interface ToolRouter {
  owns(tool: string): boolean;
  handle(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Narrow a required non-empty string arg, or throw a named error (the wire args are untyped). */
function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return v;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || Number.isNaN(v)) throw new Error(`${key} must be a number`);
  return v;
}

export function createToolRouter(deps: ToolRouterDeps): ToolRouter {
  // A Map (not a plain object) so a tool name colliding with an Object prototype
  // member ("constructor", …) can't resolve to an inherited function. (Same
  // guard as the extension's createToolExecutor — separate runtime, not shared.)
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>([
    [
      "compact",
      async (args) => {
        const ci = typeof args.customInstructions === "string" ? args.customInstructions : undefined;
        deps.compact(ci);
        return { ok: true };
      },
    ],
    ["skillPreamble", () => deps.skills.preamble()],
    ["skillListInteractions", () => deps.skills.listInteractions()],
    [
      "skillReadInteraction",
      async (args) => {
        const body = await deps.skills.readInteraction(requireString(args, "name"));
        if (body === null) throw new Error(`skill not found: ${args.name}`);
        return body;
      },
    ],
    [
      "saveHelper",
      async (args) => {
        deps.helpers.save({
          name: requireString(args, "name"),
          expression: requireString(args, "expression"),
          description: optionalString(args, "description"),
        });
        return { ok: true };
      },
    ],
    [
      "listHelpers",
      () =>
        Promise.resolve(deps.helpers.list().map((h) => ({ name: h.name, description: h.description }))),
    ],
    ["removeHelper", async (args) => ({ removed: deps.helpers.remove(requireString(args, "name")) })],
    [
      "callHelper",
      // Hybrid: the helper SOURCE lives on the daemon, but it must RUN in the
      // page — so resolve it here and relay an `evaluate` to the browser.
      async (args) => {
        const name = requireString(args, "name");
        if (!deps.helpers.get(name)) throw new Error(`helper not found: ${name}`);
        // Missing args is fine (→ []); a present-but-non-array is a malformed call.
        if (args.args !== undefined && !Array.isArray(args.args)) {
          throw new Error("args must be an array");
        }
        const callArgs = Array.isArray(args.args) ? args.args : [];
        return deps.relay("evaluate", { expression: deps.helpers.callExpression(name, callArgs) });
      },
    ],
    // Per-site notes — pure persistence + search, all local.
    ["domainSkillList", async (args) => deps.domainSkills.list(requireString(args, "host"))],
    [
      "domainSkillRead",
      async (args) => {
        const host = requireString(args, "host");
        const name = requireString(args, "name");
        const skill = await deps.domainSkills.read(host, name);
        if (!skill) throw new Error(`domain skill not found: ${host}/${name}`);
        return skill;
      },
    ],
    [
      "domainSkillSave",
      async (args) => {
        await deps.domainSkills.save(
          requireString(args, "host"),
          requireString(args, "name"),
          requireString(args, "body"),
        );
        return { ok: true };
      },
    ],
    [
      "domainSkillSearch",
      async (args) => deps.domainSkills.search(requireString(args, "query"), optionalNumber(args, "limit")),
    ],
    [
      "domainSkillRemove",
      async (args) => ({
        removed: await deps.domainSkills.remove(requireString(args, "host"), requireString(args, "name")),
      }),
    ],
    // Workflows — record/list/delete are local; run replays steps through dispatch.
    [
      "workflowRecordStart",
      async (args) => {
        deps.recorder.start(requireString(args, "name"), optionalString(args, "description"));
        return { recording: args.name };
      },
    ],
    [
      "workflowRecordStop",
      async () => {
        const wf = deps.recorder.stop();
        return { name: wf.name, steps: wf.steps.length };
      },
    ],
    ["workflowList", async () => deps.recorder.list()],
    ["workflowDelete", async (args) => ({ removed: deps.recorder.remove(requireString(args, "name")) })],
    [
      "workflowRun",
      async (args) => {
        const name = requireString(args, "name");
        const wf = deps.recorder.get(name);
        if (!wf) throw new Error(`workflow not found: ${name}`);
        // Pause BETWEEN steps so replayed click/type don't race page updates;
        // 200ms is the contract's default (browser-bridge.ts), 0 disables it.
        const stepDelayMs = optionalNumber(args, "stepDelayMs") ?? 200;
        const results: Array<{ tool: string; ok: boolean; error?: string }> = [];
        for (const [i, step] of wf.steps.entries()) {
          if (i > 0 && stepDelayMs > 0) await new Promise((r) => setTimeout(r, stepDelayMs));
          try {
            const result = await deps.dispatch(step.tool, step.args);
            // Some tools report a semantic failure in their RESULT rather than
            // throwing (wait_for timeout, evaluate/callHelper page exception).
            // Honor "stop on the first failed step" for those too.
            const r = result as { ok?: unknown; error?: unknown; reason?: unknown } | null;
            if (r && typeof r === "object" && r.ok === false) {
              const error =
                typeof r.error === "string" ? r.error : typeof r.reason === "string" ? r.reason : "step failed";
              results.push({ tool: step.tool, ok: false, error });
              break;
            }
            results.push({ tool: step.tool, ok: true });
          } catch (err) {
            // A step threw — replaying the rest on a broken page is pointless.
            results.push({ tool: step.tool, ok: false, error: err instanceof Error ? err.message : String(err) });
            break;
          }
        }
        return { name, steps: wf.steps.length, results };
      },
    ],
  ]);

  return {
    owns: (tool) => handlers.has(tool),
    handle: (tool, args) => {
      const handler = handlers.get(tool);
      // An RPC may omit args; default to {} so handlers can read fields safely.
      const safeArgs = args && typeof args === "object" ? args : {};
      return handler ? handler(safeArgs) : Promise.reject(new Error(`${tool} is not a daemon tool`));
    },
  };
}
