import type { CdpClient } from "../cdp/cdpClient";
import { optionalNumber, optionalString, requireNumber, requireString } from "./args";

/**
 * Click at viewport coordinates (x, y) by dispatching a press then a release —
 * a synthetic mouse click via CDP, the same pair the POC sent. The agent gets
 * (x, y) from a marked screenshot, so it clicks a point, not a selector.
 */
export async function click(
  cdp: CdpClient,
  args: Record<string, unknown>,
): Promise<{ ok: true }> {
  const x = requireNumber(args, "x");
  const y = requireNumber(args, "y");
  const button = optionalString(args, "button", "left");
  const common = { x, y, button, clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...common });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...common });
  return { ok: true };
}

/**
 * Type text into the focused element, one `char` key event per character —
 * what the page sees as real keystrokes. `delayMs` paces them for inputs that
 * debounce on keystroke timing.
 */
export async function type(cdp: CdpClient, args: Record<string, unknown>): Promise<{ ok: true }> {
  const text = requireString(args, "text");
  const delayMs = optionalNumber(args, "delayMs", 0) ?? 0;
  for (const ch of text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: true };
}

/** Scroll the page by a wheel delta at (x, y) (both default 0 = top-left). */
export async function scroll(cdp: CdpClient, args: Record<string, unknown>): Promise<{ ok: true }> {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: optionalNumber(args, "x", 0) ?? 0,
    y: optionalNumber(args, "y", 0) ?? 0,
    deltaX: optionalNumber(args, "deltaX", 0) ?? 0,
    deltaY: optionalNumber(args, "deltaY", 0) ?? 0,
  });
  return { ok: true };
}
