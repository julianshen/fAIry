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

// An *absent* key gets the fallback; a key that is present but the wrong type is
// an error, not a silent default — so a malformed bridge payload (button: 123,
// deltaY: "300") fails fast at the boundary instead of dispatching the wrong
// action. The fallback overload also narrows the return to a guaranteed value,
// so callers write `optionalNumber(args, "x", 0)`, not `… ?? 0`.
export function optionalString(args: Record<string, unknown>, key: string): string | undefined;
export function optionalString(args: Record<string, unknown>, key: string, fallback: string): string;
export function optionalString(
  args: Record<string, unknown>,
  key: string,
  fallback?: string,
): string | undefined {
  const v = args[key];
  if (v === undefined) return fallback;
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined;
export function optionalNumber(args: Record<string, unknown>, key: string, fallback: number): number;
export function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  fallback?: number,
): number | undefined {
  const v = args[key];
  if (v === undefined) return fallback;
  if (typeof v !== "number" || Number.isNaN(v)) throw new Error(`${key} must be a number`);
  return v;
}
