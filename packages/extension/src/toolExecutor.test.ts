import { createToolExecutor } from "./toolExecutor";

describe("createToolExecutor", () => {
  it("dispatches a tool call to its handler with the args and returns the result", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { execute } = createToolExecutor({
      navigate: async (args) => {
        seen.push(args);
        return { ok: true };
      },
    });
    const result = await execute("navigate", { url: "https://x.com" });
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual([{ url: "https://x.com" }]);
  });

  it("rejects an unknown tool with a clear error", async () => {
    const { execute } = createToolExecutor({ navigate: async () => null });
    await expect(execute("frobnicate", {})).rejects.toThrow(/unknown tool: frobnicate/i);
  });

  it("propagates a handler's rejection", async () => {
    const { execute } = createToolExecutor({
      click: async () => {
        throw new Error("no active tab");
      },
    });
    await expect(execute("click", { x: 1, y: 2 })).rejects.toThrow("no active tab");
  });

  it("lists the registered tool names", () => {
    const { tools } = createToolExecutor({ navigate: async () => null, click: async () => null });
    expect(tools).toEqual(["navigate", "click"]);
  });
});
