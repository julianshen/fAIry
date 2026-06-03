/**
 * Tiny argument validators for the browser-tool handlers. Tool args arrive as
 * an untyped `Record<string, unknown>` over the wire, so each handler narrows
 * the fields it needs. A bad arg throws a named error that surfaces to Pi as a
 * tool failure (a clear message beats a downstream CDP error).
 */

export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}

export function requireNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || Number.isNaN(v)) throw new Error(`${key} must be a number`);
  return v;
}

export function optionalString(
  args: Record<string, unknown>,
  key: string,
  fallback?: string,
): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}

export function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  fallback?: number,
): number | undefined {
  const v = args[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}
