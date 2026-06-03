import { readFileSync } from "node:fs";
import { writeJsonFile } from "./fsAtomic";

/** A named JS helper the agent saved for reuse across turns. */
export interface JsHelper {
  name: string;
  /** JS expression that evaluates to a function, e.g. `(x) => x * 2`. */
  expression: string;
  description?: string;
  createdAt: number;
}

/**
 * Persistent registry of named JS helpers (the agent learns a page primitive
 * once and reuses it). Daemon-owned: save/list/remove are pure persistence; the
 * tool-router serves them locally. `callHelper` is the hybrid — the daemon
 * builds the call expression here and relays an `evaluate` to the browser.
 *
 * JSON-backed (atomic writes), loaded once into memory; the daemon is the only
 * writer. A missing or corrupt file reads as empty.
 */
export interface HelperRegistry {
  list(): JsHelper[];
  get(name: string): JsHelper | undefined;
  save(input: { name: string; expression: string; description?: string }): void;
  /** Remove a helper; returns whether it existed. */
  remove(name: string): boolean;
  /** A self-contained JS expression that injects the helpers and calls `name` with `args`. */
  callExpression(name: string, args: unknown[]): string;
}

/** The page-global the injected helpers live under (internal to the call expression). */
const NS = "__fairy";

function load(file: string): JsHelper[] {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(data) ? (data as JsHelper[]) : [];
  } catch {
    return [];
  }
}

export function createHelperRegistry(file: string): HelperRegistry {
  let helpers = load(file);
  const persist = (): void => writeJsonFile(file, helpers, 0o600);

  const inlineInjection = (): string => {
    const body = helpers.map((h) => `__h[${JSON.stringify(h.name)}] = (${h.expression});`).join("\n");
    return `(function(){
      if (!window.${NS}) window.${NS} = {};
      if (!window.${NS}.helpers) window.${NS}.helpers = {};
      var __h = window.${NS}.helpers;
      ${body}
    })()`;
  };

  return {
    list: () => helpers.slice(),
    get: (name) => helpers.find((h) => h.name === name),
    save: (input) => {
      helpers = helpers.filter((h) => h.name !== input.name).concat({ ...input, createdAt: Date.now() });
      persist();
    },
    remove: (name) => {
      const before = helpers.length;
      helpers = helpers.filter((h) => h.name !== name);
      const removed = helpers.length < before;
      if (removed) persist();
      return removed;
    },
    callExpression: (name, args) =>
      `(function(){
        ${inlineInjection()};
        var fn = window.${NS} && window.${NS}.helpers && window.${NS}.helpers[${JSON.stringify(name)}];
        if (typeof fn !== 'function') throw new Error('helper not callable: ' + ${JSON.stringify(name)});
        return fn.apply(null, ${JSON.stringify(args)});
      })()`,
  };
}
