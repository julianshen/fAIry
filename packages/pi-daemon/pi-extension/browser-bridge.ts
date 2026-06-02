/**
 * Fairy browser-bridge extension for Pi.
 *
 * Loaded via `pi --mode rpc -e <path-to-this-file>` (the daemon's
 * ConversationController spawns Pi this way). Registers the `browser_*` tools
 * that, when the LLM calls them, forward the call to the Fairy daemon's
 * PiBridgeServer over a loopback TCP socket; the daemon relays each call to the
 * Chrome extension (the executor) and returns the result.
 *
 * Connection: 127.0.0.1:$FAIRY_PI_BRIDGE_PORT, authenticated by sending
 * `{type:"auth", token}` (token from $FAIRY_PI_BRIDGE_TOKEN) as the first line.
 * Then one JSON object per line: request {id, tool, args}, response
 * {id, ok, result?, error?} with the same id. The server's `auth_ok` ack has no
 * `id`, so the response loop ignores it.
 *
 * Self-contained by design: Pi's runtime provides ExtensionAPI + TypeBox, and
 * `net` is a Node built-in — an `-e` script can't import the daemon's modules.
 * The wire protocol here mirrors what packages/pi-daemon/src/piBridgeServer.ts
 * (and its tests) implement on the daemon side.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createConnection, type Socket } from "net";

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (err: Error) => void;
}

const PORT = Number(process.env.FAIRY_PI_BRIDGE_PORT ?? 0);
const TOKEN = process.env.FAIRY_PI_BRIDGE_TOKEN ?? "";

let sock: Socket | null = null;
let connecting: Promise<Socket> | null = null;
let buf = "";
const pending = new Map<string, PendingCall>();
let nextId = 0;

function getConn(): Promise<Socket> {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  // Share one in-flight connection so concurrent tool calls don't each open a
  // socket (a connection storm) before the first finishes connecting.
  if (connecting) return connecting;
  if (!PORT) return Promise.reject(new Error("FAIRY_PI_BRIDGE_PORT not set"));
  connecting = new Promise((resolve, reject) => {
    const s = createConnection({ host: "127.0.0.1", port: PORT });
    s.setEncoding("utf8");
    s.on("connect", () => {
      // Authenticate first; the daemon closes the socket on a bad/absent token.
      s.write(JSON.stringify({ type: "auth", token: TOKEN }) + "\n");
      sock = s;
      connecting = null;
      resolve(s);
    });
    s.on("error", (err) => {
      sock = null;
      connecting = null;
      reject(err);
    });
    s.on("close", () => {
      sock = null;
      connecting = null;
      buf = ""; // drop any partial line so it can't corrupt the next connection
      for (const p of pending.values()) p.reject(new Error("bridge closed"));
      pending.clear();
    });
    s.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const resp = JSON.parse(line) as {
            id?: string;
            ok?: boolean;
            result?: unknown;
            error?: string;
          };
          if (resp.id === undefined) continue; // e.g. the auth_ok ack
          const p = pending.get(resp.id);
          if (!p) continue;
          pending.delete(resp.id);
          if (resp.ok) p.resolve(resp.result);
          else p.reject(new Error(resp.error ?? "unknown bridge error"));
        } catch {
          /* ignore malformed lines */
        }
      }
    });
  });
  return connecting;
}

async function callBridge(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const conn = await getConn();
  const id = String(++nextId);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    conn.write(JSON.stringify({ id, tool, args }) + "\n");
  });
}

