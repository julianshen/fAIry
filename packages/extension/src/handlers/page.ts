import type { CdpClient } from "../cdp/cdpClient";
import { optionalNumber, optionalString } from "./args";
import { evaluateExpression } from "./evaluate";

/** Time seam so {@link waitFor}'s polling loop is deterministic under test. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const POLL_MS = 100;
/** Hard ceilings on tool-supplied input: bound the loop and guard against a ReDoS regex. */
const MAX_TIMEOUT_MS = 60_000;
const MAX_URL_MATCH_LEN = 256;
const MAX_IDLE_MS = 10_000;

/**
 * Detect and remove modal/overlay elements that intercept clicks — the common
 * pattern of a high-z-index fixed/sticky/absolute element covering most of the
 * viewport, plus body/html scroll-locks. Returns how many were removed so the
 * agent knows whether to retry its action. A page-eval failure is non-fatal:
 * report a no-op rather than failing the tool.
 */
export async function dismissOverlays(
  cdp: CdpClient,
  _args: Record<string, unknown>,
): Promise<{ removed: number; nodes: string[] }> {
  try {
    const value = await evaluateExpression(
      cdp,
      `(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const removed = [];
      // Inline/text tags are never full-viewport overlays; skipping them avoids
      // getComputedStyle on every node (layout thrash on large pages).
      const SKIP = new Set(['span','p','a','li','td','tr','th','option','b','i','strong','em','code','h1','h2','h3','h4','h5','h6','label','small']);
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (SKIP.has(el.tagName.toLowerCase())) continue;
        const cs = window.getComputedStyle(el);
        const pos = cs.position;
        const ariaModal = el.getAttribute('aria-modal') === 'true';
        const role = el.getAttribute('role');
        const isModalRole = role === 'dialog' || role === 'alertdialog';
        const zi = parseInt(cs.zIndex, 10) || 0;
        if (!ariaModal && !isModalRole && zi < 100) continue;
        if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') continue;
        const r = el.getBoundingClientRect();
        const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) *
                     Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        if (area < vw * vh * 0.25) continue;
        const tag = el.tagName.toLowerCase();
        const id = el.id ? ('#' + el.id) : '';
        const cls = (el.className && typeof el.className === 'string')
          ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.') : '';
        removed.push(tag + id + cls);
        el.remove();
      }
      for (const el of [document.body, document.documentElement]) {
        if (el && window.getComputedStyle(el).overflow === 'hidden') el.style.overflow = 'auto';
      }
      return { removed: removed.length, nodes: removed };
    })()`,
    );
    return value as { removed: number; nodes: string[] };
  } catch {
    return { removed: 0, nodes: [] };
  }
}

/**
 * Wait for one of several page conditions, polling ~every 100ms until it holds
 * or the deadline passes. Replaces the agent's "sleep then retry" instinct with
 * a declarative waiter the page satisfies as soon as it's ready. Supported:
 * `selector` (exists + visible), `selectorGone`, `urlMatch` (regex), `predicate`
 * (arbitrary truthy JS). `networkIdle` resolves once the Resource Timing count is
 * stable for `idleMs`.
 */
export async function waitFor(
  cdp: CdpClient,
  args: Record<string, unknown>,
  clock: Clock = realClock,
): Promise<{ ok: boolean; reason: string }> {
  const timeoutMs = Math.min(optionalNumber(args, "timeoutMs", 10_000), MAX_TIMEOUT_MS);
  const selector = optionalString(args, "selector");
  const selectorGone = optionalString(args, "selectorGone");
  const urlMatch = optionalString(args, "urlMatch");
  const predicate = optionalString(args, "predicate");
  const networkIdle = args.networkIdle === true;
  // A non-number idleMs falls back to the default (don't throw — it's a soft timing
  // hint); clamp to [0, MAX] (a negative would make the quiet check trivially true).
  const rawIdle = args.idleMs;
  const idleMs = Math.max(
    0,
    Math.min(typeof rawIdle === "number" && Number.isFinite(rawIdle) ? rawIdle : 500, MAX_IDLE_MS),
  );

  // Compile the url regex once, up front — never per tick (a constant recompile,
  // and an untrusted pattern shouldn't be fed to `new RegExp` in a hot loop).
  let urlRe: RegExp | undefined;
  if (urlMatch !== undefined) {
    if (urlMatch.length > MAX_URL_MATCH_LEN) return { ok: false, reason: "badRegex" };
    try {
      urlRe = new RegExp(urlMatch);
    } catch {
      return { ok: false, reason: "badRegex" };
    }
  }

  const deadline = clock.now() + timeoutMs;

  // networkIdle: a per-tick signature of the page's network state, or undefined if it
  // can't be read (navigating page / bad result). It combines `performance.timeOrigin`
  // (the document's identity — changes on a full navigation, so a click-nav to a new
  // page with the SAME resource count still reads as activity) with the Resource Timing
  // count (completion-quiescence within a document). A stable signature means no new
  // resource finished AND no navigation; stream-safe (an open SSE/WS never adds a
  // completed entry).
  const networkSignature = async (): Promise<string | undefined> => {
    try {
      const v = await evaluateExpression(
        cdp,
        "performance.timeOrigin + '|' + performance.getEntriesByType('resource').length",
      );
      return typeof v === "string" && v.length > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  };
  let lastSig: string | undefined;
  let idleSince = 0;

  const truthy = async (expr: string): Promise<boolean> => {
    try {
      return (await evaluateExpression(cdp, expr)) === true;
    } catch {
      return false;
    }
  };

  while (clock.now() < deadline) {
    if (selector) {
      const e = JSON.stringify(selector);
      // offsetParent is null for position:fixed elements even when visible, so
      // accept those explicitly (sticky headers, cookie banners, FABs, modals).
      if (
        await truthy(
          `(()=>{const e=document.querySelector(${e});if(!e)return false;const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')return false;return e.offsetParent!==null||cs.position==='fixed';})()`,
        )
      ) {
        return { ok: true, reason: "selector" };
      }
    }
    if (selectorGone && (await truthy(`!document.querySelector(${JSON.stringify(selectorGone)})`))) {
      return { ok: true, reason: "selectorGone" };
    }
    if (urlRe) {
      const href = String(await evaluateExpression(cdp, "location.href"));
      if (urlRe.test(href)) return { ok: true, reason: "urlMatch" };
    }
    if (predicate && (await truthy(`!!(${predicate})`))) {
      return { ok: true, reason: "predicate" };
    }
    if (networkIdle) {
      const sig = await networkSignature();
      if (sig !== undefined) {
        if (lastSig === undefined || sig !== lastSig) {
          // any change = activity: a new resource, a count drop, OR a navigation
          // (timeOrigin changes) even if the new document's count happens to match.
          lastSig = sig;
          idleSince = clock.now();
        } else if (clock.now() - idleSince >= idleMs) {
          return { ok: true, reason: "networkIdle" };
        }
      }
    }
    await clock.sleep(POLL_MS);
  }
  return { ok: false, reason: "timeout" };
}
