import type { SkillsLibrary } from "./skillsLibrary";

export interface ToolRouterDeps {
  /** Compact the active conversation's Pi history (→ PiSession.compact). */
  compact: (customInstructions?: string) => void;
  /** The bundled skills library. */
  skills: SkillsLibrary;
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
  ]);

  return {
    owns: (tool) => handlers.has(tool),
    handle: (tool, args) => {
      const handler = handlers.get(tool);
      return handler ? handler(args) : Promise.reject(new Error(`${tool} is not a daemon tool`));
    },
  };
}