/** Pi expects an AgentToolResult; wrap a bridge call into one. */
async function bridge(tool: string, args: Record<string, unknown>) {
  try {
    const result = await callBridge(tool, args);
    // A successful action tool (click/type/...) may return no result;
    // JSON.stringify(undefined) is `undefined`, not a string, so coerce to "".
    const text = typeof result === "string" ? result : (JSON.stringify(result) ?? "");
    return { content: [{ type: "text" as const, text }], details: result };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
      details: { error: (err as Error).message },
    };
  }
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser_navigate",
    label: "Navigate browser",
    description: "Navigate Fairy's active browser tab to a URL.",
    parameters: Type.Object({ url: Type.String() }),
    execute: async (_id, params) => bridge("navigate", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_click",
    label: "Click in browser",
    description:
      "Click at viewport (x, y) coordinates in the active tab. Use a screenshot first to know what to click.",
    parameters: Type.Object({
      x: Type.Number(),
      y: Type.Number(),
      button: Type.Optional(
        Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]),
      ),
    }),
    execute: async (_id, params) => bridge("click", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_type",
    label: "Type text",
    description: "Type text into the currently focused input. Click a field first to focus it.",
    parameters: Type.Object({ text: Type.String(), delayMs: Type.Optional(Type.Number()) }),
    execute: async (_id, params) => bridge("type", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_scroll",
    label: "Scroll page",
    description: "Scroll the active page by a delta. deltaY positive = scroll down.",
    parameters: Type.Object({
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      deltaX: Type.Optional(Type.Number()),
      deltaY: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => bridge("scroll", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Screenshot",
    description:
      "Screenshot the visible viewport. Defaults to PNG (lossless). Pass `format: 'jpeg'` and " +
      "an optional `quality` (1-100, default 70) for a smaller payload. Returns an image the LLM can see.",
    parameters: Type.Object({
      format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")])),
      quality: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      try {
        const result = (await callBridge("screenshot", params as Record<string, unknown>)) as {
          base64: string;
          width: number;
          height: number;
          format: "png" | "jpeg";
        };
        const mimeType = result.format === "jpeg" ? "image/jpeg" : "image/png";
        return {
          content: [{ type: "image" as const, data: result.base64, mimeType }],
          details: { width: result.width, height: result.height, format: result.format },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Screenshot failed: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  pi.registerTool({
    name: "browser_screenshot_marked",
    label: "Screenshot with marks",
    description:
      "Screenshot the viewport with numbered boxes overlaid on every visible interactive element. " +
      "Returns the image plus `marks`: {id, x, y, w, h, tag, role, label, href}. PREFER over " +
      "browser_screenshot when about to click — pick a mark id and click its (x, y). Default JPEG q70. " +
      "`order`: 'reading' (default, visual top-to-bottom) or 'dom' (document order).",
    parameters: Type.Object({
      order: Type.Optional(Type.Union([Type.Literal("reading"), Type.Literal("dom")])),
      format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")])),
      quality: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      try {
        const result = (await callBridge("screenshotMarked", params as Record<string, unknown>)) as {
          base64: string;
          width: number;
          height: number;
          format: "png" | "jpeg";
          marks: Array<Record<string, unknown>>;
        };
        const mimeType = result.format === "jpeg" ? "image/jpeg" : "image/png";
        return {
          content: [
            { type: "image" as const, data: result.base64, mimeType },
            {
              type: "text" as const,
              text: JSON.stringify({ marks: result.marks, width: result.width, height: result.height }),
            },
          ],
          details: {
            width: result.width,
            height: result.height,
            format: result.format,
            marks: result.marks,
          },
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Marked screenshot failed: ${(err as Error).message}` },
          ],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  pi.registerTool({
    name: "browser_evaluate",
    label: "Evaluate JS",
    description:
      "Run a JavaScript expression in the page and return the value. Useful for reading page data without a screenshot.",
    parameters: Type.Object({ expression: Type.String() }),
    execute: async (_id, params) => bridge("evaluate", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_getDom",
    label: "Get DOM",
    description:
      "Get a depth-limited DOM tree of the current page. Cheaper than a screenshot for structural queries.",
    parameters: Type.Object({ depth: Type.Optional(Type.Number()) }),
    execute: async (_id, params) => bridge("getDom", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_getUrl",
    label: "Get URL",
    description: "Get the current URL of the active tab.",
    parameters: Type.Object({}),
    execute: async () => bridge("getUrl", {}),
  });

  pi.registerTool({
    name: "browser_getTitle",
    label: "Get title",
    description: "Get the current page title of the active tab.",
    parameters: Type.Object({}),
    execute: async () => bridge("getTitle", {}),
  });

  pi.registerTool({
    name: "browser_axtree",
    label: "Accessibility tree",
    description:
      "Get the page's accessibility tree (headings, links, buttons, ARIA roles + names). PREFER over " +
      "browser_getDom for 'find the X button' / 'list the links' tasks: much cheaper and easier to reason over.",
    parameters: Type.Object({}),
    execute: async () => bridge("axtree", {}),
  });

  pi.registerTool({
    name: "browser_wait_for",
    label: "Wait for condition",
    description:
      "Wait for a page condition rather than sleeping. Conditions: selector (visible), selectorGone, " +
      "networkIdleMs, urlMatch (regex), predicate (JS truthy), timeoutMs (default 10s). Returns as soon " +
      "as ANY holds: {ok:true, reason} or {ok:false, reason:'timeout'}.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String()),
      selectorGone: Type.Optional(Type.String()),
      networkIdleMs: Type.Optional(Type.Number()),
      urlMatch: Type.Optional(Type.String()),
      predicate: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => bridge("waitFor", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_dismiss_overlays",
    label: "Dismiss overlays",
    description:
      "Detect and remove modal/overlay/dialog elements that intercept clicks (cookie banners, popups, " +
      "chat widgets). Call when a click 'should have worked' but the page didn't respond. Returns {removed, nodes}.",
    parameters: Type.Object({}),
    execute: async () => bridge("dismissOverlays", {}),
  });

  pi.registerTool({
    name: "browser_describe_at",
    label: "Describe element at (x, y)",
    description:
      "Describe the element elementFromPoint(x, y) returns. Use when a click at coordinates seems to do " +
      "nothing — tells you what's ACTUALLY at the point. Returns {tag, id, classes, role, ariaLabel, text, rect}.",
    parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
    execute: async (_id, params) => bridge("describeAt", params as Record<string, unknown>),
  });

  // ─── JS helper registry ──────────────────────────────────────────────
  pi.registerTool({
    name: "browser_save_helper",
    label: "Save JS helper",
    description:
      "Save a JS function for reuse across turns. `expression` MUST evaluate to a function. Saving with an " +
      "existing name overwrites. Functions run in the page's context (full DOM access). Persist to disk.",
    parameters: Type.Object({
      name: Type.String(),
      expression: Type.String(),
      description: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => bridge("saveHelper", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_call_helper",
    label: "Call JS helper",
    description:
      "Invoke a previously-saved JS helper on the active page. Returns {ok:true, value} or {ok:false, error}.",
    parameters: Type.Object({ name: Type.String(), args: Type.Optional(Type.Array(Type.Any())) }),
    execute: async (_id, params) => bridge("callHelper", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_list_helpers",
    label: "List JS helpers",
    description: "List the saved JS helpers — names + descriptions. Check before deriving a snippet you may have.",
    parameters: Type.Object({}),
    execute: async () => bridge("listHelpers", {}),
  });

  pi.registerTool({
    name: "browser_remove_helper",
    label: "Remove JS helper",
    description: "Delete a saved JS helper by name.",
    parameters: Type.Object({ name: Type.String() }),
    execute: async (_id, params) => bridge("removeHelper", params as Record<string, unknown>),
  });

  // ─── CDP event subscription ──────────────────────────────────────────
  pi.registerTool({
    name: "browser_cdp_subscribe",
    label: "Subscribe to CDP event",
    description:
      "Hook a CDP event method — events from now on are buffered until browser_cdp_collect. Auto-enables the " +
      "matching CDP domain. Pattern: subscribe → take action → collect.",
    parameters: Type.Object({ method: Type.String() }),
    execute: async (_id, params) => bridge("cdpSubscribe", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_cdp_collect",
    label: "Collect CDP events",
    description:
      "Drain the buffer of subscribed events, clearing it so the next collect returns only NEW events. " +
      "Optional `max`. Returns [{at, method, params}] in arrival order.",
    parameters: Type.Object({ method: Type.Optional(Type.String()), max: Type.Optional(Type.Number()) }),
    execute: async (_id, params) => bridge("cdpCollect", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_cdp_unsubscribe",
    label: "Unsubscribe CDP",
    description: "Stop receiving a specific event method, or all methods if no arg.",
    parameters: Type.Object({ method: Type.Optional(Type.String()) }),
    execute: async (_id, params) => bridge("cdpUnsubscribe", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_cdp",
    label: "Raw CDP",
    description:
      "Send an arbitrary Chrome DevTools Protocol command to the active tab. Pass {method, params}. " +
      "Returns the CDP response verbatim. Power-user escape hatch when the high-level browser_* tools don't fit.",
    parameters: Type.Object({
      method: Type.String(),
      params: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    execute: async (_id, params) => bridge("cdp", params as Record<string, unknown>),
  });

  // ─── Agent Policy + structured actions ───────────────────────────────
  pi.registerTool({
    name: "browser_get_agent_policy",
    label: "Read agent policy",
    description:
      "Fetch the active page's Agent Policy (/agent.json). Returns {level: 0|1|2|3, origin, policy?}. " +
      "When level >= 1, READ `prohibited`/`requires_human` and adjust your plan.",
    parameters: Type.Object({}),
    execute: async () => bridge("getAgentPolicy", {}),
  });

  pi.registerTool({
    name: "browser_invoke_structured_action",
    label: "Invoke structured action",
    description:
      "Call a site-declared action from its /agent.json via the page's HTTP session. Prefer over UI clicking " +
      "when the site publishes structured actions (level >= 2). Returns the JSON response body.",
    parameters: Type.Object({
      actionName: Type.String(),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    execute: async (_id, params) => bridge("invokeStructuredAction", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_learn_page_actions",
    label: "Learn page actions",
    description:
      "Analyze the current page to discover what actions the user can perform (interactive elements, forms, " +
      "URL patterns, optional network + scripting probes). Use on sites without agent.json. Flags: mode, " +
      "includeNetwork, includeScripting, includeUrlAnalysis.",
    parameters: Type.Object({
      mode: Type.Optional(Type.String()),
      includeNetwork: Type.Optional(Type.Boolean()),
      includeScripting: Type.Optional(Type.Boolean()),
      includeUrlAnalysis: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, params) => bridge("learnPageActions", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_propose_save",
    label: "Propose a save",
    description:
      "Surface a draft to the user for confirmation when they ask to save what they learned/did. You do NOT " +
      "save directly. kind='skill' (markdown content + optional host) or kind='action' (name + prompt + attach).",
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("skill"), Type.Literal("action")]),
      name: Type.String(),
      content: Type.String(),
      host: Type.Optional(Type.String()),
      attach: Type.Optional(
        Type.Union([Type.Literal("activeTab"), Type.Literal("allTabs"), Type.Literal("none")]),
      ),
    }),
    execute: async (_id, params) => bridge("proposeSave", params as Record<string, unknown>),
  });

  // ─── Conversation maintenance ────────────────────────────────────────
  pi.registerTool({
    name: "browser_compact",
    label: "Compact conversation",
    description:
      "Compact your own conversation history when a long task has accumulated many screenshots / large tool " +
      "returns. Optional `customInstructions` to bias what the summary preserves.",
    parameters: Type.Object({ customInstructions: Type.Optional(Type.String()) }),
    execute: async (_id, params) => bridge("compact", params as Record<string, unknown>),
  });

  // ─── Workflow recording / replay ─────────────────────────────────────
  pi.registerTool({
    name: "browser_workflow_record_start",
    label: "Start recording",
    description:
      "Begin capturing your side-effecting tool calls into a named, replayable sequence. Read-only tools are " +
      "not recorded. Stop with browser_workflow_record_stop.",
    parameters: Type.Object({ name: Type.String(), description: Type.Optional(Type.String()) }),
    execute: async (_id, params) => bridge("workflowRecordStart", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_workflow_record_stop",
    label: "Stop recording",
    description: "Stop the in-progress recording and persist it. Overwrites by name. Returns the saved workflow.",
    parameters: Type.Object({}),
    execute: async () => bridge("workflowRecordStop", {}),
  });

  pi.registerTool({
    name: "browser_workflow_run",
    label: "Run workflow",
    description:
      "Replay a saved workflow. Each step dispatches through the same tool router (safety checks still apply). " +
      "Stops on the first failed step. `stepDelayMs` (default 200ms) pauses between steps.",
    parameters: Type.Object({ name: Type.String(), stepDelayMs: Type.Optional(Type.Number()) }),
    execute: async (_id, params) => bridge("workflowRun", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_workflow_list",
    label: "List workflows",
    description: "List saved workflows by name (no step bodies). Check before recording.",
    parameters: Type.Object({}),
    execute: async () => bridge("workflowList", {}),
  });

  pi.registerTool({
    name: "browser_workflow_delete",
    label: "Delete workflow",
    description: "Delete a saved workflow by name. Returns {removed: true|false}.",
    parameters: Type.Object({ name: Type.String() }),
    execute: async (_id, params) => bridge("workflowDelete", params as Record<string, unknown>),
  });

  // ─── Multi-tab orchestration ─────────────────────────────────────────
  pi.registerTool({
    name: "browser_tab_open",
    label: "Open new tab",
    description:
      "Open a new tab and switch to it (subsequent tool calls target it). Optional `url`. Returns {id, url, title, isActive}.",
    parameters: Type.Object({ url: Type.Optional(Type.String()) }),
    execute: async (_id, params) => bridge("tabOpen", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_tab_switch",
    label: "Switch tab",
    description: "Switch to the tab with the given id. Subsequent tool calls target it. Returns the tab descriptor.",
    parameters: Type.Object({ id: Type.String() }),
    execute: async (_id, params) => bridge("tabSwitch", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_tab_close",
    label: "Close tab",
    description: "Close the tab with the given id. After closing the active tab, call browser_tab_list.",
    parameters: Type.Object({ id: Type.String() }),
    execute: async (_id, params) => bridge("tabClose", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_tab_list",
    label: "List tabs",
    description: "List all tabs in the current window: [{id, url, title, isActive}].",
    parameters: Type.Object({}),
    execute: async () => bridge("tabList", {}),
  });

  pi.registerTool({
    name: "reader_extract",
    label: "Reader mode",
    description:
      "Extract the main article from the active tab using Mozilla's Readability. PREFER over browser_getDom " +
      "for reading-comprehension tasks. Returns {title, byline, excerpt, textContent, ...} or {error}.",
    parameters: Type.Object({}),
    execute: async () => bridge("reader_extract", {}),
  });

  // ─── Skills library (bundled, read-only) ─────────────────────────────
  pi.registerTool({
    name: "browser_skill_preamble",
    label: "Read SKILL.md",
    description:
      "Read the top-level browser SKILL.md — the playbook for these tools. Call once at the start of a " +
      "browser-automation task. Returns the markdown body.",
    parameters: Type.Object({}),
    execute: async () => bridge("skillPreamble", {}),
  });

  pi.registerTool({
    name: "browser_skill_list_interactions",
    label: "List interaction skills",
    description:
      "List available interaction-skill files — short notes on reusable web mechanics (scrolling, dropdowns, " +
      "iframes, dialogs, uploads, login-walls, etc). Read one with browser_skill_read_interaction.",
    parameters: Type.Object({}),
    execute: async () => bridge("skillListInteractions", {}),
  });

  pi.registerTool({
    name: "browser_skill_read_interaction",
    label: "Read interaction skill",
    description: "Read a specific interaction-skill markdown file by name (e.g. 'iframes.md'). Returns its body.",
    parameters: Type.Object({ name: Type.String() }),
    execute: async (_id, params) => bridge("skillReadInteraction", params as Record<string, unknown>),
  });

  // ─── Domain skills (per-site, user-writable) ─────────────────────────
  pi.registerTool({
    name: "browser_domain_skill_list",
    label: "List domain skills",
    description:
      "List the per-site notes saved for a host (bare domain like 'amazon.com'). Read those before inventing a fresh approach.",
    parameters: Type.Object({ host: Type.String() }),
    execute: async (_id, params) => bridge("domainSkillList", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_domain_skill_read",
    label: "Read domain skill",
    description: "Read a saved per-site note. Returns {name, host, body, bytes, updatedAt}.",
    parameters: Type.Object({ host: Type.String(), name: Type.String() }),
    execute: async (_id, params) => bridge("domainSkillRead", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_domain_skill_save",
    label: "Save domain skill",
    description:
      "Persist a per-site playbook (a quirk specific to this site that helps future runs). Keep short, one quirk " +
      "per file. `name` ends in `.md`, kebab-case. Overwrites by name.",
    parameters: Type.Object({ host: Type.String(), name: Type.String(), body: Type.String() }),
    execute: async (_id, params) => bridge("domainSkillSave", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_domain_skill_search",
    label: "Search domain skills",
    description:
      "Case-insensitive substring search across every saved domain skill, all hosts. Returns up to `limit` files " +
      "with matching lines + a score. Read promising hits with browser_domain_skill_read.",
    parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()) }),
    execute: async (_id, params) => bridge("domainSkillSearch", params as Record<string, unknown>),
  });

  pi.registerTool({
    name: "browser_domain_skill_remove",
    label: "Remove domain skill",
    description: "Delete a saved domain skill by host + name (when stale and not usefully refinable).",
    parameters: Type.Object({ host: Type.String(), name: Type.String() }),
    execute: async (_id, params) => bridge("domainSkillRemove", params as Record<string, unknown>),
  });

  // ─── A2UI: declarative UI inside the panel ───────────────────────────
  pi.registerTool({
    name: "render_ui",
    label: "Render UI",
    description:
      "Render rich UI inside the Fairy panel using A2UI v0.8 (https://a2ui.org/specification/v0_8). Use for " +
      "comparisons, summaries, dashboards. Pass {message} — an A2UI message object (adjacency-list components). " +
      "The execute echoes the message back; the panel detects render_ui and renders it.",
    parameters: Type.Object({
      message: Type.Any({ description: "An A2UI v0.8 message object. See spec link above." }),
    }),
    execute: async (_id, params) => {
      const message = (params as { message: unknown }).message;
      return { content: [{ type: "text" as const, text: JSON.stringify(message) }], details: message };
    },
  });
}
