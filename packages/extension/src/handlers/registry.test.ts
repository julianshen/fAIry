import { describe, expect, it, vi } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { createEventBuffer } from "../cdp/eventBuffer";
import { createAgentTabs } from "../tabs/agentTabs";
import { fakeTabs } from "../tabs/testTabs";
import { createBrowserHandlers, type BrowserDeps } from "./registry";

function deps(over: Partial<BrowserDeps> = {}): BrowserDeps {
  return {
    cdp: fakeCdp(),
    tabs: fakeTabs(),
    agentTabs: createAgentTabs(),
    events: createEventBuffer(),
    ...over,
  };
}

/** The exact wire names the daemon relays (the `bridge("...")` args in the -e script). */
const EXPECTED_TOOLS = [
  // groups 1-2
  "navigate",
  "getUrl",
  "getTitle",
  "click",
  "type",
  "scroll",
  "evaluate",
  "screenshot",
  "screenshotMarked",
  "getDom",
  "axtree",
  "describeAt",
  "dismissOverlays",
  "waitFor",
  // group 3 — tabs
  "tabOpen",
  "tabSwitch",
  "tabClose",
  "tabList",
  // group 4 — cdp passthrough + events
  "cdp",
  "cdpSubscribe",
  "cdpCollect",
  "cdpUnsubscribe",
];

describe("createBrowserHandlers", () => {
  it("registers exactly the implemented wire tool names", () => {
    const handlers = createBrowserHandlers(deps());
    expect(Object.keys(handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("routes a CDP call to the matching handler, passing the cdp client", async () => {
    const send = vi.fn((method: string) =>
      Promise.resolve(method === "Page.navigate" ? undefined : { result: { value: "x" } }),
    );
    const handlers = createBrowserHandlers(deps({ cdp: { send } }));
    const result = await handlers.navigate!({ url: "https://example.com" });
    expect(send).toHaveBeenCalledWith("Page.navigate", { url: "https://example.com" });
    expect(result).toEqual({ ok: true });
  });

  it("routes a tab call through the agent-tab binding", async () => {
    const agentTabs = createAgentTabs();
    agentTabs.bindSession(1); // a task must be bound before opening tabs
    const handlers = createBrowserHandlers(deps({ agentTabs }));
    const result = (await handlers.tabOpen!({ url: "https://example.com" })) as { id: string };
    expect(agentTabs.isOwned(Number(result.id))).toBe(true);
  });

  it("every handler is a function taking args", () => {
    const handlers = createBrowserHandlers(deps());
    for (const name of EXPECTED_TOOLS) {
      expect(typeof handlers[name]).toBe("function");
    }
  });

  it("dispatches every advertised tool to a callable handler (none throws synchronously)", async () => {
    const handlers = createBrowserHandlers(deps());
    // Invoke each with minimal args; a handler may reject on validation, but it
    // must be routable and never throw synchronously (the bridge relies on that).
    // timeoutMs:0 keeps waitFor's poll loop from running on the real clock here.
    await Promise.all(
      EXPECTED_TOOLS.map((name) =>
        Promise.resolve(handlers[name]!({ timeoutMs: 0 })).catch(() => undefined),
      ),
    );
  });
});
