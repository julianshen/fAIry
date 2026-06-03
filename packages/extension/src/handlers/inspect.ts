import type { CdpClient } from "../cdp/cdpClient";
import { optionalNumber, requireNumber } from "./args";
import { evaluateExpression } from "./evaluate";

/**
 * Capture the document tree (no styles, depth-limited). A low-token DOM summary
 * for the agent; `depth: -1` means the full tree. `pierce: false` keeps shadow
 * roots out — cheaper, and rarely what the agent needs.
 */
export async function getDom(cdp: CdpClient, args: Record<string, unknown>): Promise<unknown> {
  const depth = optionalNumber(args, "depth", 4) ?? 4;
  const res = (await cdp.send("DOM.getDocument", { depth, pierce: false })) as { root: unknown };
  return res.root;
}

/**
 * The page's accessibility tree — the semantic structure screen readers use.
 * Far cheaper than getDom for "find the Submit button" and more meaningful for
 * LLM perception than raw DOM.
 */
export function axtree(cdp: CdpClient, _args: Record<string, unknown>): Promise<unknown> {
  return cdp.send("Accessibility.getFullAXTree", {});
}

/**
 * Describe the element that would receive a click at (x, y). Fallback context
 * when a click lands physically but the page intercepts it (modal, transparent
 * overlay, click-jack layer). Returns the tag/id/classes/role/text/rect, or
 * null if nothing is there.
 */
export async function describeAt(
  cdp: CdpClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  const x = requireNumber(args, "x");
  const y = requireNumber(args, "y");
  return evaluateExpression(
    cdp,
    `(() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean),
        role: el.getAttribute('role') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        text: (el.textContent || '').slice(0, 80).trim(),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      };
    })()`,
  );
}
