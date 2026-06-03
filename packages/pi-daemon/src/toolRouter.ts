import type { HelperRegistry } from "./helperRegistry";
import type { SkillsLibrary } from "./skillsLibrary";

export interface ToolRouterDeps {
  /** Compact the active conversation's Pi history (→ PiSession.compact). */
  compact: (customInstructions?: string) => void;
  /** The bundled skills library. */
  skills: SkillsLibrary;
  /** Persistent JS-helper registry (save/list/remove are local; callHelper relays). */
  helpers: HelperRegistry;
  /** Relay a tool to the browser executor — used by callHelper to run an `evaluate`. */
  relay: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
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
        if (typeof args.name !== "string") throw new Error("name must be a string");
        const body = await deps.skills.readInteraction(args.name);
        if (body === null) throw new Error(`skill not found: ${args.name}`);
        return body;
      },
    ],
    [
      "saveHelper",
      async (args) => {
        if (typeof args.name !== "string") throw new Error("name must be a string");
        if (typeof args.expression !== "string") throw new Error("expression must be a string");
        const description = typeof args.description === "string" ? args.description : undefined;
        deps.helpers.save({ name: args.name, expression: args.expression, description });
        return { ok: true };
      },
    ],
    [
      "listHelpers",
      () =>
        Promise.resolve(deps.helpers.list().map((h) => ({ name: h.name, description: h.description }))),
    ],
    [
      "removeHelper",
      async (args) => {
        if (typeof args.name !== "string") throw new Error("name must be a string");
        return { removed: deps.helpers.remove(args.name) };
      },
    ],
    [
      "callHelper",
      // Hybrid: the helper SOURCE lives on the daemon, but it must RUN in the
      // page — so resolve it here and relay an `evaluate` to the browser.
      async (args) => {
        if (typeof args.name !== "string") throw new Error("name must be a string");
        if (!deps.helpers.get(args.name)) throw new Error(`helper not found: ${args.name}`);
        const callArgs = Array.isArray(args.args) ? args.args : [];
        return deps.relay("evaluate", { expression: deps.helpers.callExpression(args.name, callArgs) });
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
