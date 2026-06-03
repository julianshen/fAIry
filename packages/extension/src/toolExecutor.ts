import type { ToolExecute } from "./bridgeClient";

/** Runs one browser tool against the live tab (e.g. via `chrome.debugger`). */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolExecutor {
  /** Pass to {@link import("./bridgeClient").connectBridge} as `execute`. */
  readonly execute: ToolExecute;
  /** The tool names this executor can handle. */
  readonly tools: readonly string[];
}

/**
 * Build the dispatch {@link import("./bridgeClient").connectBridge} uses: route a
 * bridge tool name to its handler. An unknown tool rejects with a clear error
 * (surfaced back to Pi as a tool failure rather than a hang). The handlers — the
 * actual `chrome.debugger`/`tabs`/`scripting` implementations — are injected, so
 * this dispatch stays pure and unit-testable.
 */
export function createToolExecutor(handlers: Record<string, ToolHandler>): ToolExecutor {
  const execute: ToolExecute = (tool, args) => {
    const handler = handlers[tool];
    return handler ? handler(args) : Promise.reject(new Error(`unknown tool: ${tool}`));
  };
  return { execute, tools: Object.freeze(Object.keys(handlers)) };
}
