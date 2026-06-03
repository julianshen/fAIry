import type { CdpClient } from "../cdp/cdpClient";
import { optionalNumber, optionalString } from "./args";
import { MARK_INJECT_JS, MARK_REMOVE_JS } from "./markScript";

type Format = "png" | "jpeg";

interface Shot {
  base64: string;
  width: number;
  height: number;
  format: Format;
}

export interface Mark {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
  role: string | null;
  label: string;
  href: string | null;
}

/**
 * Read the viewport size and capture it. Shared by both screenshot tools.
 * JPEG (q70) is the default: PNG frames accumulate to MBs across an agent's
 * high-iteration loop and blow upstream request limits.
 */
async function capture(cdp: CdpClient, args: Record<string, unknown>): Promise<Shot> {
  const format: Format = optionalString(args, "format", "jpeg") === "png" ? "png" : "jpeg";
  const quality = optionalNumber(args, "quality", 70);
  const params: Record<string, unknown> =
    format === "jpeg" ? { format: "jpeg", quality } : { format: "png" };
  // The two reads are independent (capture params don't use the metrics), so
  // overlap them — one fewer round-trip per frame on the agent's perception loop.
  const [metrics, shot] = (await Promise.all([
    cdp.send("Page.getLayoutMetrics"),
    cdp.send("Page.captureScreenshot", params),
  ])) as [{ visualViewport: { clientWidth: number; clientHeight: number } }, { data: string }];
  const { data } = shot;
  return {
    base64: data,
    width: Math.round(metrics.visualViewport.clientWidth),
    height: Math.round(metrics.visualViewport.clientHeight),
    format,
  };
}

/** Screenshot the viewport. */
export function screenshot(cdp: CdpClient, args: Record<string, unknown>): Promise<Shot> {
  return capture(cdp, args);
}

/**
 * Screenshot with numbered badges over every visible interactive element.
 * Mount the overlay, capture, then remove it — removal is best-effort because
 * the agent's next action may already be navigating the page out from under us.
 */
export async function screenshotMarked(
  cdp: CdpClient,
  args: Record<string, unknown>,
): Promise<Shot & { marks: Mark[] }> {
  const order = optionalString(args, "order", "reading");
  const mount = (await cdp.send("Runtime.evaluate", {
    expression: MARK_INJECT_JS.replace('"__ORDER__"', JSON.stringify(order)),
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: Mark[] } };
  const marks = mount.result?.value ?? [];
  const shot = await capture(cdp, args);
  try {
    await cdp.send("Runtime.evaluate", { expression: MARK_REMOVE_JS, returnByValue: true });
  } catch {
    /* overlay removal is best-effort; the page may already be navigating */
  }
  return { ...shot, marks };
}
