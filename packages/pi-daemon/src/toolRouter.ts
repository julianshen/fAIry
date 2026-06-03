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
