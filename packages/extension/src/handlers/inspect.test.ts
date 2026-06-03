import { describe, expect, it } from "vitest";
import type { CdpClient } from "../cdp/cdpClient";
import { axtree, describeAt, getDom } from "./inspect";

function fakeCdp(responses: Record<string, unknown> = {}): CdpClient & {
  calls: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return {
    calls,
    send(method, params) {
      calls.push({ method, params });
      return Promise.resolve(responses[method]);
    },
  };
}

describe("getDom", () => {
  it("returns DOM.getDocument's root with the default depth", async () => {
    const root = { nodeId: 1, nodeName: "#document" };
    const cdp = fakeCdp({ "DOM.getDocument": { root } });
    const result = await getDom(cdp, {});
    expect(cdp.calls[0]).toEqual({
      method: "DOM.getDocument",
      params: { depth: 4, pierce: false },
    });
    expect(result).toEqual(root);
  });

  it("honors an explicit depth", async () => {
    const cdp = fakeCdp({ "DOM.getDocument": { root: {} } });
    await getDom(cdp, { depth: -1 });
    expect(cdp.calls[0]?.params).toMatchObject({ depth: -1 });
  });
});

describe("axtree", () => {
  it("returns the full accessibility tree response", async () => {
    const tree = { nodes: [{ nodeId: "1", role: { value: "WebArea" } }] };
    const cdp = fakeCdp({ "Accessibility.getFullAXTree": tree });
    expect(await axtree(cdp, {})).toEqual(tree);
    expect(cdp.calls[0]?.method).toBe("Accessibility.getFullAXTree");
  });
});

describe("describeAt", () => {
  it("returns the element descriptor evaluated at (x,y)", async () => {
    const descriptor = { tag: "button", id: "go", text: "Go" };
    const cdp = fakeCdp({ "Runtime.evaluate": { result: { value: descriptor } } });
    const result = await describeAt(cdp, { x: 12, y: 34 });
    expect(cdp.calls[0]?.method).toBe("Runtime.evaluate");
    expect(String(cdp.calls[0]?.params?.expression)).toContain("elementFromPoint(12, 34)");
    expect(result).toEqual(descriptor);
  });

  it("rejects when x or y is missing", async () => {
    const cdp = fakeCdp();
    await expect(describeAt(cdp, { x: 1 })).rejects.toThrow(/y.*number/);
  });
});
