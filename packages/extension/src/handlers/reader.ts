import type { CdpClient } from "../cdp/cdpClient";
import { evaluateExpression } from "./evaluate";
import { READER_JS } from "./readerScript";

export type ReaderResult =
  | {
      title: string;
      byline: string | null;
      excerpt: string | null;
      textContent: string;
      length: number;
      lang: string | null;
    }
  | { error: string };

/** A non-empty string, else null — for the optional metadata fields. */
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Extract the active tab's main readable content (heuristic, readability-style).
 * Runs READER_JS in the page and coerces the result; a thrown evaluate (e.g.
 * NO_TAB_BOUND, navigating page) propagates as the tool error.
 */
export async function readerExtract(cdp: CdpClient): Promise<ReaderResult> {
  const v = await evaluateExpression(cdp, READER_JS);
  if (typeof v !== "object" || v === null) return { error: "no readable content" };
  const o = v as Record<string, unknown>;
  if (typeof o.textContent !== "string" || o.textContent.length === 0) {
    return { error: "no readable content" };
  }
  const textContent = o.textContent;
  return {
    title: str(o.title) ?? "",
    byline: str(o.byline),
    excerpt: str(o.excerpt),
    textContent,
    length: typeof o.length === "number" ? o.length : textContent.length,
    lang: str(o.lang),
  };
}
